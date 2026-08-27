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
  level: number;
  threshold: number; // 50, 80, or 100
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
  private breedReadyHeartTimer = 15;
  private isBreedReady = false;
  private crowdCheckTimer = 1.0 + Math.random() * 2.0;

  // Cat Perfume Frenzy state (10s rapid mating frenzy)
  private perfumeFrenzyTimer = 0;
  private perfumedMatesBredInFrenzy = new Set<string>();
  private perfumeParticleTimer = 0;

  // Playful Cat-Chase-Cat Tag Game
  private chasingCatSprite: CatSprite | null = null;
  private fleeingFromCatSprite: CatSprite | null = null;
  private catChaseCooldownTimer = 6.0 + Math.random() * 10.0;
  private catChaseDurationTimer = 0;
  private isPouncing = false;

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
      if (this.chasingCatSprite) this.stopCatChase(false);
      if (this.fleeingFromCatSprite) this.fleeingFromCatSprite = null;
      this.wanderTarget = null;
      this.setDepth(850);
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
   * Highlights this adult cat as an eligible target when dragging the perfume bottle.
   */
  setPerfumeTargetHighlight(isTarget: boolean): void {
    this.hoverGfx.clear();
    if (isTarget) {
      const scale = getScaleForStage(this.cat.stage);
      const r = (getHitRadius(this.cat.stage) + 8) * scale;
      const centerY = 4.4 * (scale / BASE_SPRITE_SCALE);

      this.hoverGfx.lineStyle(3, 0xec4899, 0.95);
      this.hoverGfx.strokeCircle(0, centerY, r);
      this.hoverGfx.fillStyle(0xa855f7, 0.26);
      this.hoverGfx.fillCircle(0, centerY, r);
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
      case 'wash': val = this.cat.cleanliness; break;
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

  isPerfumeFrenzied(): boolean {
    return this.perfumeFrenzyTimer > 0;
  }

  activatePerfumeFrenzy(duration = 10): void {
    if (this.cat.stage !== 'adult') return;
    this.perfumeFrenzyTimer = duration;
    this.perfumedMatesBredInFrenzy.clear();
    this.cat.animationState = 'run';
    this.wanderTarget = null;
    this.chaseTarget = null;
    this.targetMachineId = null;
    this.showEmote('🌸');
    this.playCurrentAnimation();
  }

  private spawnPerfumeParticle(): void {
    const emojis = ['🌸', '💖', '✨', '💕'];
    const em = emojis[Math.floor(Math.random() * emojis.length)];
    const p = this.scene.add.text(
      this.x + Phaser.Math.Between(-14, 14),
      this.y - Phaser.Math.Between(6, 22),
      em,
      { fontSize: '14px' },
    ).setOrigin(0.5).setDepth(Math.min(845, this.y + 10));

    this.scene.tweens.add({
      targets: p,
      y: p.y - 24,
      alpha: 0,
      scaleX: 1.3,
      scaleY: 1.3,
      duration: 650,
      ease: 'Quad.easeOut',
      onComplete: () => p.destroy(),
    });
  }

  showEmote(emoji: string): void {
    const scale = getScaleForStage(this.cat.stage);
    const text = this.scene.add.text(this.x, this.y - 20, emoji, { fontSize: '24px' }).setOrigin(0.5, 1).setDepth(100);
    this.scene.tweens.add({ targets: text, y: this.y - 64, alpha: { from: 1, to: 0 }, scale: { from: 0.8, to: 1.4 }, duration: 1200, ease: 'Cubic.easeOut', onComplete: () => text.destroy() });

    if (this.baseSprite) {
      this.scene.tweens.killTweensOf(this.baseSprite);
      this.baseSprite.setScale(scale);
    }
    if (this.markingSprite) {
      this.scene.tweens.killTweensOf(this.markingSprite);
      this.markingSprite.setScale(scale);
    }

    this.scene.tweens.add({
      targets: [this.baseSprite, this.markingSprite].filter(Boolean),
      scaleY: scale * 0.82,
      scaleX: scale * 1.18,
      duration: 120,
      yoyo: true,
      ease: 'Quad.easeInOut',
      onComplete: () => {
        if (this.baseSprite) this.baseSprite.setScale(scale);
        if (this.markingSprite) this.markingSprite.setScale(scale);
      },
    });
    this.updateNeedIndicator();
  }

  triggerPlayState(durationSeconds = 3.0): void {
    if (this.cat.animationState === 'sleep') return;
    this.wanderTarget = null;
    this.cat.animationState = 'play';
    this.wanderTimer = durationSeconds;
    this.playCurrentAnimation();
  }

  triggerLayDown(durationSeconds = 5.5): void {
    if (this.isDragged || this.cat.animationState === 'sleep') return;
    this.wanderTarget = null;
    this.chaseTarget = null;
    if (this.chasingCatSprite) this.stopCatChase(false);
    if (this.fleeingFromCatSprite) this.fleeingFromCatSprite = null;
    this.cat.animationState = 'lay';
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
    return this.chaseTarget !== null || this.chasingCatSprite !== null;
  }

  isFleeing(): boolean {
    return this.fleeingFromCatSprite !== null;
  }

  isChasingCat(): boolean {
    return this.chasingCatSprite !== null;
  }

  startChasingCat(target: CatSprite): void {
    if (this.isDragged || this.cat.animationState === 'sleep') return;
    this.chasingCatSprite = target;
    this.catChaseDurationTimer = 3.8;
    this.wanderTarget = null;
    this.cat.animationState = 'run';
    this.showEmote('😼');
  }

  startFleeingFrom(chaser: CatSprite): void {
    if (this.isDragged || this.cat.animationState === 'sleep') return;
    this.fleeingFromCatSprite = chaser;
    this.wanderTarget = null;
    this.cat.animationState = 'run';
    this.showEmote('🙀');
  }

  stopCatChase(didTag: boolean): void {
    const target = this.chasingCatSprite;
    this.chasingCatSprite = null;

    if (target && target.fleeingFromCatSprite === this) {
      target.fleeingFromCatSprite = null;
    }

    if (didTag && target) {
      // Fun & happiness boost for both playing cats
      this.cat.fun = Math.min(100, this.cat.fun + 28);
      target.cat.fun = Math.min(100, target.cat.fun + 20);
      this.cat.happiness = Math.min(100, this.cat.happiness + 8);
      target.cat.happiness = Math.min(100, target.cat.happiness + 6);

      // Friendship bonding
      this.cat.friendshipIds[target.cat.id] = (this.cat.friendshipIds[target.cat.id] || 0) + 6;
      target.cat.friendshipIds[this.cat.id] = (target.cat.friendshipIds[this.cat.id] || 0) + 6;

      sound.playChirp();
      this.showEmote('🎉');
      target.showEmote('😸');

      this.triggerPlayState(2.0);
      target.triggerPlayState(2.0);
      this.refreshVisuals();
      target.refreshVisuals();
    } else {
      this.showEmote('💨');
      this.cat.animationState = 'look';
      this.wanderTimer = 2.0;
      this.playCurrentAnimation();
      if (target) {
        target.cat.animationState = 'sit';
        target.wanderTimer = 2.0;
        target.playCurrentAnimation();
      }
    }
  }

  slinkAwayFrom(fromX: number, fromY: number, dt: number, speedMult = 1): void {
    if (this.isDragged || this.cat.animationState === 'sleep' || this.isPouncing) return;
    this.chaseTarget = null;
    this.wanderTarget = null;

    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;

    // Slow, cautious walk away from brush
    const speed = 40 * dt * speedMult;
    this.x += (dx / dist) * speed;
    this.y += (dy / dist) * speed;

    this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
    this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);

    this.currentDirection = vectorToDirection(dx, dy);
    this.cat.animationState = 'walk';
    this.wanderTimer = 1.0;
    this.playCurrentAnimation();
    this.setDepth(this.y);
  }

  isPounceActive(): boolean {
    return this.isPouncing;
  }

  playSpecificAnimation(animSuffix: string): void {
    const dir = this.currentDirection;
    const baseKey = `cat_${this.cat.color}_${animSuffix}_${dir}`;
    if (this.scene.anims.exists(baseKey)) this.baseSprite.play(baseKey, true);
    if (this.markingSprite && this.cat.marking) {
      const markingKey = `marking_${this.cat.marking}_${animSuffix}_${dir}`;
      if (this.scene.anims.exists(markingKey)) this.markingSprite.play(markingKey, true);
    }
    this.sleepZzz.setAlpha(0);
  }

  executePounce(targetX: number, targetY: number, onLand?: () => void): void {
    if (this.isDragged || this.cat.animationState === 'sleep' || this.isPouncing) return;

    this.isPouncing = true;
    this.cat.animationState = 'pounce';
    this.wanderTarget = null;
    this.chaseTarget = null;

    const startX = this.x;
    const startY = this.y;
    const dx = targetX - startX;
    const dy = targetY - startY;
    const dist = Math.hypot(dx, dy);
    this.currentDirection = vectorToDirection(dx, dy);

    const scale = getScaleForStage(this.cat.stage);

    if (this.baseSprite) {
      this.scene.tweens.killTweensOf(this.baseSprite);
      this.baseSprite.setScale(scale);
    }
    if (this.markingSprite) {
      this.scene.tweens.killTweensOf(this.markingSprite);
      this.markingSprite.setScale(scale);
    }

    // ── Phase 1: Crouch / Prep (140ms, 3rd running frame) ────────────────
    this.playSpecificAnimation('pounce_prep');

    this.scene.tweens.add({
      targets: [this.baseSprite, this.markingSprite].filter(Boolean),
      scaleX: scale * 1.15,
      scaleY: scale * 0.82,
      duration: 130,
      yoyo: true,
      ease: 'Quad.easeInOut',
      onComplete: () => {
        if (!this.active || this.isDragged) {
          this.isPouncing = false;
          if (this.baseSprite) this.baseSprite.setScale(scale);
          if (this.markingSprite) this.markingSprite.setScale(scale);
          return;
        }

        // ── Phase 2 & 3: Airborne Leap Ascent & Descent (420ms) ───────────
        // Target landing position (clamped within room bounds)
        const landX = Phaser.Math.Clamp(targetX, this.bounds.left + 24, this.bounds.right - 24);
        const landY = Phaser.Math.Clamp(targetY, this.bounds.top + 24, this.bounds.bottom - 24);

        // 4th & 5th running frames on ascent
        this.playSpecificAnimation('pounce_ascent');

        const leapHeight = Math.min(36, Math.max(18, dist * 0.45));
        const leapDuration = 420;

        // Move horizontally across ground
        this.scene.tweens.add({
          targets: this,
          x: landX,
          y: landY,
          duration: leapDuration,
          ease: 'Linear',
        });

        // Vertical Parabolic Arc (applied to sprite offset so shadow stays on ground)
        let switchedToDescent = false;
        this.scene.tweens.addCounter({
          from: 0,
          to: 1,
          duration: leapDuration,
          onUpdate: (tw) => {
            const t = Number(tw.getValue() ?? 0);
            const arc = 4 * t * (1 - t);
            const yOffset = -arc * leapHeight;

            if (this.baseSprite) this.baseSprite.y = yOffset;
            if (this.markingSprite) this.markingSprite.y = yOffset;

            // Shadow contracts and softens during leap
            this.shadow.setScale(1 - arc * 0.45);
            this.shadow.setAlpha(0.22 * (1 - arc * 0.55));

            // Phase 3: 1st running frame on descent (past apex t > 0.52)
            if (t > 0.52 && !switchedToDescent) {
              switchedToDescent = true;
              this.playSpecificAnimation('pounce_descent');
            }
          },
          onComplete: () => {
            if (!this.active || this.isDragged) {
              this.isPouncing = false;
              if (this.baseSprite) { this.baseSprite.y = 0; this.baseSprite.setScale(scale); }
              if (this.markingSprite) { this.markingSprite.y = 0; this.markingSprite.setScale(scale); }
              return;
            }

            if (this.baseSprite) this.baseSprite.y = 0;
            if (this.markingSprite) this.markingSprite.y = 0;
            this.shadow.setScale(1);
            this.shadow.setAlpha(0.22);

            // ── Phase 4: Landing & Impact (130ms, 2nd running frame) ─────────
            this.playSpecificAnimation('pounce_land');
            sound.playPop();
            this.spawnPounceDust();

            // Landing squash and settle
            this.scene.tweens.add({
              targets: [this.baseSprite, this.markingSprite].filter(Boolean),
              scaleX: scale * 1.22,
              scaleY: scale * 0.76,
              duration: 80,
              yoyo: true,
              ease: 'Quad.easeOut',
              onComplete: () => {
                this.isPouncing = false;
                if (this.baseSprite) this.baseSprite.setScale(scale);
                if (this.markingSprite) this.markingSprite.setScale(scale);
                if (onLand) {
                  onLand();
                } else {
                  // Phase 5: Settle to normal animations
                  const roll = Math.random();
                  this.cat.animationState = roll < 0.45 ? 'sit' : roll < 0.75 ? 'look' : 'walk';
                  this.wanderTimer = 1.5 + Math.random() * 2.0;
                  this.playCurrentAnimation();
                }
              },
            });
          },
        });
      },
    });
  }

  private spawnPounceDust(): void {
    const dustGfx = this.scene.add.graphics();
    dustGfx.setDepth(this.y + 1);
    const dustParticles: Array<{ x: number; y: number; vx: number; vy: number; size: number }> = [];

    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6 + (Math.random() - 0.5);
      const spd = Phaser.Math.Between(18, 38);
      dustParticles.push({
        x: this.x + Math.cos(angle) * 4,
        y: this.y + 12 + Math.sin(angle) * 2,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd * 0.4 - 6,
        size: Phaser.Math.Between(1.8, 3.2),
      });
    }

    let elapsed = 0;
    this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 260,
      onUpdate: (tw) => {
        const p = Number(tw.getValue() ?? 0);
        const dt = (tw.elapsed - elapsed) / 1000;
        elapsed = tw.elapsed;
        dustGfx.clear();
        for (const d of dustParticles) {
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          dustGfx.fillStyle(0xd5bdaf, Math.max(0, 0.7 * (1 - p)));
          dustGfx.fillCircle(d.x, d.y, d.size * (1 - p * 0.4));
        }
      },
      onComplete: () => {
        dustGfx.destroy();
      },
    });
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
      this.setDepth(850);
      return;
    }
    if (this.isPouncing) {
      this.setDepth(Math.min(840, this.y));
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

    // ── Active Perfume Breeding Frenzy AI ───────────────────────────────
    if (this.perfumeFrenzyTimer > 0) {
      this.perfumeFrenzyTimer -= dt;
      this.perfumeParticleTimer -= dt;
      if (this.perfumeParticleTimer <= 0) {
        this.perfumeParticleTimer = 0.22;
        this.spawnPerfumeParticle();
      }

      // Find all adult cat sprites in this scene that haven't been visited in this frenzy yet
      const sceneAny = this.scene as any;
      const eligibleMates: CatSprite[] = sceneAny.getAdultCatsInArea
        ? sceneAny.getAdultCatsInArea(this.cat.area).filter(
            (s: CatSprite) => s !== this && s.cat.stage === 'adult' && !this.perfumedMatesBredInFrenzy.has(s.cat.id)
          )
        : [];

      if (eligibleMates.length > 0) {
        eligibleMates.sort((a, b) => {
          const da = Math.hypot(a.x - this.x, a.y - this.y);
          const db = Math.hypot(b.x - this.x, b.y - this.y);
          return da - db;
        });

        const targetMate = eligibleMates[0];
        // Ensure mate is attentive and pauses to greet the perfumed lover
        if (targetMate.cat.animationState === 'sleep') {
          targetMate.cat.animationState = 'sit';
          targetMate.playCurrentAnimation();
        }
        targetMate.wanderTarget = null;

        const dx = targetMate.x - this.x;
        const dy = targetMate.y - this.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 48) {
          // Reached mate! Trigger breeding bond & celebrate
          this.perfumedMatesBredInFrenzy.add(targetMate.cat.id);
          this.showEmote('💖');
          targetMate.showEmote('😍');
          if (sceneAny.triggerPerfumeBreeding) {
            sceneAny.triggerPerfumeBreeding(this.cat, targetMate.cat, (this.x + targetMate.x) / 2, (this.y + targetMate.y) / 2);
          }
        } else {
          // Run passionately toward mate
          const speed = 220 * dt;
          this.x += (dx / dist) * speed;
          this.y += (dy / dist) * speed;
          this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
          this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);
          this.currentDirection = vectorToDirection(dx, dy);
          this.cat.animationState = 'run';
          this.playCurrentAnimation();
        }
      } else {
        // All mates visited or alone in room: run joyous zoomie victory lap with floating hearts
        this.cat.animationState = 'run';
        if (!this.wanderTarget || Math.hypot(this.wanderTarget.x - this.x, this.wanderTarget.y - this.y) < 20) {
          this.wanderTarget = new Phaser.Math.Vector2(
            Phaser.Math.Between(this.bounds.left + 30, this.bounds.right - 30),
            Phaser.Math.Between(this.bounds.top + 30, this.bounds.bottom - 30),
          );
        }
        const target = this.wanderTarget;
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 5) {
          const speed = 175 * dt;
          this.x += (dx / dist) * speed;
          this.y += (dy / dist) * speed;
          this.currentDirection = vectorToDirection(dx, dy);
          this.playCurrentAnimation();
        }
      }

      if (this.perfumeFrenzyTimer <= 0) {
        this.showEmote('🥰');
        this.cat.animationState = 'sit';
        this.wanderTimer = 3.0;
        this.playCurrentAnimation();
      }

      this.setDepth(Math.min(840, this.y));
      return;
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

    // ── Active Fleeing from Chaser Cat (Playful Tag) ──────────────────────
    if (this.fleeingFromCatSprite) {
      if (!this.fleeingFromCatSprite.active || this.fleeingFromCatSprite.isCurrentlyDragged() || this.fleeingFromCatSprite.chasingCatSprite !== this) {
        this.fleeingFromCatSprite = null;
      } else {
        const dx = this.x - this.fleeingFromCatSprite.x;
        const dy = this.y - this.fleeingFromCatSprite.y;
        const dist = Math.hypot(dx, dy);
        const angle = dist < 1 ? Math.random() * Math.PI * 2 : Math.atan2(dy, dx);

        const speed = (this.cat.stage === 'kitten' ? 120 : 138) * ((this.cat.majorTrait === 'zoomie' || this.cat.minorTrait === 'zoomie') ? 1.35 : 1) * dt;
        this.x += Math.cos(angle) * speed;
        this.y += Math.sin(angle) * speed;
        this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
        this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);
        this.currentDirection = vectorToDirection(Math.cos(angle), Math.sin(angle));
        this.cat.animationState = 'run';
        this.playCurrentAnimation();
        this.setDepth(this.y);
        return;
      }
    }

    // ── Active Chasing Another Cat (Playful Tag) ──────────────────────────
    if (this.chasingCatSprite) {
      if (!this.chasingCatSprite.active || this.chasingCatSprite.isCurrentlyDragged() || this.catChaseDurationTimer <= 0) {
        this.stopCatChase(false);
      } else {
        this.catChaseDurationTimer -= dt;
        const dist = Math.hypot(this.chasingCatSprite.x - this.x, this.chasingCatSprite.y - this.y);
        if (dist <= 52 && !this.isPouncing) {
          // Epic flying pounce tag!
          const targetCat = this.chasingCatSprite;
          this.executePounce(targetCat.x, targetCat.y, () => {
            this.stopCatChase(true);
          });
          return;
        } else {
          const speed = (this.cat.stage === 'kitten' ? 135 : 152) * ((this.cat.majorTrait === 'zoomie' || this.cat.minorTrait === 'zoomie') ? 1.35 : 1) * dt;
          this.x += ((this.chasingCatSprite.x - this.x) / dist) * speed;
          this.y += ((this.chasingCatSprite.y - this.y) / dist) * speed;
          this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
          this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);
          this.currentDirection = vectorToDirection(this.chasingCatSprite.x - this.x, this.chasingCatSprite.y - this.y);
          this.cat.animationState = 'run';
          this.playCurrentAnimation();
          this.setDepth(this.y);
          return;
        }
      }
    }

    // ── Playful Tag Game Trigger for Bored / Mischievous Cats ─────────────
    this.catChaseCooldownTimer -= dt;
    if (this.catChaseCooldownTimer <= 0) {
      this.catChaseCooldownTimer = 12.0 + Math.random() * 16.0;
      if (!this.chaseTarget && !this.chasingCatSprite && !this.fleeingFromCatSprite && this.otherSpritesProvider) {
        const isBored = this.cat.fun < 60;
        const isPlayfulTrait = this.cat.majorTrait === 'mischievous' || this.cat.majorTrait === 'zoomie' || this.cat.stage === 'kitten' || this.cat.stage === 'teen';
        if (isBored || isPlayfulTrait || Math.random() < 0.35) {
          const others = this.otherSpritesProvider().filter(
            (o) => o !== this && o.cat.animationState !== 'sleep' && !o.isCurrentlyDragged() && !o.isChasing() && !o.isFleeing() && !o.chaseTarget
          );
          const reachable = others.filter((o) => {
            const d = Math.hypot(o.x - this.x, o.y - this.y);
            return d >= 45 && d <= 230;
          });
          if (reachable.length > 0) {
            const targetCat = reachable[Math.floor(Math.random() * reachable.length)];
            this.startChasingCat(targetCat);
            targetCat.startFleeingFrom(this);
          }
        }
      }
    }

    // ── Anti-Crowding / Group Dispersion Check ────────────────────────────
    // If 3 or more cats gather in a tight bunch (or 2 stacked within 45px), disperse to open space
    this.crowdCheckTimer -= dt;
    if (this.crowdCheckTimer <= 0) {
      this.crowdCheckTimer = 1.5 + Math.random() * 2.0;
      if (!this.chaseTarget && !this.chasingCatSprite && !this.fleeingFromCatSprite) {
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
      // Senses available machines when under that machine's tier threshold (50% Tier 1, 80% Tier 2, 100% Tier 3)
      const needyMachines = this.availableMachines.filter((m) => {
        let currentVal = 100;
        if (m.needType === 'food') currentVal = this.cat.hunger;
        else if (m.needType === 'wash' || m.needType === 'brush') currentVal = this.cat.cleanliness;
        else if (m.needType === 'pet') currentVal = this.cat.affection;
        else if (m.needType === 'toy') currentVal = this.cat.fun;

        return currentVal < m.threshold;
      });

      if (needyMachines.length > 0) {
        // Pick the machine with the highest deficit below threshold
        needyMachines.sort((a, b) => {
          const valA = a.needType === 'food' ? this.cat.hunger : a.needType === 'pet' ? this.cat.affection : a.needType === 'toy' ? this.cat.fun : this.cat.cleanliness;
          const valB = b.needType === 'food' ? this.cat.hunger : b.needType === 'pet' ? this.cat.affection : b.needType === 'toy' ? this.cat.fun : this.cat.cleanliness;
          return (valA - a.threshold) - (valB - b.threshold);
        });

        const chosen = needyMachines[0];
        if (Math.random() < 0.85) {
          this.targetMachineId = chosen.id;
          this.wanderTarget = new Phaser.Math.Vector2(chosen.x, chosen.y);
          this.cat.animationState = 'walk';
          this.wanderTimer = 8.0;
          this.playCurrentAnimation();
          return;
        }
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

    // ── Spontaneous Ambient Pounce (leaves, bugs, motes) ───────────────────
    const isHunter = this.cat.majorTrait === 'hunter' || this.cat.minorTrait === 'hunter';
    const isMischief = this.cat.majorTrait === 'mischievous' || this.cat.majorTrait === 'zoomie';
    const isKittenOrTeen = isKitten || this.cat.stage === 'teen';
    const pounceChance = (isHunter ? 0.28 : 0) + (isMischief ? 0.22 : 0) + (isKittenOrTeen ? 0.16 : 0.06);

    if (Math.random() < pounceChance && !this.isPouncing) {
      const pounceDist = Phaser.Math.Between(45, 95);
      const angle = Math.random() * Math.PI * 2;
      const targetX = Phaser.Math.Clamp(this.x + Math.cos(angle) * pounceDist, this.bounds.left + 24, this.bounds.right - 24);
      const targetY = Phaser.Math.Clamp(this.y + Math.sin(angle) * pounceDist, this.bounds.top + 24, this.bounds.bottom - 24);

      this.executePounce(targetX, targetY, () => {
        this.cat.fun = Math.min(100, this.cat.fun + 12);
        this.cat.happiness = Math.min(100, this.cat.happiness + 5);
        this.showEmote(Math.random() < 0.5 ? '✨' : '🐾');
        this.triggerPlayState(1.5);
      });
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

