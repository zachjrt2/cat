import Phaser from 'phaser';
import type { Cat, LifeStage, ToolType } from '../data/types';
import { shouldFallAsleep, shouldWakeUp } from '../systems/NeedsSystem';
import { sound } from '../systems/SoundManager';

const BASE_SPRITE_SCALE = 2.2;

/** Per-stage hit radius in PIXELS (unscaled 32x32 sprite frame space). */
function getHitRadius(stage?: LifeStage): number {
  switch (stage) {
    case 'kitten': return 14;
    case 'teen':   return 15;
    case 'adult':
    default:       return 16;
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

export interface AvailableMachineInfo {
  id: string;
  needType: string;
  x: number;
  y: number;
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

  // Ambient meow timer: random interval 50–200s (staggered per cat)
  private ambientMeowTimer = 50 + Math.random() * 150;
  // Track which needs were at 0 last tick to avoid spamming
  private hungryAlerted = false;
  // Chirp cooldown for play state
  private chirpCooldown = 0;
  // Breed-ready heart emote timer (adults only)
  private breedReadyHeartTimer = 15 + Math.random() * 15;
  private isBreedReady = false;
  private crowdCheckTimer = 1.0 + Math.random() * 2.0;

  // AI & Social Interaction Support
  private targetMachineId: string | null = null;
  private availableMachines: AvailableMachineInfo[] = [];
  private otherSpritesProvider: (() => CatSprite[]) | null = null;
  private machineUseCallback: ((cat: Cat, machineId: string) => void) | null = null;
  private chaseTarget: { x: number; y: number } | null = null;

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

    // 2. Hover / Focus Ring
    this.hoverGfx = scene.add.graphics();
    this.hoverGfx.setAlpha(0);
    this.add(this.hoverGfx);

    // 3. Aura Glow
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

    // 5. Marking Overlay
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

    // 6. Dirt
    this.dirtGfx = scene.add.graphics();
    this.add(this.dirtGfx);

    // 7. Name Label
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

    // 8. Sleep Zzz
    this.sleepZzz = scene.add.text(12, -26 * (scale / BASE_SPRITE_SCALE), '💤', {
      fontSize: '14px',
    }).setOrigin(0.5, 1).setAlpha(0);
    this.add(this.sleepZzz);

    // 9. Floating Need Mini Bar
    this.needIndicatorContainer = scene.add.container(0, -22 * (scale / BASE_SPRITE_SCALE));
    this.needIndicatorContainer.setAlpha(0);
    this.needIndicatorGfx = scene.add.graphics();
    this.needIndicatorContainer.add(this.needIndicatorGfx);
    this.add(this.needIndicatorContainer);

    // Precision Hit Detection
    const hitR = getHitRadius(cat.stage);
    this.baseSprite.setInteractive(
      new Phaser.Geom.Circle(16, 18, hitR),
      Phaser.Geom.Circle.Contains,
    );

    this.baseSprite.on('pointerover', () => this.emit('pointerover'));
    this.baseSprite.on('pointerout',  () => this.emit('pointerout'));
    this.baseSprite.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      this.emit('pointerdown', ptr);
      this.emit('cat-pointerdown', ptr);
    });

    this.on('pointerover', () => this.drawHoverRing(true));
    this.on('pointerout', () => this.drawHoverRing(false));

    this.playCurrentAnimation();
    this.updateDirtGfx();

    scene.add.existing(this);
  }

  private isDragged = false;

  setDragged(dragged: boolean): void {
    this.isDragged = dragged;
    if (dragged) {
      this.wanderTarget = null;
      this.setDepth(9999);
      this.scene.tweens.killTweensOf(this);
      this.scene.tweens.add({
        targets: this,
        scaleX: 1.18,
        scaleY: 1.18,
        duration: 120,
        ease: 'Back.easeOut',
      });
      this.shadow.setAlpha(0.12);
      this.shadow.setScale(0.8);
    } else {
      this.setDepth(this.y);
      this.scene.tweens.add({
        targets: this,
        scaleX: 1,
        scaleY: 1,
        duration: 150,
        ease: 'Quad.easeOut',
      });
      this.shadow.setAlpha(1);
      this.shadow.setScale(1);
      this.wanderTimer = 1.5;
    }
  }

  isCurrentlyDragged(): boolean {
    return this.isDragged;
  }

  highlightAsDropTarget(isTarget: boolean): void {
    this.hoverGfx.clear();
    if (isTarget) {
      const scale = getScaleForStage(this.cat.stage);
      const r = (getHitRadius(this.cat.stage) + 8) * scale;
      const centerY = 4.4 * (scale / BASE_SPRITE_SCALE);
      this.hoverGfx.lineStyle(3, 0xff007f, 1);
      this.hoverGfx.strokeCircle(0, centerY, r);
      this.hoverGfx.fillStyle(0xff758f, 0.35);
      this.hoverGfx.fillCircle(0, centerY, r);
      this.hoverGfx.setAlpha(1);
    } else {
      this.hoverGfx.setAlpha(0);
    }
  }

  /**
   * Highlights this adult cat as an eligible breeding partner when another adult cat is picked up.
   * If isReady is true, highlights with a bright romantic glow.
   */
  setBreedingPartnerHighlight(isPartner: boolean, isReady: boolean): void {
    this.hoverGfx.clear();
    if (isPartner) {
      const scale = getScaleForStage(this.cat.stage);
      const r = (getHitRadius(this.cat.stage) + 6) * scale;
      const centerY = 4.4 * (scale / BASE_SPRITE_SCALE);

      if (isReady) {
        this.hoverGfx.lineStyle(3, 0xff3377, 0.95);
        this.hoverGfx.strokeCircle(0, centerY, r);
        this.hoverGfx.fillStyle(0xff6699, 0.22);
        this.hoverGfx.fillCircle(0, centerY, r);
      } else {
        this.hoverGfx.lineStyle(2, 0xf59e0b, 0.75);
        this.hoverGfx.strokeCircle(0, centerY, r);
        this.hoverGfx.fillStyle(0xf59e0b, 0.12);
        this.hoverGfx.fillCircle(0, centerY, r);
      }
      this.hoverGfx.setAlpha(1);
    } else {
      this.hoverGfx.setAlpha(0);
    }
  }

  /**
   * Displays breeding readiness using a progress bar above the cat.
   * Empty/filling bar = pair is cooling down, full bar = ready to breed!
   */
  showBreedingReadinessBar(progressRatio: number, isReady: boolean): void {
    const pct = Math.max(0, Math.min(1, progressRatio));
    const barW = 32;
    const barH = 6;
    const radius = 3;

    this.needIndicatorGfx.clear();
    // Background shadow & border
    this.needIndicatorGfx.fillStyle(0x000000, 0.55);
    this.needIndicatorGfx.fillRoundedRect(-barW / 2, -barH / 2 + 1, barW, barH, radius);
    this.needIndicatorGfx.fillStyle(0x1a1a24, 0.9);
    this.needIndicatorGfx.fillRoundedRect(-barW / 2, -barH / 2, barW, barH, radius);

    // Fill color
    let fillColor = 0xf59e0b; // Amber while cooling down
    if (isReady || pct >= 0.99) {
      fillColor = 0x10b981; // Vibrant emerald when ready
    } else if (pct > 0.5) {
      fillColor = 0x38bdf8; // Sky blue intermediate
    }

    const fillW = Math.max(2, (barW - 2) * pct);
    this.needIndicatorGfx.fillStyle(fillColor, 1);
    this.needIndicatorGfx.fillRoundedRect(-barW / 2 + 1, -barH / 2 + 1, fillW, barH - 2, radius - 1);
    this.needIndicatorGfx.lineStyle(1, isReady ? 0xffe066 : 0xffffff, isReady ? 0.8 : 0.4);
    this.needIndicatorGfx.strokeRoundedRect(-barW / 2, -barH / 2, barW, barH, radius);

    this.scene.tweens.add({
      targets: this.needIndicatorContainer,
      alpha: 1,
      scaleX: isReady ? 1.1 : 1.0,
      scaleY: isReady ? 1.1 : 1.0,
      duration: 150,
      ease: 'Quad.easeOut',
    });
  }

  clearBreedingReadinessBar(): void {
    if (this.currentSelectedTool) {
      this.updateNeedIndicator();
    } else {
      this.hoverGfx.clear();
      this.hoverGfx.setAlpha(0);
      this.scene.tweens.add({
        targets: this.needIndicatorContainer,
        alpha: 0,
        scaleX: 0.7,
        scaleY: 0.7,
        duration: 150,
        ease: 'Quad.easeOut',
      });
    }
  }

  private drawHoverRing(isHovered: boolean): void {
    if (this.isDragged) return;
    this.hoverGfx.clear();
    if (isHovered || this.currentSelectedTool) {
      const scale = getScaleForStage(this.cat.stage);
      const r = getHitRadius(this.cat.stage) * scale;
      const centerY = 4.4 * (scale / BASE_SPRITE_SCALE);
      this.hoverGfx.lineStyle(2, 0xff758f, isHovered ? 0.9 : 0.4);
      this.hoverGfx.strokeCircle(0, centerY, r);
      this.hoverGfx.fillStyle(0xff758f, isHovered ? 0.12 : 0.04);
      this.hoverGfx.fillCircle(0, centerY, r);
      this.hoverGfx.setAlpha(1);
    } else {
      this.hoverGfx.setAlpha(0);
    }
  }


  setSelectedTool(tool: ToolType | null): void {
    this.currentSelectedTool = tool;
    this.updateNeedIndicator();
    this.drawHoverRing(false);
  }

  updateNeedIndicator(): void {
    if (!this.currentSelectedTool) {
      if (this.needPulseTween) { this.needPulseTween.stop(); this.needPulseTween = null; }
      this.scene.tweens.add({ targets: this.needIndicatorContainer, alpha: 0, scaleX: 0.7, scaleY: 0.7, duration: 160, ease: 'Quad.easeOut' });
      return;
    }

    let val = 100;
    switch (this.currentSelectedTool) {
      case 'food': val = this.cat.hunger; break;
      case 'pet': val = this.cat.affection; break;
      case 'brush': case 'wash': val = this.cat.cleanliness; break;
      case 'toy': val = this.cat.fun; break;
    }

    const pct = Math.max(0, Math.min(100, val)) / 100;
    const barW = 28;
    const barH = 5;
    const radius = 2.5;

    this.needIndicatorGfx.clear();
    this.needIndicatorGfx.fillStyle(0x000000, 0.45);
    this.needIndicatorGfx.fillRoundedRect(-barW / 2, -barH / 2 + 1, barW, barH, radius);
    this.needIndicatorGfx.fillStyle(0x222222, 0.85);
    this.needIndicatorGfx.fillRoundedRect(-barW / 2, -barH / 2, barW, barH, radius);

    let fillColor = 0x52b788;
    if (pct < 0.40) fillColor = 0xff5a5f;
    else if (pct < 0.75) fillColor = 0xf4a261;

    const fillW = Math.max(2, (barW - 2) * pct);
    this.needIndicatorGfx.fillStyle(fillColor, 0.95);
    this.needIndicatorGfx.fillRoundedRect(-barW / 2 + 1, -barH / 2 + 1, fillW, barH - 2, radius - 1);
    this.needIndicatorGfx.lineStyle(1, 0xffffff, 0.35);
    this.needIndicatorGfx.strokeRoundedRect(-barW / 2, -barH / 2, barW, barH, radius);

    this.scene.tweens.add({ targets: this.needIndicatorContainer, alpha: 1, scaleX: 1, scaleY: 1, duration: 180, ease: 'Quad.easeOut' });
    if (pct < 0.35 && !this.needPulseTween) {
      this.needPulseTween = this.scene.tweens.add({ targets: this.needIndicatorContainer, scaleX: 1.15, scaleY: 1.15, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    } else if (pct >= 0.35 && this.needPulseTween) {
      this.needPulseTween.stop(); this.needPulseTween = null; this.needIndicatorContainer.setScale(1);
    }
  }

  canInteract(nowMs: number): boolean { return nowMs - this.lastInteractionTimestamp > 350; }
  recordInteraction(nowMs: number): void { this.lastInteractionTimestamp = nowMs; }

  showEmote(emoji: string): void {
    const scale = getScaleForStage(this.cat.stage);
    const text = this.scene.add.text(this.x, this.y - 20, emoji, { fontSize: '24px' }).setOrigin(0.5, 1).setDepth(100);
    this.scene.tweens.add({ targets: text, y: this.y - 64, alpha: { from: 1, to: 0 }, scale: { from: 0.8, to: 1.4 }, duration: 1200, ease: 'Cubic.easeOut', onComplete: () => text.destroy() });
    this.scene.tweens.add({ targets: [this.baseSprite, this.markingSprite].filter(Boolean), scaleY: scale * 0.82, scaleX: scale * 1.18, duration: 120, yoyo: true, ease: 'Quad.easeInOut' });
    this.updateNeedIndicator();
  }

  triggerPlayState(durationSeconds = 3.0): void {
    if (this.cat.animationState === 'sleep') return;
    this.wanderTarget = null;
    this.cat.animationState = 'play';
    this.wanderTimer = durationSeconds;
    this.playCurrentAnimation();
  }

  setAvailableMachines(machines: AvailableMachineInfo[]): void { this.availableMachines = machines; }
  setOtherSpritesProvider(provider: () => CatSprite[]): void { this.otherSpritesProvider = provider; }
  setMachineUseCallback(cb: (cat: Cat, machineId: string) => void): void { this.machineUseCallback = cb; }

  /** Called by SanctuaryScene whenever the breed cooldown state changes for this cat. */
  setBreedReady(ready: boolean): void {
    if (this.isBreedReady === ready) return;
    this.isBreedReady = ready;
    // Reset timer so a heart fires soon after becoming ready again
    if (ready) this.breedReadyHeartTimer = 2 + Math.random() * 4;
  }

  setChaseTarget(x: number, y: number): void {
    if (this.isDragged || this.cat.animationState === 'sleep') return;
    this.chaseTarget = { x, y };
    this.wanderTarget = null;
  }

  clearChaseTarget(): void {
    this.chaseTarget = null;
  }

  isChasing(): boolean {
    return this.chaseTarget !== null;
  }

  slinkAwayFrom(fromX: number, fromY: number, dt: number): void {
    if (this.isDragged || this.cat.animationState === 'sleep') return;
    this.chaseTarget = null;
    this.wanderTarget = null;

    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;

    // Slow, cautious walk away from brush
    const speed = 36 * dt;
    this.x += (dx / dist) * speed;
    this.y += (dy / dist) * speed;

    this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
    this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);

    this.currentDirection = vectorToDirection(dx, dy);
    this.cat.animationState = 'walk';
    this.playCurrentAnimation();
    this.setDepth(this.y);
  }

  private playCurrentAnimation(): void {
    const animState = this.cat.animationState;
    const dir = this.currentDirection;
    const baseKey = `cat_${this.cat.color}_${animState}_${dir}`;
    if (this.scene.anims.exists(baseKey)) this.baseSprite.play(baseKey, true);
    if (this.markingSprite && this.cat.marking) {
      const markingKey = `marking_${this.cat.marking}_${animState}_${dir}`;
      if (this.scene.anims.exists(markingKey)) this.markingSprite.play(markingKey, true);
    }
    this.sleepZzz.setAlpha(animState === 'sleep' ? 1 : 0);
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
    if (this.isDragged) {
      this.setDepth(9999);
      return;
    }
    const dt = deltaMs / 1000;

    // ── Ambient meow timer (every 5–20 s, staggered) ──────────────────────
    this.ambientMeowTimer -= dt;
    if (this.ambientMeowTimer <= 0) {
      this.ambientMeowTimer = 50 + Math.random() * 150;
      if (this.cat.animationState !== 'sleep') {
        if (this.cat.stage === 'kitten') {
          sound.playKittenMeow(false);
        } else {
          sound.playMeow();
        }
      }
    }

    // ── Hungry / distress alert at exactly 0% ─────────────────────────────
    const anyNeedAtZero = this.cat.hunger <= 0 || this.cat.cleanliness <= 0 ||
                          this.cat.affection <= 0 || this.cat.fun <= 0;
    if (anyNeedAtZero && !this.hungryAlerted) {
      this.hungryAlerted = true;
      sound.playHungry();
    } else if (!anyNeedAtZero) {
      this.hungryAlerted = false;
    }

    // ── Chirp cooldown tick ────────────────────────────────────────────────
    if (this.chirpCooldown > 0) this.chirpCooldown -= dt;

    // ── Breed-ready heart emote (adult, not sleeping, cooldown expired) ────
    if (this.isBreedReady && this.cat.stage === 'adult' && this.cat.animationState !== 'sleep') {
      this.breedReadyHeartTimer -= dt;
      if (this.breedReadyHeartTimer <= 0) {
        this.breedReadyHeartTimer = 15 + Math.random() * 15;
        this.showEmote('❤️');
      }
    }

    if (this.cat.animationState !== 'sleep' && shouldFallAsleep(this.cat)) {
      this.cat.animationState = 'sleep';
      this.wanderTarget = null;
      this.targetMachineId = null;
      this.playCurrentAnimation();
      return;
    }
    if (this.cat.animationState === 'sleep') {
      if (shouldWakeUp(this.cat)) { this.cat.animationState = 'sit'; this.playCurrentAnimation(); }
      return;
    }
    if (this.cat.animationState === 'play') {
      this.wanderTimer -= dt;
      // Chirp while playing, roughly every 3-6s
      if (this.chirpCooldown <= 0) {
        this.chirpCooldown = 3 + Math.random() * 3;
        sound.playChirp();
      }
      if (this.wanderTimer <= 0) {
        const roll = Math.random();
        this.cat.animationState = roll < 0.5 ? 'sit' : roll < 0.8 ? 'look' : 'lay';
        this.wanderTimer = 2.0 + Math.random() * 2.5;
        this.playCurrentAnimation();
      }
      return;
    }

    // ── Active Toy Ball Chase ─────────────────────────────────────────────
    if (this.chaseTarget) {
      const dist = Math.hypot(this.chaseTarget.x - this.x, this.chaseTarget.y - this.y);
      if (dist > 12) {
        const speed = (this.cat.stage === 'kitten' ? 140 : 165) * ((this.cat.majorTrait === 'zoomie' || this.cat.minorTrait === 'zoomie') ? 1.4 : 1) * dt;
        this.x += ((this.chaseTarget.x - this.x) / dist) * speed;
        this.y += ((this.chaseTarget.y - this.y) / dist) * speed;
        this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
        this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);
        this.currentDirection = vectorToDirection(this.chaseTarget.x - this.x, this.chaseTarget.y - this.y);
        this.cat.animationState = 'run';
        this.playCurrentAnimation();
      }
      this.setDepth(this.y);
      return;
    }

    // ── Anti-Crowding / Group Dispersion Check ────────────────────────────
    // If 3 or more cats gather in a tight bunch (or 2 stacked within 45px), disperse to open space
    this.crowdCheckTimer -= dt;
    if (this.crowdCheckTimer <= 0) {
      this.crowdCheckTimer = 1.5 + Math.random() * 2.0;
      if (!this.chaseTarget) {
        const crowd = this.getNearbyCrowdInfo(85);
        if (crowd.count >= 2 || (crowd.count >= 1 && this.getNearbyCrowdInfo(45).count >= 1)) {
          // Crowd of 3+ cats (or tightly packed) -> walk away to a spacious area
          this.wanderTarget = this.findLeastCrowdedPosition();
          this.targetMachineId = null;
          this.cat.animationState = 'walk';
          this.wanderTimer = 5.0 + Math.random() * 3.0;
          this.playCurrentAnimation();
        }
      }
    }

    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) this.pickNewWanderTarget();
    if (this.wanderTarget) {
      const dist = Math.hypot(this.wanderTarget.x - this.x, this.wanderTarget.y - this.y);
      if (dist < 8) {
        const reachedMachineId = this.targetMachineId;
        this.wanderTarget = null;
        this.targetMachineId = null;
        if (reachedMachineId && this.machineUseCallback) {
          this.machineUseCallback(this.cat, reachedMachineId);
          this.cat.animationState = 'sit';
          this.wanderTimer = 3.5;
          this.playCurrentAnimation();
          this.showEmote('✨');
          return;
        }
        if (this.cat.stage === 'adult' && this.otherSpritesProvider) {
          const others = this.otherSpritesProvider();
          const nearbyKitten = others.find(o => o !== this && o.cat.stage === 'kitten' && Math.hypot(o.x - this.x, o.y - this.y) < 45 && (o.cat.cleanliness < 75 || o.cat.affection < 75));
          if (nearbyKitten) {
            this.currentDirection = vectorToDirection(nearbyKitten.x - this.x, nearbyKitten.y - this.y);
            this.cat.animationState = 'look';
            this.wanderTimer = 3.0;
            this.playCurrentAnimation();
            nearbyKitten.cat.cleanliness = Math.min(100, nearbyKitten.cat.cleanliness + 25);
            nearbyKitten.cat.affection = Math.min(100, nearbyKitten.cat.affection + 20);
            this.cat.happiness = Math.min(100, this.cat.happiness + 5);
            this.showEmote('👅'); nearbyKitten.showEmote('🥰'); return;
          }
        }
        const roll = Math.random();
        const playChance = (this.cat.majorTrait === 'mischievous' ? 0.25 : 0) + (this.cat.stage === 'kitten' ? 0.2 : this.cat.stage === 'teen' ? 0.1 : 0) + (this.cat.fun > 60 ? 0.12 : 0);
        if (roll < playChance) {
          this.cat.animationState = 'play';
          this.wanderTimer = 1.8 + Math.random() * 2.0;
          if (this.otherSpritesProvider) {
            const friend = this.otherSpritesProvider().find(o => o !== this && o.cat.animationState !== 'sleep' && Math.hypot(o.x - this.x, o.y - this.y) < 65 && (this.cat.friendshipIds[o.cat.id] ?? 0) >= 25);
            if (friend && friend.getNearbyCrowdInfo(65).count <= 1) { friend.triggerPlayState(2.5); friend.showEmote('🎉'); this.showEmote('🧶'); }
          }
        } else {
          this.cat.animationState = roll < playChance + 0.32 ? 'sit' : roll < playChance + 0.58 ? 'look' : 'lay';
          this.wanderTimer = 2.5 + Math.random() * 3.0;
        }
        this.playCurrentAnimation();
      } else {
        const speed = (this.cat.animationState === 'run' ? 88 : 34) * ((this.cat.majorTrait === 'zoomie' || this.cat.minorTrait === 'zoomie') ? 1.35 : 1) * dt;
        this.x += ((this.wanderTarget.x - this.x) / dist) * speed;
        this.y += ((this.wanderTarget.y - this.y) / dist) * speed;
        this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
        this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);
        this.currentDirection = vectorToDirection(this.wanderTarget.x - this.x, this.wanderTarget.y - this.y);
        this.playCurrentAnimation();
      }
    }
    this.setDepth(this.y);
  }

  getNearbyCrowdInfo(radius = 80): { count: number; avgX: number; avgY: number } {
    if (!this.otherSpritesProvider) return { count: 0, avgX: this.x, avgY: this.y };
    const others = this.otherSpritesProvider();
    let count = 0;
    let sumX = 0;
    let sumY = 0;

    for (const o of others) {
      if (o === this || o.isCurrentlyDragged() || o.cat.animationState === 'sleep') continue;
      const d = Math.hypot(o.x - this.x, o.y - this.y);
      if (d < radius) {
        count++;
        sumX += o.x;
        sumY += o.y;
      }
    }

    return {
      count,
      avgX: count > 0 ? sumX / count : this.x,
      avgY: count > 0 ? sumY / count : this.y,
    };
  }

  private findLeastCrowdedPosition(): Phaser.Math.Vector2 {
    const padding = 28;
    const minX = this.bounds.left + padding;
    const maxX = this.bounds.right - padding;
    const minY = this.bounds.top + padding;
    const maxY = this.bounds.bottom - padding;

    if (!this.otherSpritesProvider) {
      return new Phaser.Math.Vector2(Phaser.Math.Between(minX, maxX), Phaser.Math.Between(minY, maxY));
    }

    const others = this.otherSpritesProvider().filter((o) => o !== this && !o.isCurrentlyDragged());

    let bestPos = new Phaser.Math.Vector2(Phaser.Math.Between(minX, maxX), Phaser.Math.Between(minY, maxY));
    let bestCrowdScore = 999999;

    for (let i = 0; i < 7; i++) {
      const candX = Phaser.Math.Between(minX, maxX);
      const candY = Phaser.Math.Between(minY, maxY);
      let score = 0;

      for (const o of others) {
        const dist = Math.hypot(o.x - candX, o.y - candY);
        if (dist < 110) {
          score += (110 - dist);
        }
      }

      if (score < bestCrowdScore) {
        bestCrowdScore = score;
        bestPos = new Phaser.Math.Vector2(candX, candY);
      }
    }

    return bestPos;
  }

  private pickNewWanderTarget(): void {
    const crowd = this.getNearbyCrowdInfo(80);
    // If crowded by 2+ other cats (group of 3+), immediately move away to open space
    if (crowd.count >= 2) {
      this.wanderTarget = this.findLeastCrowdedPosition();
      this.targetMachineId = null;
      this.cat.animationState = 'walk';
      this.wanderTimer = 5.5 + Math.random() * 2.5;
      this.playCurrentAnimation();
      return;
    }

    if (this.availableMachines.length > 0) {
      let targetNeed: string | null = null;
      if (this.cat.hunger < 45) targetNeed = 'food';
      else if (this.cat.cleanliness < 45) targetNeed = 'wash';
      else if (this.cat.affection < 45) targetNeed = 'pet';
      else if (this.cat.fun < 45) targetNeed = 'toy';
      const machine = targetNeed ? this.availableMachines.find((m) => m.needType === targetNeed) : null;
      if (machine && Math.random() < 0.7) {
        this.targetMachineId = machine.id;
        this.wanderTarget = new Phaser.Math.Vector2(machine.x, machine.y);
        this.cat.animationState = 'walk';
        this.wanderTimer = 8.0;
        this.playCurrentAnimation();
        return;
      }
    }

    if (this.otherSpritesProvider && Math.random() < 0.35) {
      const bestFriendId = this.cat.journal?.bestFriendId;
      const friend = bestFriendId ? this.otherSpritesProvider().find((s) => s.cat.id === bestFriendId) : null;
      if (friend) {
        // Only visit friend if the friend is currently alone (forms a cute cozy pair of 2, never crowds)
        const friendCrowd = friend.getNearbyCrowdInfo(65);
        if (friendCrowd.count === 0) {
          this.wanderTarget = new Phaser.Math.Vector2(
            Phaser.Math.Clamp(friend.x + Phaser.Math.Between(-35, 35), this.bounds.left + 24, this.bounds.right - 24),
            Phaser.Math.Clamp(friend.y + Phaser.Math.Between(-25, 25), this.bounds.top + 24, this.bounds.bottom - 24)
          );
          this.cat.animationState = 'walk';
          this.wanderTimer = 6.0;
          this.playCurrentAnimation();
          return;
        }
      }
    }

    const isKitten = this.cat.stage === 'kitten';
    if ((this.cat.majorTrait === 'mischievous' && this.cat.fun > 50 && Math.random() < 0.2) || (isKitten && this.cat.fun > 50 && Math.random() < 0.15)) {
      this.cat.animationState = 'play';
      this.wanderTimer = 1.5 + Math.random() * 2.5;
      this.playCurrentAnimation();
      return;
    }

    if (Math.random() < (isKitten ? 0.22 : 0.38)) {
      if (crowd.count < 2) {
        this.wanderTarget = null;
        const r = Math.random();
        this.cat.animationState = r < 0.45 ? 'sit' : r < 0.75 ? 'look' : (this.cat.majorTrait === 'lazy' || this.cat.minorTrait === 'lazy' ? 'lay' : 'sit');
        this.wanderTimer = 2.0 + Math.random() * 3.0;
        this.playCurrentAnimation();
        return;
      }
    }

    this.wanderTarget = this.findLeastCrowdedPosition();
    this.cat.animationState = (isKitten && Math.random() < 0.45) || (!isKitten && Math.random() < 0.12) ? 'run' : 'walk';
    this.wanderTimer = 6.5;
    this.playCurrentAnimation();
  }

  setAreaBounds(bounds: Phaser.Geom.Rectangle): void { this.bounds = bounds; }

  refreshVisuals(): void {
    const scale = getScaleForStage(this.cat.stage);
    this.baseSprite.setScale(scale);
    if (this.markingSprite) this.markingSprite.setScale(scale);

    const prefix = this.cat.isRare ? '✨ ' : '';
    const stageSuffix = this.cat.stage === 'kitten' ? ' (Kitten)' : this.cat.stage === 'teen' ? ' (Teen)' : '';
    this.nameLabel.setText(`${prefix}${this.cat.name}${stageSuffix}`);

    this.updateDirtGfx();
    this.updateNeedIndicator();
    this.playCurrentAnimation();
  }
}

