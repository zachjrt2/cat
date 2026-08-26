import Phaser from 'phaser';
import type { Cat, LifeStage, ToolType } from '../data/types';
import { shouldFallAsleep, shouldWakeUp } from '../systems/NeedsSystem';

const BASE_SPRITE_SCALE = 2.2;

/** Per-stage hit radius in PIXELS (unscaled — the sprite handles its own scale). */
function getHitRadius(stage?: LifeStage): number {
  switch (stage) {
    case 'kitten': return 18;
    case 'teen':   return 24;
    case 'adult':
    default:       return 30;
  }
}

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

  // Real-time Tool Need Mini Bar Indicator
  private needIndicatorContainer: Phaser.GameObjects.Container;
  private needIndicatorGfx: Phaser.GameObjects.Graphics;
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

    // 9. Floating Need Mini Bar Indicator for Selected Tool (No text, sleek bar)
    this.needIndicatorContainer = scene.add.container(0, -22 * (scale / BASE_SPRITE_SCALE));
    this.needIndicatorContainer.setAlpha(0);

    this.needIndicatorGfx = scene.add.graphics();
    this.needIndicatorContainer.add(this.needIndicatorGfx);

    this.add(this.needIndicatorContainer);

    // Make the base sprite interactive — avoids Container coordinate-transform quirks.
    // Pointer events are forwarded up to the Container so scene code works unchanged.
    const hitR = getHitRadius(cat.stage);
    this.baseSprite.setInteractive(
      new Phaser.Geom.Circle(0, 0, hitR),
      Phaser.Geom.Circle.Contains,
    );

    this.baseSprite.on('pointerover', () => this.emit('pointerover'));
    this.baseSprite.on('pointerout',  () => this.emit('pointerout'));
    this.baseSprite.on('pointerdown', (ptr: Phaser.Input.Pointer) => this.emit('pointerdown', ptr));

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
      const r = getHitRadius(this.cat.stage);
      this.hoverGfx.lineStyle(2, 0xff758f, isHovered ? 0.9 : 0.4);
      this.hoverGfx.strokeCircle(0, 0, r);
      this.hoverGfx.fillStyle(0xff758f, isHovered ? 0.12 : 0.04);
      this.hoverGfx.fillCircle(0, 0, r);
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
   * Updates the Need Mini Bar based on current needs and selected tool
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

    let val = 100;
    switch (this.currentSelectedTool) {
      case 'food':
        val = this.cat.hunger;
        break;
      case 'pet':
        val = this.cat.affection;
        break;
      case 'brush':
        val = this.cat.cleanliness;
        break;
      case 'toy':
        val = this.cat.fun;
        break;
      case 'wash':
        val = this.cat.cleanliness;
        break;
    }

    const pct = Math.max(0, Math.min(100, val)) / 100;
    const barWidth = 28;
    const barHeight = 5;
    const radius = 2.5;

    let fillColor = 0x10b981; // Green
    let isUrgent = false;

    if (val < 40) {
      fillColor = 0xef4444; // Coral Red
      isUrgent = true;
    } else if (val < 75) {
      fillColor = 0xf59e0b; // Warm Amber
    }

    this.needIndicatorGfx.clear();

    // Drop shadow
    this.needIndicatorGfx.fillStyle(0x000000, 0.35);
    this.needIndicatorGfx.fillRoundedRect(-barWidth / 2, -barHeight / 2 + 1, barWidth, barHeight, radius);

    // Dark track background
    this.needIndicatorGfx.fillStyle(0x1a1a24, 0.82);
    this.needIndicatorGfx.fillRoundedRect(-barWidth / 2, -barHeight / 2, barWidth, barHeight, radius);

    // Track border
    this.needIndicatorGfx.lineStyle(1, 0xffffff, 0.35);
    this.needIndicatorGfx.strokeRoundedRect(-barWidth / 2, -barHeight / 2, barWidth, barHeight, radius);

    // Inner progress fill
    const innerW = (barWidth - 2) * pct;
    if (innerW > 1) {
      this.needIndicatorGfx.fillStyle(fillColor, 0.95);
      this.needIndicatorGfx.fillRoundedRect(-barWidth / 2 + 1, -barHeight / 2 + 1, innerW, barHeight - 2, 1.5);
    }

    // Show indicator
    this.scene.tweens.add({
      targets: this.needIndicatorContainer,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 180,
      ease: 'Quad.easeOut',
    });

    if (isUrgent && !this.needPulseTween) {
      this.needPulseTween = this.scene.tweens.add({
        targets: this.needIndicatorContainer,
        scaleX: 1.15,
        scaleY: 1.15,
        duration: 500,
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

    // If currently playing, count down the play timer instead of wandering
    if (this.cat.animationState === 'play') {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        // Transition out of play into a calm idle state
        const roll = Math.random();
        if (roll < 0.5) {
          this.cat.animationState = 'sit';
        } else if (roll < 0.8) {
          this.cat.animationState = 'look';
        } else {
          this.cat.animationState = 'lay';
        }
        this.wanderTimer = 2.0 + Math.random() * 2.5;
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
        // Randomize idle state on arrival — all 4 idles weighted appropriately
        const isMischievous = this.cat.majorTrait === 'mischievous' || this.cat.minorTrait === 'mischievous';
        const isCuddler = this.cat.majorTrait === 'cuddler' || this.cat.minorTrait === 'cuddler';
        const hasFun = this.cat.fun > 60;

        // Spontaneous play chance when fun is high or personality traits suggest it
        const playchance = (isMischievous ? 0.25 : 0) + (isKitten ? 0.2 : isTeen ? 0.1 : 0) + (hasFun ? 0.12 : 0);
        const roll = Math.random();

        if (roll < playchance) {
          this.cat.animationState = 'play';
          this.wanderTimer = 1.8 + Math.random() * 2.0; // play for 1.8–3.8s
        } else if (roll < playchance + 0.32) {
          this.cat.animationState = 'sit';
          this.wanderTimer = (isKitten ? 2 : 3) + Math.random() * 3.5;
        } else if (roll < playchance + 0.58) {
          this.cat.animationState = 'look';
          this.wanderTimer = 2.0 + Math.random() * 3.0;
        } else if (roll < playchance + 0.8) {
          // lay — cats that are calm/cuddler/lazy rest more
          this.cat.animationState = 'lay';
          const layBonus = isCuddler || this.cat.majorTrait === 'lazy' || this.cat.minorTrait === 'lazy' ? 1.5 : 1.0;
          this.wanderTimer = (2.5 + Math.random() * 3.0) * layBonus;
        } else {
          this.cat.animationState = 'sit';
          this.wanderTimer = (isKitten ? 2 : 3) + Math.random() * 2.0;
        }
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
    const isMischievous = this.cat.majorTrait === 'mischievous' || this.cat.minorTrait === 'mischievous';
    const isCuddler = this.cat.majorTrait === 'cuddler' || this.cat.minorTrait === 'cuddler';

    // Spontaneous play burst for mischievous cats / kittens when fun is decent
    const funBoost = this.cat.fun > 50;
    const spontaneousPlay = (isMischievous && funBoost && Math.random() < 0.2)
      || (isKitten && funBoost && Math.random() < 0.15);

    if (spontaneousPlay) {
      this.wanderTarget = null;
      this.cat.animationState = 'play';
      this.wanderTimer = 1.5 + Math.random() * 2.5;
      this.playCurrentAnimation();
      return;
    }

    // Idle chance: weighted to include lay for cuddler/lazy cats
    const idleChance = isKitten ? 0.22 : 0.38;
    if (Math.random() < idleChance) {
      this.wanderTarget = null;

      const lazyIdle = isCuddler || this.cat.majorTrait === 'lazy' || this.cat.minorTrait === 'lazy';
      const r = Math.random();
      if (r < 0.45) {
        this.cat.animationState = 'sit';
      } else if (r < 0.75) {
        this.cat.animationState = 'look';
      } else {
        // lay is now reachable here too — more likely for lazy/cuddler cats
        this.cat.animationState = lazyIdle && Math.random() < 0.6 ? 'lay' : 'sit';
      }
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
