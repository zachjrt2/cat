import Phaser from 'phaser';
import type { Cat, LifeStage, ToolType } from '../data/types';
import { shouldFallAsleep, shouldWakeUp } from '../systems/NeedsSystem';

const BASE_SPRITE_SCALE = 2.2;
const HIT_RADIUS = 38;

function getScaleForStage(stage?: LifeStage): number {
  switch (stage) {
    case 'kitten':
      return 1.35;
    case 'teen':
      return 1.75;
    case 'adult':
    default:
      return BASE_SPRITE_SCALE;
  }
}

/**
 * Maps velocity vector (dx, dy) to 8-direction spritesheet index:
 * 0=South(Down), 1=South-West, 2=West(Left), 3=North-West, 4=North(Up), 5=North-East, 6=East(Right), 7=South-East
 */
function vectorToDirection(dx: number, dy: number): number {
  const angleDeg = (Phaser.Math.RadToDeg(Math.atan2(dy, dx)) + 360) % 360;
  const sector = Math.round(((angleDeg - 90 + 360) % 360) / 45) % 8;
  return sector;
}

export class CatSprite extends Phaser.GameObjects.Container {
  readonly cat: Cat;
  private baseSprite: Phaser.GameObjects.Sprite;
  private markingSprite: Phaser.GameObjects.Sprite | null = null;
  private shadow: Phaser.GameObjects.Graphics;
  private nameLabel: Phaser.GameObjects.Text;
  private sleepZzz: Phaser.GameObjects.Text;
  private dirtGfx: Phaser.GameObjects.Graphics;
  private hoverGfx: Phaser.GameObjects.Graphics;

  // Real-time Tool Need Indicator
  private needIndicatorContainer: Phaser.GameObjects.Container;
  private needIndicatorBg: Phaser.GameObjects.Graphics;
  private needIndicatorText: Phaser.GameObjects.Text;
  private needPulseTween: Phaser.Tweens.Tween | null = null;
  private currentSelectedTool: ToolType | null = null;

  private currentDirection = 0; // default facing South / front towards camera
  private wanderTarget: Phaser.Math.Vector2 | null = null;
  private wanderTimer = 0;
  private bounds: Phaser.Geom.Rectangle;
  private lastInteractionTimestamp = 0;

  constructor(scene: Phaser.Scene, cat: Cat, x: number, y: number, bounds: Phaser.Geom.Rectangle) {
    super(scene, x, y);
    this.cat = cat;
    this.bounds = bounds;

    const scale = getScaleForStage(cat.stage);

    // 1. Soft Shadow
    this.shadow = scene.add.graphics();
    this.shadow.fillStyle(0x354a21, 0.22);
    this.shadow.fillEllipse(0, 18 * (scale / BASE_SPRITE_SCALE), 32 * (scale / BASE_SPRITE_SCALE), 12 * (scale / BASE_SPRITE_SCALE));
    this.add(this.shadow);

    // 2. Hover / Focus Ring (appears on hover or when tool is selected)
    this.hoverGfx = scene.add.graphics();
    this.hoverGfx.setAlpha(0);
    this.add(this.hoverGfx);

    // 3. Aura Glow for Rare Cats (Ghost, Gold, Radioactive)
    if (cat.isRare || cat.color === 'ghost_0' || cat.color === 'gold_0' || cat.color === 'radioactive_0') {
      const aura = scene.add.graphics();
      let auraColor = 0xffe66d;
      let auraAlpha = 0.25;

      if (cat.color === 'ghost_0' || cat.rareType === 'ghost') {
        auraColor = 0xcfe2f3;
        auraAlpha = 0.35;
      } else if (cat.color === 'radioactive_0' || cat.rareType === 'radioactive') {
        auraColor = 0x55ff55;
        auraAlpha = 0.3;
      }

      aura.fillStyle(auraColor, auraAlpha);
      aura.fillCircle(0, 4, 24 * (scale / BASE_SPRITE_SCALE));
      this.add(aura);

      scene.tweens.add({
        targets: aura,
        scaleX: 1.25,
        scaleY: 1.25,
        alpha: auraAlpha * 0.5,
        duration: 1500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // 4. Base Cat Sprite
    const baseKey = `cat_${cat.color}`;
    this.baseSprite = scene.add.sprite(0, 0, baseKey);
    this.baseSprite.setScale(scale);

    if (cat.color === 'ghost_0' || cat.rareType === 'ghost') {
      this.baseSprite.setAlpha(0.82);
    }

    this.add(this.baseSprite);

    // 5. Marking Overlay Sprite (if any)
    if (cat.marking) {
      const markingKey = `marking_${cat.marking}`;
      if (scene.textures.exists(markingKey)) {
        this.markingSprite = scene.add.sprite(0, 0, markingKey);
        this.markingSprite.setScale(scale);
        if (cat.color === 'ghost_0' || cat.rareType === 'ghost') {
          this.markingSprite.setAlpha(0.82);
        }
        this.add(this.markingSprite);
      }
    }

    // 6. Dirt indicator for low cleanliness
    this.dirtGfx = scene.add.graphics();
    this.add(this.dirtGfx);

    // 7. Name Label & Life Stage indicator
    const prefix = cat.isRare ? '✨ ' : '';
    const stageEmoji = cat.stage === 'kitten' ? '🐾' : cat.stage === 'teen' ? '🌱' : '';
    const labelText = stageEmoji ? `${prefix}${cat.name} ${stageEmoji}` : `${prefix}${cat.name}`;

    this.nameLabel = scene.add.text(0, 24 * (scale / BASE_SPRITE_SCALE), labelText, {
      fontFamily: '"Nunito", "Segoe UI", sans-serif',
      fontSize: cat.stage === 'kitten' ? '10px' : '12px',
      fontStyle: 'bold',
      color: '#463220',
      backgroundColor: 'rgba(255, 255, 255, 0.86)',
      padding: { left: 6, right: 6, top: 2, bottom: 2 },
    }).setOrigin(0.5, 0);
    this.add(this.nameLabel);

    // 8. Sleep Zzz Text
    this.sleepZzz = scene.add.text(12, -26 * (scale / BASE_SPRITE_SCALE), '💤', {
      fontSize: '14px',
    }).setOrigin(0.5, 1).setAlpha(0);
    this.add(this.sleepZzz);

    // 9. Floating Need Bubble Indicator for Selected Tool
    this.needIndicatorContainer = scene.add.container(0, -32 * (scale / BASE_SPRITE_SCALE));
    this.needIndicatorContainer.setAlpha(0);

    this.needIndicatorBg = scene.add.graphics();
    this.needIndicatorContainer.add(this.needIndicatorBg);

    this.needIndicatorText = scene.add.text(0, 0, '', {
      fontFamily: '"Nunito", "Segoe UI", sans-serif',
      fontSize: '11px',
      fontStyle: 'bold',
      color: '#ffffff',
    }).setOrigin(0.5, 0.5);
    this.needIndicatorContainer.add(this.needIndicatorText);

    this.add(this.needIndicatorContainer);

    // Setup bounds and comfortable interaction area
    this.setSize(HIT_RADIUS * 2, HIT_RADIUS * 2);
    this.setInteractive(
      new Phaser.Geom.Circle(0, 4, HIT_RADIUS),
      Phaser.Geom.Circle.Contains,
    );

    // Hover visual feedback
    this.on('pointerover', () => {
      this.drawHoverRing(true);
    });

    this.on('pointerout', () => {
      this.drawHoverRing(false);
    });

    // Set initial animation
    this.playCurrentAnimation();
    this.updateDirtGfx();

    scene.add.existing(this);
  }

  private drawHoverRing(isHovered: boolean): void {
    this.hoverGfx.clear();
    if (isHovered || this.currentSelectedTool) {
      const scale = getScaleForStage(this.cat.stage);
      const r = HIT_RADIUS * (scale / BASE_SPRITE_SCALE);
      this.hoverGfx.lineStyle(2, 0xff758f, isHovered ? 0.9 : 0.4);
      this.hoverGfx.strokeCircle(0, 4, r);
      this.hoverGfx.fillStyle(0xff758f, isHovered ? 0.12 : 0.04);
      this.hoverGfx.fillCircle(0, 4, r);
      this.hoverGfx.setAlpha(1);
    } else {
      this.hoverGfx.setAlpha(0);
    }
  }

  /**
   * Sets the active tool to show or hide the real-time Need Indicator
   */
  setSelectedTool(tool: ToolType | null): void {
    this.currentSelectedTool = tool;
    this.updateNeedIndicator();
    this.drawHoverRing(false);
  }

  /**
   * Updates the Need Bubble badge based on current needs and selected tool
   */
  updateNeedIndicator(): void {
    if (!this.currentSelectedTool) {
      if (this.needPulseTween) {
        this.needPulseTween.stop();
        this.needPulseTween = null;
      }
      this.scene.tweens.add({
        targets: this.needIndicatorContainer,
        alpha: 0,
        scaleX: 0.7,
        scaleY: 0.7,
        duration: 160,
        ease: 'Quad.easeOut',
      });
      return;
    }

    let badgeText = '';
    let bgColor = 0x4d3827;
    let borderColor = 0xffffff;
    let isUrgent = false;

    switch (this.currentSelectedTool) {
      case 'food': {
        const val = Math.round(this.cat.hunger);
        if (val < 50) {
          badgeText = `🥣 Hungry (${val}%)`;
          bgColor = 0xe63946;
          borderColor = 0xffb4a2;
          isUrgent = true;
        } else if (val < 85) {
          badgeText = `🐟 ${val}%`;
          bgColor = 0xf4a261;
          borderColor = 0xffe8d6;
        } else {
          badgeText = `😋 Full (${val}%)`;
          bgColor = 0x52b788;
          borderColor = 0xd8f3dc;
        }
        break;
      }
      case 'pet': {
        const val = Math.round(this.cat.affection);
        if (val < 50) {
          badgeText = `💖 Wants Pet (${val}%)`;
          bgColor = 0xd81159;
          borderColor = 0xffcbf2;
          isUrgent = true;
        } else if (val < 85) {
          badgeText = `❤️ ${val}%`;
          bgColor = 0xff758f;
          borderColor = 0xffe5ec;
        } else {
          badgeText = `😻 Adored (${val}%)`;
          bgColor = 0x8338ec;
          borderColor = 0xe0aaff;
        }
        break;
      }
      case 'brush': {
        const val = Math.round(this.cat.cleanliness);
        if (val < 50) {
          badgeText = `✨ Brush Me (${val}%)`;
          bgColor = 0xd97706;
          borderColor = 0xfde68a;
          isUrgent = true;
        } else if (val < 85) {
          badgeText = `🪮 ${val}%`;
          bgColor = 0x10b981;
          borderColor = 0xa7f3d0;
        } else {
          badgeText = `✨ Sleek (${val}%)`;
          bgColor = 0x06b6d4;
          borderColor = 0xcffafe;
        }
        break;
      }
      case 'toy': {
        const val = Math.round(this.cat.fun);
        if (val < 50) {
          badgeText = `🧶 Bored (${val}%)`;
          bgColor = 0xca8a04;
          borderColor = 0xfef08a;
          isUrgent = true;
        } else if (val < 85) {
          badgeText = `🎾 ${val}%`;
          bgColor = 0xeab308;
          borderColor = 0xfef9c3;
        } else {
          badgeText = `🎉 Playful (${val}%)`;
          bgColor = 0x9333ea;
          borderColor = 0xf3e8ff;
        }
        break;
      }
      case 'wash': {
        const val = Math.round(this.cat.cleanliness);
        if (val < 45) {
          badgeText = `🫧 Needs Bath (${val}%)`;
          bgColor = 0x0284c7;
          borderColor = 0xbae6fd;
          isUrgent = true;
        } else {
          badgeText = `✨ Clean (${val}%)`;
          bgColor = 0x14b8a6;
          borderColor = 0xccfbf1;
        }
        break;
      }
    }

    this.needIndicatorText.setText(badgeText);
    const textBounds = this.needIndicatorText.getBounds();
    const padX = 8;
    const padY = 4;
    const w = Math.max(48, textBounds.width + padX * 2);
    const h = Math.max(20, textBounds.height + padY * 2);

    this.needIndicatorBg.clear();
    // Shadow
    this.needIndicatorBg.fillStyle(0x000000, 0.25);
    this.needIndicatorBg.fillRoundedRect(-w / 2 + 1, -h / 2 + 2, w, h, 10);
    // Background
    this.needIndicatorBg.fillStyle(bgColor, 0.95);
    this.needIndicatorBg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    // Border
    this.needIndicatorBg.lineStyle(1.5, borderColor, 0.95);
    this.needIndicatorBg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);

    // Show indicator
    this.scene.tweens.add({
      targets: this.needIndicatorContainer,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 200,
      ease: 'Back.easeOut',
    });

    if (isUrgent && !this.needPulseTween) {
      this.needPulseTween = this.scene.tweens.add({
        targets: this.needIndicatorContainer,
        scaleX: 1.14,
        scaleY: 1.14,
        duration: 450,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else if (!isUrgent && this.needPulseTween) {
      this.needPulseTween.stop();
      this.needPulseTween = null;
      this.needIndicatorContainer.setScale(1);
    }
  }

  /**
   * Helper to check if swipe/drag care can interact (debounce)
   */
  canInteract(nowMs: number): boolean {
    return nowMs - this.lastInteractionTimestamp > 350;
  }

  recordInteraction(nowMs: number): void {
    this.lastInteractionTimestamp = nowMs;
  }

  /**
   * Spawns a floating emote above the cat
   */
  showEmote(emoji: string): void {
    const scale = getScaleForStage(this.cat.stage);
    const text = this.scene.add.text(this.x, this.y - 20, emoji, {
      fontSize: '24px',
    }).setOrigin(0.5, 1).setDepth(100);

    this.scene.tweens.add({
      targets: text,
      y: this.y - 64,
      alpha: { from: 1, to: 0 },
      scale: { from: 0.8, to: 1.4 },
      duration: 1200,
      ease: 'Cubic.easeOut',
      onComplete: () => text.destroy(),
    });

    // Gentle bounce squish on the cat sprite
    this.scene.tweens.add({
      targets: [this.baseSprite, this.markingSprite].filter(Boolean),
      scaleY: scale * 0.82,
      scaleX: scale * 1.18,
      duration: 120,
      yoyo: true,
      ease: 'Quad.easeInOut',
    });

    // Update need bubble immediately
    this.updateNeedIndicator();
  }

  private playCurrentAnimation(): void {
    const animState = this.cat.animationState;
    const dir = this.currentDirection;
    const baseKey = `cat_${this.cat.color}_${animState}_${dir}`;

    if (this.scene.anims.exists(baseKey)) {
      this.baseSprite.play(baseKey, true);
    }

    if (this.markingSprite && this.cat.marking) {
      const markingKey = `marking_${this.cat.marking}_${animState}_${dir}`;
      if (this.scene.anims.exists(markingKey)) {
        this.markingSprite.play(markingKey, true);
      }
    }

    // Toggle sleep Zzz
    if (animState === 'sleep') {
      this.sleepZzz.setAlpha(1);
    } else {
      this.sleepZzz.setAlpha(0);
    }
  }

  private updateDirtGfx(): void {
    this.dirtGfx.clear();
    if (this.cat.cleanliness < 40) {
      const scale = getScaleForStage(this.cat.stage);
      this.dirtGfx.fillStyle(0x6b4f2c, 0.7);
      this.dirtGfx.fillCircle(-6 * (scale / BASE_SPRITE_SCALE), -4 * (scale / BASE_SPRITE_SCALE), 3);
      this.dirtGfx.fillCircle(8 * (scale / BASE_SPRITE_SCALE), 2 * (scale / BASE_SPRITE_SCALE), 2.5);
      this.dirtGfx.fillCircle(2 * (scale / BASE_SPRITE_SCALE), -12 * (scale / BASE_SPRITE_SCALE), 2);
    }
  }

  update(deltaMs: number): void {
    const dt = deltaMs / 1000;

    // Check Sleep / Wake cycle
    if (this.cat.animationState !== 'sleep' && shouldFallAsleep(this.cat)) {
      this.cat.animationState = 'sleep';
      this.wanderTarget = null;
      this.playCurrentAnimation();
      return;
    }

    if (this.cat.animationState === 'sleep') {
      if (shouldWakeUp(this.cat)) {
        this.cat.animationState = 'sit';
        this.playCurrentAnimation();
      }
      return;
    }

    // Wander timer
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.pickNewWanderTarget();
    }

    if (this.wanderTarget) {
      const isZoomie = this.cat.majorTrait === 'zoomie' || this.cat.minorTrait === 'zoomie';
      const isKitten = this.cat.stage === 'kitten';
      const isTeen = this.cat.stage === 'teen';

      const baseSpeed = this.cat.animationState === 'run' ? 88 : 34;
      const speedMultiplier = (isZoomie ? 1.35 : 1.0) * (isKitten ? 1.25 : isTeen ? 1.15 : 1.0);
      const speed = baseSpeed * speedMultiplier * dt;

      const dx = this.wanderTarget.x - this.x;
      const dy = this.wanderTarget.y - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 6) {
        this.wanderTarget = null;
        // Randomize idle state
        const roll = Math.random();
        if (roll < 0.4) {
          this.cat.animationState = 'sit';
        } else if (roll < 0.75) {
          this.cat.animationState = 'look';
        } else {
          this.cat.animationState = 'lay';
        }
        this.wanderTimer = (isKitten ? 2 : 3) + Math.random() * 3.5;
        this.playCurrentAnimation();
      } else {
        const stepX = (dx / dist) * speed;
        const stepY = (dy / dist) * speed;
        this.x += stepX;
        this.y += stepY;

        this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
        this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);

        const newDir = vectorToDirection(dx, dy);
        if (newDir !== this.currentDirection) {
          this.currentDirection = newDir;
          this.playCurrentAnimation();
        }
      }
    }

    this.setDepth(this.y);
  }

  private pickNewWanderTarget(): void {
    const isKitten = this.cat.stage === 'kitten';
    const isTeen = this.cat.stage === 'teen';

    const idleChance = isKitten ? 0.25 : 0.38;
    if (Math.random() < idleChance) {
      this.wanderTarget = null;
      this.cat.animationState = Math.random() < 0.6 ? 'sit' : 'look';
      this.wanderTimer = 2.0 + Math.random() * 3.0;
      this.playCurrentAnimation();
      return;
    }

    const isZoomie = this.cat.majorTrait === 'zoomie' || this.cat.minorTrait === 'zoomie';
    const runRoll = isKitten
      ? Math.random() < 0.45
      : isTeen
        ? Math.random() < 0.35
        : (isZoomie && Math.random() < 0.4) || Math.random() < 0.12;

    this.wanderTarget = new Phaser.Math.Vector2(
      Phaser.Math.Between(this.bounds.left + 24, this.bounds.right - 24),
      Phaser.Math.Between(this.bounds.top + 24, this.bounds.bottom - 24),
    );

    this.cat.animationState = runRoll ? 'run' : 'walk';
    this.currentDirection = vectorToDirection(this.wanderTarget.x - this.x, this.wanderTarget.y - this.y);
    this.wanderTimer = 6.5;
    this.playCurrentAnimation();
  }

  setAreaBounds(bounds: Phaser.Geom.Rectangle): void {
    this.bounds = bounds;
  }

  refreshVisuals(): void {
    const scale = getScaleForStage(this.cat.stage);
    this.baseSprite.setScale(scale);
    if (this.markingSprite) this.markingSprite.setScale(scale);

    const prefix = this.cat.isRare ? '✨ ' : '';
    const stageEmoji = this.cat.stage === 'kitten' ? '🐾' : this.cat.stage === 'teen' ? '🌱' : '';
    this.nameLabel.setText(stageEmoji ? `${prefix}${this.cat.name} ${stageEmoji}` : `${prefix}${this.cat.name}`);

    this.updateDirtGfx();
    this.updateNeedIndicator();
    this.playCurrentAnimation();
  }
}
