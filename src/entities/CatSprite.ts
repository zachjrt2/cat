import Phaser from 'phaser';
import type { Cat, CatAnimationState, LifeStage, ToolType } from '../data/types';
import { shouldFallAsleep, shouldWakeUp } from '../systems/NeedsSystem';
import { sound } from '../systems/SoundManager';
import { MUTATION_CATALOG } from '../data/mutations';
import { ensureSpriteAnimations } from '../scenes/BootScene';
import { isAnyModalOpen } from '../ui/EventBus';
import type { ToyBall } from './ToyBall';

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

function getScaleForCat(cat: Cat): number {
  const base = getScaleForStage(cat.stage);
  const mutDef = cat.mutation ? MUTATION_CATALOG[cat.mutation] : null;
  return base * (mutDef ? mutDef.scaleMultiplier : 1);
}

function lerpHexColor(c1: number, c2: number, t: number): number {
  const r1 = (c1 >> 16) & 0xff, g1 = (c1 >> 8) & 0xff, b1 = c1 & 0xff;
  const r2 = (c2 >> 16) & 0xff, g2 = (c2 >> 8) & 0xff, b2 = c2 & 0xff;
  const r = (r1 + (r2 - r1) * t) | 0;
  const g = (g1 + (g2 - g1) * t) | 0;
  const b = (b1 + (b2 - b1) * t) | 0;
  return (r << 16) | (g << 8) | b;
}

function hslToHexFast(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

function ensureCatShadowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists('cat_shadow_texture')) return;
  const canvas = scene.textures.createCanvas('cat_shadow_texture', 64, 32);
  if (!canvas) return;
  const ctx = canvas.context;
  ctx.fillStyle = 'rgba(53, 74, 33, 0.28)';
  ctx.beginPath();
  ctx.ellipse(32, 16, 28, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  canvas.refresh();
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

export interface AvailableFurnitureInfo {
  id: string;
  name: string;
  x: number;
  y: number;
}

export class CatSprite extends Phaser.GameObjects.Container {
  private static graphicsPool: Phaser.GameObjects.Graphics[] = [];
  private static textPool: Phaser.GameObjects.Text[] = [];
  private static readonly MAX_POOL_SIZE = 40;

  static getPooledGraphics(scene: Phaser.Scene): Phaser.GameObjects.Graphics | null {
    while (CatSprite.graphicsPool.length > 0) {
      const gfx = CatSprite.graphicsPool.pop()!;
      if (gfx && gfx.scene) {
        gfx.clear();
        gfx.setVisible(true);
        gfx.setActive(true);
        gfx.setAlpha(1);
        gfx.setScale(1);
        gfx.setAngle(0);
        gfx.setPosition(0, 0);
        return gfx;
      }
    }
    return scene.add.graphics();
  }

  static recycleGraphics(gfx: Phaser.GameObjects.Graphics | null): void {
    if (!gfx || !gfx.scene) return;
    gfx.clear();
    gfx.setVisible(false);
    gfx.setActive(false);
    if (CatSprite.graphicsPool.length < CatSprite.MAX_POOL_SIZE) {
      CatSprite.graphicsPool.push(gfx);
    } else {
      gfx.destroy();
    }
  }

  static getPooledText(scene: Phaser.Scene, text: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    while (CatSprite.textPool.length > 0) {
      const t = CatSprite.textPool.pop()!;
      if (t && t.scene) {
        t.setText(text);
        t.setStyle(style);
        t.setVisible(true);
        t.setActive(true);
        t.setAlpha(1);
        t.setScale(1);
        t.setAngle(0);
        t.setPosition(0, 0);
        return t;
      }
    }
    return scene.add.text(0, 0, text, style);
  }

  static recycleText(t: Phaser.GameObjects.Text | null): void {
    if (!t || !t.scene) return;
    t.setVisible(false);
    t.setActive(false);
    if (CatSprite.textPool.length < CatSprite.MAX_POOL_SIZE) {
      CatSprite.textPool.push(t);
    } else {
      t.destroy();
    }
  }

  static clearPools(): void {
    CatSprite.graphicsPool.forEach((g) => g.destroy());
    CatSprite.graphicsPool = [];
    CatSprite.textPool.forEach((t) => t.destroy());
    CatSprite.textPool = [];
  }

  static showNameLabels = true;

  readonly cat: Cat;
  private baseSprite: Phaser.GameObjects.Sprite;
  private markingSprite: Phaser.GameObjects.Sprite | null = null;
  private shadow: Phaser.GameObjects.Image;
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
  private activePounceCounterTween: Phaser.Tweens.Tween | null = null;
  private activePounceMoveTween: Phaser.Tweens.Tween | null = null;
  private activePouncePrepTween: Phaser.Tweens.Tween | null = null;
  private activePounceLandTween: Phaser.Tweens.Tween | null = null;

  // Mutation FX
  private mutationEmitterTimer = 0.5 + Math.random() * 1.5;
  private chromaticHue = Math.random() * 360;
  private haloGfx: Phaser.GameObjects.Graphics | null = null;

  // AI & Social Interaction Support
  private targetMachineId: string | null = null;
  private availableMachines: AvailableMachineInfo[] = [];
  private availableFurniture: AvailableFurnitureInfo[] = [];
  private targetFurnitureId: string | null = null;
  private followingAdultSprite: CatSprite | null = null;
  private followLeaderTimer = 0;
  private isFollowingWalking = false;
  private followOffsetX = 0;
  private followOffsetY = 0;
  private biscuitPuffTimer = 0;
  private otherSpritesProvider: (() => CatSprite[]) | null = null;
  private machineUseCallback: ((cat: Cat, machineId: string) => void) | null = null;
  private chaseTarget: { x: number; y: number } | null = null;

  // Distinct Behaviors: Cat Soccer, Peek-a-boo Ambush, Zoomie Tornado
  private toyBallProvider: (() => ToyBall | null) | null = null;
  private isAmbushing = false;
  private ambushTargetSprite: CatSprite | null = null;
  private ambushWaitTimer = 0;
  private isZoomieTornado = false;
  private zoomieWaypoints: Phaser.Math.Vector2[] = [];
  private zoomieWaypointIndex = 0;
  private zoomieDustTimer = 0;

  // Conga Parade Event
  private isCongaParadeActive = false;
  private isCongaLeader = false;
  private congaWaypoints: Phaser.Math.Vector2[] = [];
  private congaWaypointIndex = 0;
  private congaFollowTarget: CatSprite | null = null;
  private congaEmoteTimer = 0;

  // Concentric Circles Rain Ritual Event
  private isRainDanceActive = false;
  private rainDanceCenterX = 0;
  private rainDanceCenterY = 0;
  private rainDanceRadius = 0;
  private rainDanceAngle = 0;
  private rainDanceDirection = 1; // +1 = CW, -1 = CCW
  private rainDanceOmega = 1.0;
  private rainDanceEmoteTimer = 0;

  // Unified Ritual & Consumable Dances
  private activeDanceType: 'none' | 'snowflake' | 'heart' | 'infinity' | 'sunset' | 'constellation' = 'none';
  private danceCenterX = 0;
  private danceCenterY = 0;
  private danceTargetX = 0;
  private danceTargetY = 0;
  private danceRadius = 0;
  private danceAngle = 0;
  private danceParamU = 0;
  private danceParamSpeed = 1.0;
  private danceInfinityTilt = 0;
  private danceElapsedTime = 0;
  private danceEmoteTimer = 0;

  // Autonomous Wash Fleeing
  private brushFleeTarget: Phaser.Math.Vector2 | null = null;
  private brushFleeTimer = 0;
  private brushFleeCooldown = 0;
  private brushFleeDustTimer = 0;

  constructor(scene: Phaser.Scene, cat: Cat, x: number, y: number, bounds: Phaser.Geom.Rectangle) {
    super(scene, x, y);
    this.cat = cat;
    this.bounds = bounds;

    // Ensure animations are lazily instantiated for this cat's coat and marking
    ensureSpriteAnimations(scene.anims, `cat_${cat.color}`);
    if (cat.marking) {
      ensureSpriteAnimations(scene.anims, `marking_${cat.marking}`);
    }

    const scale = getScaleForCat(cat);

    // 1. Soft Shadow (Batched WebGL Image)
    ensureCatShadowTexture(scene);
    this.shadow = scene.add.image(0, 18 * (scale / BASE_SPRITE_SCALE), 'cat_shadow_texture');
    this.shadow.setScale(0.55 * (scale / BASE_SPRITE_SCALE), 0.50 * (scale / BASE_SPRITE_SCALE));
    this.add(this.shadow);

    // 2. Hover / Focus Ring
    this.hoverGfx = scene.add.graphics();
    this.hoverGfx.setAlpha(0);
    this.add(this.hoverGfx);

    // 3. Aura Glow
    if (cat.isRare || cat.color === 'ghost_0' || cat.color === 'gold_0' || cat.color === 'radioactive_0' ||
        cat.mutation === 'sparkly' || cat.mutation === 'gilded' || cat.mutation === 'frosted' ||
        cat.mutation === 'flaming' || cat.mutation === 'inverted' || cat.mutation === 'angelic' || cat.mutation === 'chromatic') {
      const aura = scene.add.graphics();
      let auraColor = 0xffe66d;
      let auraAlpha = 0.25;

      if (cat.color === 'ghost_0' || cat.rareType === 'ghost') {
        auraColor = 0xcfe2f3;
        auraAlpha = 0.35;
      } else if (cat.color === 'radioactive_0' || cat.rareType === 'radioactive') {
        auraColor = 0x55ff55;
        auraAlpha = 0.3;
      } else if (cat.mutation === 'sparkly') {
        auraColor = 0xf0abfc;
        auraAlpha = 0.3;
      } else if (cat.mutation === 'gilded') {
        auraColor = 0xfbbf24;
        auraAlpha = 0.35;
      } else if (cat.mutation === 'frosted') {
        auraColor = 0x38bdf8;
        auraAlpha = 0.28;
      } else if (cat.mutation === 'flaming') {
        auraColor = 0xf97316;
        auraAlpha = 0.30;
      } else if (cat.mutation === 'inverted') {
        auraColor = 0x6366f1;
        auraAlpha = 0.32;
      } else if (cat.mutation === 'angelic') {
        auraColor = 0xfef08a;
        auraAlpha = 0.28;
      } else if (cat.mutation === 'chromatic') {
        auraColor = 0xc026d3;
        auraAlpha = 0.30;
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

    // Apply mutation tints
    if (cat.mutation === 'gilded') {
      this.baseSprite.setTint(0xffd700);
    } else if (cat.mutation === 'frosted') {
      this.baseSprite.setTint(0xa5f3fc);
    } else if (cat.mutation === 'flaming') {
      this.baseSprite.setTint(0xff8a4c);
    } else if (cat.mutation === 'stinky') {
      this.baseSprite.setTint(0xdcfce7);
    } else if (cat.mutation === 'inverted') {
      this.baseSprite.setTint(0x818cf8);
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
        if (cat.mutation === 'gilded') {
          this.markingSprite.setTint(0xffd700);
        } else if (cat.mutation === 'frosted') {
          this.markingSprite.setTint(0xa5f3fc);
        } else if (cat.mutation === 'flaming') {
          this.markingSprite.setTint(0xff8a4c);
        } else if (cat.mutation === 'stinky') {
          this.markingSprite.setTint(0xdcfce7);
        } else if (cat.mutation === 'inverted') {
          this.markingSprite.setTint(0x38bdf8);
        }
        this.add(this.markingSprite);
      }
    }

    // Angelic Mutation Halo
    if (cat.mutation === 'angelic') {
      this.haloGfx = scene.add.graphics();
      this.haloGfx.lineStyle(2.5, 0xfde047, 0.95);
      this.haloGfx.strokeEllipse(0, -30 * (scale / BASE_SPRITE_SCALE), 14, 5);
      this.add(this.haloGfx);

      scene.tweens.add({
        targets: this.haloGfx,
        y: -3,
        duration: 1200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // 6. Dirt
    this.dirtGfx = scene.add.graphics();
    this.dirtGfx.setVisible(false);
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
    this.nameLabel.setVisible(CatSprite.showNameLabels);
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

    this.baseSprite.on('pointerover', () => {
      if (isAnyModalOpen()) return;
      this.emit('pointerover');
    });
    this.baseSprite.on('pointerout',  () => this.emit('pointerout'));
    this.baseSprite.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (isAnyModalOpen()) return;
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
      const scale = getScaleForCat(this.cat);
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
      const scale = getScaleForCat(this.cat);
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
      const scale = getScaleForCat(this.cat);
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
      const scale = getScaleForCat(this.cat);
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
    const wasToolActive = this.currentSelectedTool !== null;
    this.currentSelectedTool = tool;
    this.updateNeedIndicator();
    this.drawHoverRing(false);

    if (wasToolActive && !tool) {
      this.resumeNormalBehavior();
    }
  }

  resumeNormalBehavior(): void {
    // If cat is actively dragged, sleeping, in perfume frenzy, or participating in a dance, preserve that state
    if (this.isDragged || this.cat.animationState === 'sleep' || this.perfumeFrenzyTimer > 0 || this.isCongaParadeActive || this.isRainDanceActive) {
      return;
    }

    // Clear any stuck interaction/chase/flee states
    this.brushFleeTarget = null;
    this.isAmbushing = false;
    this.ambushTargetSprite = null;

    // If cat was in an interaction posture (knead, play, look, sit) or stationary without a target, awaken its wandering AI
    if (this.cat.animationState === 'knead' || this.cat.animationState === 'play' || this.cat.animationState === 'look' || this.cat.animationState === 'sit' || !this.wanderTarget) {
      this.wanderTimer = 0.3 + Math.random() * 0.7;
      this.pickNewWanderTarget();
    }
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

  activatePerfumeFrenzy(duration = 15): void {
    this.cat.stage = 'adult';
    this.cat.growthProgress = 100;
    this.perfumeFrenzyTimer = duration;
    this.perfumedMatesBredInFrenzy.clear();
    this.cat.animationState = 'run';
    this.wanderTarget = null;
    this.chaseTarget = null;
    this.targetMachineId = null;
    if (this.chasingCatSprite) this.stopCatChase(false);
    if (this.fleeingFromCatSprite) this.fleeingFromCatSprite = null;
    this.isPouncing = false;
    this.showEmote('🌸');
    this.playCurrentAnimation();
  }

  private spawnPerfumeParticle(): void {
    const emojis = ['🌸', '💖', '✨', '💕'];
    const em = emojis[Math.floor(Math.random() * emojis.length)];
    const p = CatSprite.getPooledText(this.scene, em, { fontSize: '14px' });
    p.setPosition(
      this.x + Phaser.Math.Between(-14, 14),
      this.y - Phaser.Math.Between(6, 22),
    ).setOrigin(0.5).setDepth(Math.min(845, this.y + 10));

    this.scene.tweens.add({
      targets: p,
      y: p.y - 24,
      alpha: 0,
      scaleX: 1.3,
      scaleY: 1.3,
      duration: 650,
      ease: 'Quad.easeOut',
      onComplete: () => CatSprite.recycleText(p),
    });
  }

  showEmote(emoji: string): void {
    const scale = getScaleForCat(this.cat);
    const text = CatSprite.getPooledText(this.scene, emoji, { fontSize: '24px' });
    text.setPosition(this.x, this.y - 20).setOrigin(0.5, 1).setDepth(100);
    this.scene.tweens.add({
      targets: text,
      y: this.y - 64,
      alpha: { from: 1, to: 0 },
      scale: { from: 0.8, to: 1.4 },
      duration: 1200,
      ease: 'Cubic.easeOut',
      onComplete: () => CatSprite.recycleText(text),
    });

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
    if (this.perfumeFrenzyTimer > 0) return;
    if (this.cat.animationState === 'sleep') return;
    this.wanderTarget = null;
    this.cat.animationState = 'play';
    this.wanderTimer = durationSeconds;
    this.playCurrentAnimation();
  }

  triggerLayDown(durationSeconds = 5.5): void {
    if (this.perfumeFrenzyTimer > 0) return;
    if (this.isDragged || this.cat.animationState === 'sleep') return;
    this.wanderTarget = null;
    this.chaseTarget = null;
    if (this.chasingCatSprite) this.stopCatChase(false);
    if (this.fleeingFromCatSprite) this.fleeingFromCatSprite = null;
    this.cat.animationState = 'lay';
    this.wanderTimer = durationSeconds;
    this.playCurrentAnimation();
  }

  triggerKneadBiscuits(durationSeconds = 4.5): void {
    if (this.perfumeFrenzyTimer > 0) return;
    if (this.isDragged || this.cat.animationState === 'sleep') return;
    this.wanderTarget = null;
    this.chaseTarget = null;
    if (this.chasingCatSprite) this.stopCatChase(false);
    if (this.fleeingFromCatSprite) this.fleeingFromCatSprite = null;
    this.cat.animationState = 'knead';
    this.wanderTimer = durationSeconds;
    this.biscuitPuffTimer = 0.3;
    this.playCurrentAnimation();
    this.spawnBiscuitHeart();
  }

  setAvailableMachines(machines: AvailableMachineInfo[]): void { this.availableMachines = machines; }
  setAvailableFurniture(furniture: AvailableFurnitureInfo[]): void { this.availableFurniture = furniture; }
  setOtherSpritesProvider(provider: () => CatSprite[]): void { this.otherSpritesProvider = provider; }
  setMachineUseCallback(cb: (cat: Cat, machineId: string) => void): void { this.machineUseCallback = cb; }
  setToyBallProvider(provider: () => ToyBall | null): void { this.toyBallProvider = provider; }

  isFollowingLeader(): boolean {
    return this.followingAdultSprite !== null;
  }

  getFollowTarget(): CatSprite | null {
    return this.followingAdultSprite;
  }

  isFollowChainAncestor(sprite: CatSprite): boolean {
    let curr: CatSprite | null = this.followingAdultSprite;
    let depth = 0;
    while (curr && depth < 20) {
      if (curr === sprite) return true;
      curr = curr.getFollowTarget();
      depth++;
    }
    return false;
  }

  triggerZoomieTornado(): void {
    if (this.isDragged || this.cat.animationState === 'sleep' || this.isPouncing || this.isZoomieTornado) return;

    this.isZoomieTornado = true;
    this.followingAdultSprite = null;
    this.chaseTarget = null;
    this.wanderTarget = null;
    this.targetFurnitureId = null;
    this.targetMachineId = null;

    const pad = 35;
    const minX = this.bounds.left + pad;
    const maxX = this.bounds.right - pad;
    const minY = this.bounds.top + pad;
    const maxY = this.bounds.bottom - pad;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rx = (maxX - minX) * 0.36;
    const ry = (maxY - minY) * 0.30;

    // Create rapid figure-8 waypoint trajectory
    this.zoomieWaypoints = [
      new Phaser.Math.Vector2(cx - rx, cy - ry),
      new Phaser.Math.Vector2(cx + rx, cy + ry),
      new Phaser.Math.Vector2(cx + rx, cy - ry),
      new Phaser.Math.Vector2(cx - rx, cy + ry),
      new Phaser.Math.Vector2(cx, cy),
    ];
    this.zoomieWaypointIndex = 0;
    this.cat.animationState = 'run';
    this.wanderTimer = 7.0;
    this.showEmote('⚡');
    sound.playPop();
  }

  startCongaLeader(waypoints: Phaser.Math.Vector2[]): void {
    this.isCongaParadeActive = true;
    this.isCongaLeader = true;
    this.congaWaypoints = waypoints;
    this.congaWaypointIndex = 0;
    this.congaFollowTarget = null;
    this.followingAdultSprite = null;
    this.wanderTarget = null;
    this.chaseTarget = null;
    this.isAmbushing = false;
    this.isZoomieTornado = false;
    this.isPouncing = false;
    this.congaEmoteTimer = 0.6 + Math.random() * 1.2;

    this.cat.animationState = 'run';
    this.playCurrentAnimation();
    this.showEmote('👑');
  }

  startCongaFollower(leaderCat: CatSprite): void {
    this.isCongaParadeActive = true;
    this.isCongaLeader = false;
    this.congaFollowTarget = leaderCat;
    this.followingAdultSprite = leaderCat;
    this.followLeaderTimer = 9999;
    this.followOffsetX = Phaser.Math.Between(-18, 18);
    this.followOffsetY = Phaser.Math.Between(-14, 14);
    this.isFollowingWalking = false;
    this.wanderTarget = null;
    this.chaseTarget = null;
    this.isAmbushing = false;
    this.isZoomieTornado = false;
    this.isPouncing = false;
    this.congaEmoteTimer = 1.0 + Math.random() * 2.0;

    this.cat.animationState = 'run';
    this.playCurrentAnimation();
    this.showEmote('🐾');
  }

  endCongaParade(): void {
    this.isCongaParadeActive = false;
    this.isCongaLeader = false;
    this.congaFollowTarget = null;
    this.followingAdultSprite = null;
    this.congaWaypoints = [];
    this.cat.animationState = 'sit';
    this.wanderTimer = 4.0 + Math.random() * 4.0;
    this.playCurrentAnimation();
    this.showEmote('🎉');
  }

  isCongaActive(): boolean {
    return this.isCongaParadeActive;
  }

  startRainDance(cx: number, cy: number, radius: number, initialAngle: number, direction: number, omega: number): void {
    this.isRainDanceActive = true;
    this.isCongaParadeActive = false;
    this.isCongaLeader = false;
    this.congaFollowTarget = null;
    this.followingAdultSprite = null;
    this.wanderTarget = null;
    this.chaseTarget = null;
    this.chasingCatSprite = null;
    this.fleeingFromCatSprite = null;
    this.brushFleeTarget = null;
    this.brushFleeTimer = 0;
    this.isAmbushing = false;
    this.isZoomieTornado = false;
    this.isPouncing = false;

    this.rainDanceCenterX = cx;
    this.rainDanceCenterY = cy;
    this.rainDanceRadius = radius;
    this.rainDanceAngle = initialAngle;
    this.rainDanceDirection = direction;
    this.rainDanceOmega = omega;
    this.rainDanceEmoteTimer = 1.0 + Math.random() * 2.0;

    this.cat.animationState = 'walk';
    this.playCurrentAnimation();
    this.showEmote('🌧️');
  }

  endRainDance(): void {
    this.isRainDanceActive = false;
    this.activeDanceType = 'none';
    this.cat.animationState = 'look';
    this.wanderTimer = 3.0 + Math.random() * 3.0;
    this.playCurrentAnimation();
    this.showEmote('✨');
  }

  isRainDance(): boolean {
    return this.isRainDanceActive;
  }

  getActiveDanceType(): string {
    return this.activeDanceType;
  }

  isAnyDanceActive(): boolean {
    return this.isRainDanceActive || this.activeDanceType !== 'none';
  }

  /** Starts 6-pointed Snowflake Mandala Dance */
  startSnowflakeDance(cx: number, cy: number, armAngle: number, maxDist: number): void {
    this.resetBehavioralFlagsForDance();
    this.activeDanceType = 'snowflake';
    this.danceCenterX = cx;
    this.danceCenterY = cy;
    this.danceAngle = armAngle;
    this.danceRadius = maxDist;
    this.danceParamU = Math.random() * Math.PI;
    this.danceEmoteTimer = 1.0 + Math.random() * 2.0;
    this.cat.animationState = 'walk';
    this.playCurrentAnimation();
    this.showEmote('❄️');
  }

  /** Starts Parametric Heart Pulsing Formation */
  startHeartFormation(cx: number, cy: number, u: number): void {
    this.resetBehavioralFlagsForDance();
    this.activeDanceType = 'heart';
    this.danceCenterX = cx;
    this.danceCenterY = cy;
    this.danceAngle = u;
    this.danceParamU = 0;
    this.danceEmoteTimer = 0.8 + Math.random() * 2.0;
    this.cat.animationState = 'knead';
    this.playCurrentAnimation();
    this.showEmote('💖');
  }

  /** Starts High-Speed Interlocking Figure-8 Infinity Loop with optional tilt angle for offset counter-tracks */
  startInfinityLoop(cx: number, cy: number, u0: number, speed: number, tiltAngle = 0): void {
    this.resetBehavioralFlagsForDance();
    this.activeDanceType = 'infinity';
    this.danceCenterX = cx;
    this.danceCenterY = cy;
    this.danceParamU = u0;
    this.danceParamSpeed = speed;
    this.danceInfinityTilt = tiltAngle;
    this.danceElapsedTime = 0;
    this.danceEmoteTimer = 0.6 + Math.random() * 2.0;
    this.cat.animationState = 'run';
    this.playCurrentAnimation();
    this.showEmote('♾️');
  }

  /** Starts Archimedean Fibonacci Sunset Spiral that tightens dynamically inward over the song duration */
  startSunsetSpiral(cx: number, cy: number, radius: number, baseAngle: number, omega: number): void {
    this.resetBehavioralFlagsForDance();
    this.activeDanceType = 'sunset';
    this.danceCenterX = cx;
    this.danceCenterY = cy;
    this.danceRadius = radius;
    this.danceAngle = baseAngle;
    this.danceParamSpeed = omega;
    this.danceParamU = 0;
    this.danceElapsedTime = 0;
    this.danceEmoteTimer = 1.0 + Math.random() * 2.5;
    this.cat.animationState = 'walk';
    this.playCurrentAnimation();
    this.showEmote('🌅');
  }

  /** Starts Giant Cat Floor Constellation */
  startConstellationFormation(targetX: number, targetY: number, emote = '🌟'): void {
    this.resetBehavioralFlagsForDance();
    this.activeDanceType = 'constellation';
    this.danceTargetX = targetX;
    this.danceTargetY = targetY;
    this.danceEmoteTimer = 1.0 + Math.random() * 2.5;
    this.cat.animationState = 'walk';
    this.playCurrentAnimation();
    this.showEmote(emote);
  }

  endActiveDance(): void {
    this.activeDanceType = 'none';
    this.isRainDanceActive = false;
    this.cat.animationState = 'look';
    this.wanderTimer = 3.0 + Math.random() * 3.0;
    this.playCurrentAnimation();
    this.showEmote('✨');
  }

  private resetBehavioralFlagsForDance(): void {
    this.isRainDanceActive = false;
    this.isCongaParadeActive = false;
    this.isCongaLeader = false;
    this.congaFollowTarget = null;
    this.followingAdultSprite = null;
    this.wanderTarget = null;
    this.chaseTarget = null;
    this.chasingCatSprite = null;
    this.fleeingFromCatSprite = null;
    this.brushFleeTarget = null;
    this.brushFleeTimer = 0;
    this.isAmbushing = false;
    this.isZoomieTornado = false;
    this.isPouncing = false;
  }

  /** Called by SanctuaryScene whenever the breed cooldown state changes for this cat. */
  setBreedReady(ready: boolean): void {
    if (this.isBreedReady === ready) return;
    this.isBreedReady = ready;
    // Reset timer so a heart fires soon after becoming ready again
    if (ready) this.breedReadyHeartTimer = 2 + Math.random() * 4;
  }

  setChaseTarget(x: number, y: number): void {
    if (this.perfumeFrenzyTimer > 0) return;
    if (this.isDragged || this.cat.animationState === 'sleep') return;
    const dist = Math.hypot(x - this.x, y - this.y);
    if (dist > 15) {
      this.chaseTarget = { x, y };
      this.wanderTarget = null;
      this.cat.animationState = 'run';
    }
  }

  clearChaseTarget(): void {
    this.chaseTarget = null;
    if (this.cat.animationState === 'run' || this.cat.animationState === 'walk') {
      this.cat.animationState = 'sit';
      this.playCurrentAnimation();
    }
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
    if (this.perfumeFrenzyTimer > 0) return;
    if (this.isDragged || this.cat.animationState === 'sleep') return;
    this.chasingCatSprite = target;
    this.catChaseDurationTimer = 3.8;
    this.wanderTarget = null;
    this.cat.animationState = 'run';
    this.showEmote('😼');
  }

  startFleeingFrom(chaser: CatSprite): void {
    if (this.perfumeFrenzyTimer > 0) return;
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

      if (Math.random() < 0.05) {
        sound.playChirp();
      }
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
        target.wanderTimer = 8.0 + Math.random() * 8.0;
        target.playCurrentAnimation();
      }
    }
  }

  triggerFleeFromBrush(fromX: number, fromY: number): void {
    if (this.perfumeFrenzyTimer > 0 || this.isCongaParadeActive) return;
    if (this.isDragged || this.cat.animationState === 'sleep' || this.isPouncing) return;

    this.chaseTarget = null;
    this.followingAdultSprite = null;
    this.isAmbushing = false;
    this.isZoomieTornado = false;

    const dx = this.x - fromX;
    const dy = this.y - fromY;
    let angle = Math.atan2(dy, dx);

    // If already backed against a wall, aim diagonally towards room interior
    const pad = 40;
    if (this.x <= this.bounds.left + pad) {
      angle = Phaser.Math.Between(-40, 40) * (Math.PI / 180);
    } else if (this.x >= this.bounds.right - pad) {
      angle = Phaser.Math.Between(140, 220) * (Math.PI / 180);
    } else if (this.y <= this.bounds.top + pad) {
      angle = Phaser.Math.Between(50, 130) * (Math.PI / 180);
    } else if (this.y >= this.bounds.bottom - pad) {
      angle = Phaser.Math.Between(-130, -50) * (Math.PI / 180);
    } else {
      // Add slight random panic scatter angle
      angle += (Math.random() - 0.5) * 0.8;
    }

    const fleeDistance = Phaser.Math.Between(160, 280);
    const targetX = Phaser.Math.Clamp(this.x + Math.cos(angle) * fleeDistance, this.bounds.left + 24, this.bounds.right - 24);
    const targetY = Phaser.Math.Clamp(this.y + Math.sin(angle) * fleeDistance, this.bounds.top + 24, this.bounds.bottom - 24);

    this.brushFleeTarget = new Phaser.Math.Vector2(targetX, targetY);
    this.wanderTarget = this.brushFleeTarget;
    this.brushFleeTimer = 2.4 + Math.random() * 1.2;
    this.wanderTimer = this.brushFleeTimer;

    this.currentDirection = vectorToDirection(targetX - this.x, targetY - this.y);
    this.cat.animationState = 'run';
    this.playCurrentAnimation();

    if (this.brushFleeCooldown <= 0) {
      this.brushFleeCooldown = 1.0;
      this.spawnPounceDust();
      this.showEmote(Math.random() < 0.5 ? '🙀' : '💨');
    }
  }

  fleeFromBrush(fromX: number, fromY: number, _dt = 0.016, _speedMult = 1): void {
    this.triggerFleeFromBrush(fromX, fromY);
  }

  slinkAwayFrom(fromX: number, fromY: number, _dt = 0.016, _speedMult = 1): void {
    this.triggerFleeFromBrush(fromX, fromY);
  }

  isPounceActive(): boolean {
    return this.isPouncing;
  }

  playSpecificAnimation(animSuffix: string): void {
    if (!this.active || !this.scene || !this.scene.anims || !this.baseSprite) return;
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
    if (!this.active || !this.scene || !this.scene.tweens || this.isDragged || this.cat.animationState === 'sleep' || this.isPouncing) return;

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

    const scale = getScaleForCat(this.cat);

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

    this.activePouncePrepTween = this.scene.tweens.add({
      targets: [this.baseSprite, this.markingSprite].filter(Boolean),
      scaleX: scale * 1.15,
      scaleY: scale * 0.82,
      duration: 130,
      yoyo: true,
      ease: 'Quad.easeInOut',
      onComplete: () => {
        this.activePouncePrepTween = null;
        if (!this.active || !this.scene || this.isDragged) {
          this.isPouncing = false;
          if (this.baseSprite) this.baseSprite.setScale(scale);
          if (this.markingSprite) this.markingSprite.setScale(scale);
          return;
        }

        // ── Phase 2 & 3: Airborne Leap Ascent & Descent (420ms) ───────────
        const landX = Phaser.Math.Clamp(targetX, this.bounds.left + 24, this.bounds.right - 24);
        const landY = Phaser.Math.Clamp(targetY, this.bounds.top + 24, this.bounds.bottom - 24);

        this.playSpecificAnimation('pounce_ascent');

        const leapHeight = Math.min(36, Math.max(18, dist * 0.45));
        const leapDuration = 420;

        // Move horizontally across ground
        this.activePounceMoveTween = this.scene.tweens.add({
          targets: this,
          x: landX,
          y: landY,
          duration: leapDuration,
          ease: 'Linear',
          onComplete: () => {
            this.activePounceMoveTween = null;
          },
        });

        // Vertical Parabolic Arc (applied to sprite offset so shadow stays on ground)
        let switchedToDescent = false;
        this.activePounceCounterTween = this.scene.tweens.addCounter({
          from: 0,
          to: 1,
          duration: leapDuration,
          onUpdate: (tw) => {
            if (!this.active || !this.scene) return;
            const t = Number(tw.getValue() ?? 0);
            const arc = 4 * t * (1 - t);
            const yOffset = -arc * leapHeight;

            if (this.baseSprite) this.baseSprite.y = yOffset;
            if (this.markingSprite) this.markingSprite.y = yOffset;

            if (this.shadow) {
              this.shadow.setScale(1 - arc * 0.45);
              this.shadow.setAlpha(0.22 * (1 - arc * 0.55));
            }

            if (t > 0.52 && !switchedToDescent) {
              switchedToDescent = true;
              this.playSpecificAnimation('pounce_descent');
            }
          },
          onComplete: () => {
            this.activePounceCounterTween = null;
            if (!this.active || !this.scene || this.isDragged) {
              this.isPouncing = false;
              if (this.baseSprite) { this.baseSprite.y = 0; this.baseSprite.setScale(scale); }
              if (this.markingSprite) { this.markingSprite.y = 0; this.markingSprite.setScale(scale); }
              return;
            }

            if (this.baseSprite) this.baseSprite.y = 0;
            if (this.markingSprite) this.markingSprite.y = 0;
            if (this.shadow) {
              this.shadow.setScale(1);
              this.shadow.setAlpha(0.22);
            }

            // ── Phase 4: Landing & Impact (130ms, 2nd running frame) ─────────
            this.playSpecificAnimation('pounce_land');
            this.spawnPounceDust();

            // Landing squash and settle
            this.activePounceLandTween = this.scene.tweens.add({
              targets: [this.baseSprite, this.markingSprite].filter(Boolean),
              scaleX: scale * 1.22,
              scaleY: scale * 0.76,
              duration: 80,
              yoyo: true,
              ease: 'Quad.easeOut',
              onComplete: () => {
                this.activePounceLandTween = null;
                this.isPouncing = false;
                if (this.baseSprite) this.baseSprite.setScale(scale);
                if (this.markingSprite) this.markingSprite.setScale(scale);
                if (onLand) {
                  onLand();
                } else {
                  // Phase 5: Settle to normal animations
                  const roll = Math.random();
                  const isSitting = roll < 0.45;
                  this.cat.animationState = isSitting ? 'sit' : roll < 0.75 ? 'look' : 'walk';
                  this.wanderTimer = isSitting ? (6.0 + Math.random() * 8.0) : (1.5 + Math.random() * 2.0);
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
    const dustGfx = CatSprite.getPooledGraphics(this.scene);
    if (!dustGfx) return;
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
        CatSprite.recycleGraphics(dustGfx);
      },
    });
  }

  private playCurrentAnimation(): void {
    const animState = this.cat.animationState;
    const dir = this.currentDirection;

    if (animState === 'sit') {
      const sitDownKey = `cat_${this.cat.color}_sit_down_${dir}`;
      const sitLoopKey = `cat_${this.cat.color}_sit_${dir}`;
      const curKey = this.baseSprite.anims.currentAnim?.key;

      if (curKey !== sitLoopKey && curKey !== sitDownKey) {
        if (this.scene.anims.exists(sitDownKey) && this.scene.anims.exists(sitLoopKey)) {
          this.baseSprite.play(sitDownKey, true).chain(sitLoopKey);
        } else if (this.scene.anims.exists(sitLoopKey)) {
          this.baseSprite.play(sitLoopKey, true);
        }
      } else if (curKey === sitDownKey && !this.baseSprite.anims.isPlaying) {
        if (this.scene.anims.exists(sitLoopKey)) {
          this.baseSprite.play(sitLoopKey, true);
        }
      }

      if (this.markingSprite && this.cat.marking) {
        const markingDownKey = `marking_${this.cat.marking}_sit_down_${dir}`;
        const markingLoopKey = `marking_${this.cat.marking}_sit_${dir}`;
        const curMarkingKey = this.markingSprite.anims.currentAnim?.key;

        if (curMarkingKey !== markingLoopKey && curMarkingKey !== markingDownKey) {
          if (this.scene.anims.exists(markingDownKey) && this.scene.anims.exists(markingLoopKey)) {
            this.markingSprite.play(markingDownKey, true).chain(markingLoopKey);
          } else if (this.scene.anims.exists(markingLoopKey)) {
            this.markingSprite.play(markingLoopKey, true);
          }
        } else if (curMarkingKey === markingDownKey && !this.markingSprite.anims.isPlaying) {
          if (this.scene.anims.exists(markingLoopKey)) {
            this.markingSprite.play(markingLoopKey, true);
          }
        }
      }
    } else {
      const baseKey = `cat_${this.cat.color}_${animState}_${dir}`;
      if (this.scene.anims.exists(baseKey)) this.baseSprite.play(baseKey, true);
      if (this.markingSprite && this.cat.marking) {
        const markingKey = `marking_${this.cat.marking}_${animState}_${dir}`;
        if (this.scene.anims.exists(markingKey)) this.markingSprite.play(markingKey, true);
      }
    }

    this.sleepZzz.setAlpha(animState === 'sleep' ? 1 : 0);
  }

  private updateDirtGfx(): void {
    if (this.cat.cleanliness >= 40) {
      if (this.dirtGfx.visible) {
        this.dirtGfx.clear();
        this.dirtGfx.setVisible(false);
      }
      return;
    }
    this.dirtGfx.setVisible(true);
    this.dirtGfx.clear();
    const scale = getScaleForCat(this.cat);
    this.dirtGfx.fillStyle(0x6b4f2c, 0.7);
    this.dirtGfx.fillCircle(-6 * (scale / BASE_SPRITE_SCALE), -4 * (scale / BASE_SPRITE_SCALE), 3);
    this.dirtGfx.fillCircle(8 * (scale / BASE_SPRITE_SCALE), 2 * (scale / BASE_SPRITE_SCALE), 2.5);
    this.dirtGfx.fillCircle(2 * (scale / BASE_SPRITE_SCALE), -12 * (scale / BASE_SPRITE_SCALE), 2);
  }

  update(deltaMs: number): void {
    if (isNaN(this.x) || !isFinite(this.x)) this.x = (this.bounds.left + this.bounds.right) / 2;
    if (isNaN(this.y) || !isFinite(this.y)) this.y = (this.bounds.top + this.bounds.bottom) / 2;

    if (this.isDragged) {
      this.setDepth(850);
      return;
    }
    if (this.isPouncing) {
      this.setDepth(Math.min(840, this.y));
      return;
    }
    const dt = Math.min(0.1, Math.max(0, deltaMs / 1000));
    const startX = this.x;
    const startY = this.y;

    // ── Ambient meow timer (every 5–20 s, staggered) ──────────────────────
    this.ambientMeowTimer -= dt;
    if (this.ambientMeowTimer <= 0) {
      this.ambientMeowTimer = 50 + Math.random() * 150;
      if (this.cat.animationState !== 'sleep') {
        const mutDef = this.cat.mutation ? MUTATION_CATALOG[this.cat.mutation] : null;
        const pitch = mutDef ? mutDef.meowPitch : 1;
        if (this.cat.stage === 'kitten') {
          sound.playKittenMeow(false, pitch);
        } else {
          sound.playMeow(pitch);
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

    // ── Concentric Circles Rain Ritual AI ──────────────────────────────────
    if (this.isRainDanceActive) {
      this.rainDanceAngle += this.rainDanceDirection * this.rainDanceOmega * dt;
      const targetX = this.rainDanceCenterX + Math.cos(this.rainDanceAngle) * this.rainDanceRadius;
      const targetY = this.rainDanceCenterY + Math.sin(this.rainDanceAngle) * this.rainDanceRadius;

      const dx = targetX - this.x;
      const dy = targetY - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 4) {
        const speed = Math.min(190, Math.max(75, dist * 5)) * dt;
        this.x += (dx / dist) * speed;
        this.y += (dy / dist) * speed;
      } else {
        this.x = targetX;
        this.y = targetY;
      }

      this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
      this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);

      // Tangent vector of circle along orbit direction:
      // CW (+1): (-sin(theta), cos(theta))
      // CCW (-1): (sin(theta), -cos(theta))
      const tangentX = -this.rainDanceDirection * Math.sin(this.rainDanceAngle);
      const tangentY = this.rainDanceDirection * Math.cos(this.rainDanceAngle);
      this.currentDirection = vectorToDirection(tangentX, tangentY);

      this.cat.animationState = 'walk';
      this.playCurrentAnimation();

      this.rainDanceEmoteTimer -= dt;
      if (this.rainDanceEmoteTimer <= 0) {
        this.rainDanceEmoteTimer = 2.5 + Math.random() * 3.0;
        const rainEmotes = ['🌧️', '✨', '🌀', '🐾', '💧', '🔮', '😻'];
        this.showEmote(Phaser.Math.RND.pick(rainEmotes));
      }

      this.setDepth(this.y);
      return;
    }

    // ── Unified Dance Formations AI ────────────────────────────────────────
    if (this.activeDanceType !== 'none') {
      let targetX = this.x;
      let targetY = this.y;
      let targetAnim: CatAnimationState = 'walk';

      if (this.activeDanceType === 'snowflake') {
        this.danceParamU += dt * 1.6;
        const pulse = 0.5 + 0.5 * Math.cos(this.danceParamU);
        const currentDist = 35 + (this.danceRadius - 35) * pulse;
        targetX = this.danceCenterX + Math.cos(this.danceAngle) * currentDist;
        targetY = this.danceCenterY + Math.sin(this.danceAngle) * currentDist;
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 3) {
          const moveSpeed = Math.min(180, Math.max(65, dist * 4)) * dt;
          this.x += (dx / dist) * moveSpeed;
          this.y += (dy / dist) * moveSpeed;
          this.currentDirection = vectorToDirection(dx, dy);
        }
        targetAnim = pulse < 0.15 || pulse > 0.85 ? 'knead' : 'walk';

        this.danceEmoteTimer -= dt;
        if (this.danceEmoteTimer <= 0) {
          this.danceEmoteTimer = 2.0 + Math.random() * 2.5;
          this.showEmote(Phaser.Math.RND.pick(['❄️', '✨', '💎', '🌟', '🐾']));
        }
      } else if (this.activeDanceType === 'heart') {
        this.danceParamU += dt * 3.4;
        const u = this.danceAngle;
        const sinU = Math.sin(u);
        const xCardioid = 16 * sinU * sinU * sinU;
        const yCardioid = -(13 * Math.cos(u) - 5 * Math.cos(2 * u) - 2 * Math.cos(3 * u) - Math.cos(4 * u));
        const pulseScale = 6.8 * (1 + 0.14 * Math.sin(this.danceParamU));

        targetX = this.danceCenterX + xCardioid * pulseScale;
        targetY = this.danceCenterY + yCardioid * pulseScale;
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 4) {
          const moveSpeed = Math.min(220, Math.max(80, dist * 5)) * dt;
          this.x += (dx / dist) * moveSpeed;
          this.y += (dy / dist) * moveSpeed;
        }
        // Face inward toward center
        this.currentDirection = vectorToDirection(this.danceCenterX - this.x, this.danceCenterY - this.y);
        targetAnim = 'knead';

        this.danceEmoteTimer -= dt;
        if (this.danceEmoteTimer <= 0) {
          this.danceEmoteTimer = 1.8 + Math.random() * 2.2;
          this.showEmote(Phaser.Math.RND.pick(['💖', '❤️', '🥰', '💕', '✨', '😻']));
        }
      } else if (this.activeDanceType === 'infinity') {
        this.danceParamU += dt * this.danceParamSpeed;
        const u = this.danceParamU;
        const sinU = Math.sin(u);
        const denom = 1 + sinU * sinU;
        const A = 165;
        const xInf = (A * Math.cos(u)) / denom;
        const yInf = (A * sinU * Math.cos(u)) / denom;

        // Apply tilt / offset rotation to support dual interlocking tracks
        const cosTilt = Math.cos(this.danceInfinityTilt);
        const sinTilt = Math.sin(this.danceInfinityTilt);
        const rotX = xInf * cosTilt - yInf * sinTilt;
        const rotY = xInf * sinTilt + yInf * cosTilt;

        targetX = this.danceCenterX + rotX;
        targetY = this.danceCenterY + rotY;
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 4) {
          const moveSpeed = Math.min(300, Math.max(120, dist * 6)) * dt;
          this.x += (dx / dist) * moveSpeed;
          this.y += (dy / dist) * moveSpeed;
        }

        // Derivative tangent vector along travel direction for velocity facing
        const uNext = u + (this.danceParamSpeed >= 0 ? 0.06 : -0.06);
        const sinNext = Math.sin(uNext);
        const denomNext = 1 + sinNext * sinNext;
        const xNext = (A * Math.cos(uNext)) / denomNext;
        const yNext = (A * sinNext * Math.cos(uNext)) / denomNext;
        const rotNextX = xNext * cosTilt - yNext * sinTilt;
        const rotNextY = xNext * sinTilt + yNext * cosTilt;
        this.currentDirection = vectorToDirection(rotNextX - rotX, rotNextY - rotY);
        targetAnim = 'run';

        this.danceEmoteTimer -= dt;
        if (this.danceEmoteTimer <= 0) {
          this.danceEmoteTimer = 1.5 + Math.random() * 2.0;
          this.showEmote(Phaser.Math.RND.pick(['♾️', '⚡', '🐾', '💨', '✨', '😸']));
        }
      } else if (this.activeDanceType === 'sunset') {
        this.danceElapsedTime += dt;
        // Dynamically tighten spiral radius over 18s duration (from 100% down to 26% of initial radius)
        const progress = Math.min(1, this.danceElapsedTime / 18.0);
        const tightenFactor = Math.max(0.26, 1.0 - progress * 0.74);
        const currentRadius = this.danceRadius * tightenFactor;

        // Angular acceleration as radius tightens (vortex spin effect)
        const speedMultiplier = 1.0 + progress * 0.95;
        this.danceParamU += dt * this.danceParamSpeed * speedMultiplier;
        const angle = this.danceAngle + this.danceParamU;

        targetX = this.danceCenterX + Math.cos(angle) * currentRadius;
        targetY = this.danceCenterY + Math.sin(angle) * currentRadius;
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 3) {
          const moveSpeed = Math.min(210, Math.max(75, dist * 5)) * dt;
          this.x += (dx / dist) * moveSpeed;
          this.y += (dy / dist) * moveSpeed;
        }
        // Tangent facing
        this.currentDirection = vectorToDirection(-Math.sin(angle), Math.cos(angle));
        targetAnim = 'walk';

        this.danceEmoteTimer -= dt;
        if (this.danceEmoteTimer <= 0) {
          this.danceEmoteTimer = 2.0 + Math.random() * 2.5;
          this.showEmote(Phaser.Math.RND.pick(['🌅', '🎶', '✨', '⭐', '💫', '🧡']));
        }
      } else if (this.activeDanceType === 'constellation') {
        targetX = this.danceTargetX;
        targetY = this.danceTargetY;
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 5) {
          const moveSpeed = Math.min(200, Math.max(70, dist * 4)) * dt;
          this.x += (dx / dist) * moveSpeed;
          this.y += (dy / dist) * moveSpeed;
          this.currentDirection = vectorToDirection(dx, dy);
          targetAnim = 'walk';
        } else {
          this.x = targetX;
          this.y = targetY;
          this.currentDirection = 0; // Front facing South
          targetAnim = 'sit';
        }

        this.danceEmoteTimer -= dt;
        if (this.danceEmoteTimer <= 0) {
          this.danceEmoteTimer = 2.2 + Math.random() * 2.5;
          this.showEmote(Phaser.Math.RND.pick(['🐱', '🌟', '✨', '🔮', '😻', '⭐']));
        }
      }

      this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
      this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);

      this.cat.animationState = targetAnim;
      this.playCurrentAnimation();
      this.setDepth(this.y);
      return;
    }

    // ── Grand Cat Conga Line Event Processing (Maximum Sprint Speed) ─────────
    if (this.isCongaParadeActive) {
      this.congaEmoteTimer -= dt;
      if (this.congaEmoteTimer <= 0) {
        this.congaEmoteTimer = 1.8 + Math.random() * 2.2;
        const emotes = this.isCongaLeader ? ['👑', '🎶', '⚡', '🎉', '💃', '🐾'] : ['🎵', '🎶', '🎉', '🐾', '✨', '😻', '💃'];
        this.showEmote(Phaser.Math.RND.pick(emotes));
      }

      if (this.isCongaLeader) {
        if (this.congaWaypoints.length > 0) {
          const target = this.congaWaypoints[this.congaWaypointIndex % this.congaWaypoints.length];
          const dx = target.x - this.x;
          const dy = target.y - this.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 36) {
            this.congaWaypointIndex = (this.congaWaypointIndex + 1) % this.congaWaypoints.length;
          } else {
            const sprintSpeed = 280 * dt; // Full-speed sprint run!
            this.x += (dx / dist) * sprintSpeed;
            this.y += (dy / dist) * sprintSpeed;
            this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
            this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);
            this.currentDirection = vectorToDirection(dx, dy);
            this.cat.animationState = 'run';
            this.playCurrentAnimation();
          }
        }
        this.setDepth(this.y);
        return;
      } else if (this.congaFollowTarget) {
        if (!this.congaFollowTarget.active) {
          this.congaFollowTarget = this.congaFollowTarget.congaFollowTarget;
        }

        if (this.congaFollowTarget) {
          const leader = this.congaFollowTarget;
          const dirAngle = (leader.currentDirection * 45 + 90) * Phaser.Math.DEG_TO_RAD;
          const trailDist = this.cat.stage === 'kitten' ? 32 : 36;
          const targetX = Phaser.Math.Clamp(leader.x - Math.cos(dirAngle) * trailDist + this.followOffsetX * 0.2, this.bounds.left + 24, this.bounds.right - 24);
          const targetY = Phaser.Math.Clamp(leader.y - Math.sin(dirAngle) * trailDist + this.followOffsetY * 0.2, this.bounds.top + 24, this.bounds.bottom - 24);

          const dx = targetX - this.x;
          const dy = targetY - this.y;
          const dist = Math.hypot(dx, dy);

          if (dist > 8) {
            const catchUp = dist > 90 ? 1.5 : dist > 45 ? 1.25 : 1.0;
            const followerSpeed = Math.min(320, 280 * catchUp) * dt;
            this.x += (dx / dist) * followerSpeed;
            this.y += (dy / dist) * followerSpeed;
            this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
            this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);
            this.currentDirection = vectorToDirection(dx, dy);
            this.cat.animationState = 'run';
            this.playCurrentAnimation();
          } else {
            this.cat.animationState = 'run';
            this.currentDirection = leader.currentDirection;
            this.playCurrentAnimation();
          }
        }
        this.setDepth(this.y);
        return;
      }
    }

    // ── Autonomous Brush Fleeing Sprint ────────────────────────────────────
    if (this.brushFleeCooldown > 0) this.brushFleeCooldown -= dt;

    if (this.brushFleeTimer > 0) {
      this.brushFleeTimer -= dt;
      if (!this.brushFleeTarget || this.brushFleeTimer <= 0) {
        this.brushFleeTimer = 0;
        this.brushFleeTarget = null;
        this.cat.animationState = 'look';
        this.wanderTimer = 1.8;
        this.playCurrentAnimation();
        this.setDepth(this.y);
        return;
      }

      this.brushFleeDustTimer -= dt;
      if (this.brushFleeDustTimer <= 0) {
        this.brushFleeDustTimer = 0.11;
        this.spawnPounceDust();
      }

      const dx = this.brushFleeTarget.x - this.x;
      const dy = this.brushFleeTarget.y - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 14) {
        this.brushFleeTimer = 0;
        this.brushFleeTarget = null;
        this.cat.animationState = 'look';
        this.wanderTimer = 1.8;
        this.playCurrentAnimation();
      } else {
        const speed = (this.cat.stage === 'kitten' ? 200 : 185) * dt;
        this.x += (dx / dist) * speed;
        this.y += (dy / dist) * speed;
        this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
        this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);
        this.currentDirection = vectorToDirection(dx, dy);
        this.cat.animationState = 'run';
        this.playCurrentAnimation();
      }
      this.setDepth(this.y);
      return;
    }

    // ── Breed-ready heart emote (adult, not sleeping, cooldown expired) ────
    if (this.isBreedReady && this.cat.stage === 'adult' && this.cat.animationState !== 'sleep') {
      this.breedReadyHeartTimer -= dt;
      if (this.breedReadyHeartTimer <= 0) {
        this.breedReadyHeartTimer = 15 + Math.random() * 15;
        this.showEmote('❤️');
      }
    }

    // ── Mutation Dynamic Ambient Color & Particle Updates ──────────────────
    const now = Date.now();
    if (this.cat.mutation === 'chromatic') {
      this.chromaticHue = (this.chromaticHue + dt * 90) % 360;
      const tintHex = hslToHexFast(this.chromaticHue, 0.88, 0.65);
      this.baseSprite.setTint(tintHex);
      if (this.markingSprite) this.markingSprite.setTint(tintHex);
    } else if (this.cat.mutation === 'stinky') {
      const stinkyT = (Math.sin(now / 450) + 1) / 2;
      const tintHex = lerpHexColor(0x855b32, 0x4ade80, stinkyT);
      this.baseSprite.setTint(tintHex);
      if (this.markingSprite) this.markingSprite.setTint(tintHex);
    } else if (this.cat.mutation === 'frosted') {
      const iceT = (Math.sin(now / 380) + 1) / 2;
      const tintHex = lerpHexColor(0xcffafe, 0x0284c7, iceT);
      this.baseSprite.setTint(tintHex);
      if (this.markingSprite) this.markingSprite.setTint(tintHex);
    } else if (this.cat.mutation === 'flaming') {
      const fireT = (Math.sin(now / 300) + 1) / 2;
      const tintHex = lerpHexColor(0xdc2626, 0xfbbf24, fireT);
      this.baseSprite.setTint(tintHex);
      if (this.markingSprite) this.markingSprite.setTint(tintHex);
    } else if (this.cat.mutation === 'gilded') {
      const goldT = (Math.sin(now / 340) + 1) / 2;
      const tintHex = lerpHexColor(0xca8a04, 0xfef08a, goldT);
      this.baseSprite.setTint(tintHex);
      if (this.markingSprite) this.markingSprite.setTint(tintHex);
    } else if (this.cat.mutation === 'sparkly') {
      const sparkT = (Math.sin(now / 320) + 1) / 2;
      const tintHex = lerpHexColor(0xd946ef, 0xf472b6, sparkT);
      this.baseSprite.setTint(tintHex);
      if (this.markingSprite) this.markingSprite.setTint(tintHex);
    } else if (this.cat.mutation === 'inverted') {
      const invT = (Math.sin(now / 360) + 1) / 2;
      const tintHex = lerpHexColor(0x06b6d4, 0x818cf8, invT);
      this.baseSprite.setTint(tintHex);
      if (this.markingSprite) this.markingSprite.setTint(tintHex);
    } else if (this.cat.mutation === 'angelic') {
      const angT = (Math.sin(now / 420) + 1) / 2;
      const tintHex = lerpHexColor(0xfefce8, 0xfde047, angT);
      this.baseSprite.setTint(tintHex);
      if (this.markingSprite) this.markingSprite.setTint(tintHex);
      if (this.haloGfx) {
        this.haloGfx.y = Math.sin(now / 200) * 2;
      }
    }

    this.mutationEmitterTimer -= dt;
    if (this.mutationEmitterTimer <= 0) {
      this.spawnMutationParticles();
    }

    // ── Biscuit Kneading Purr & Heart Ripples ───────────────────────────
    if (this.cat.animationState === 'knead') {
      this.biscuitPuffTimer -= dt;
      if (this.biscuitPuffTimer <= 0) {
        this.biscuitPuffTimer = 0.85 + Math.random() * 0.45;
        this.spawnBiscuitHeart();
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
          const safeDist = Math.max(0.01, dist);
          this.x += (dx / safeDist) * speed;
          this.y += (dy / safeDist) * speed;
          this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
          this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);
          this.currentDirection = vectorToDirection(dx, dy);
          this.cat.animationState = 'run';
          this.playCurrentAnimation();
        }
      } else {
        // All mates visited or alone in room: run joyous zoomie victory lap with floating hearts
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
        if (dist > 6) {
          const speed = 175 * dt;
          const safeDist = Math.max(0.01, dist);
          this.x += (dx / safeDist) * speed;
          this.y += (dy / safeDist) * speed;
          this.currentDirection = vectorToDirection(dx, dy);
          this.cat.animationState = 'run';
          this.playCurrentAnimation();
        } else {
          this.wanderTarget = null;
          this.cat.animationState = 'sit';
          this.playCurrentAnimation();
        }
      }

      if (this.perfumeFrenzyTimer <= 0) {
        this.showEmote('🥰');
        this.cat.animationState = 'sit';
        this.wanderTimer = 12.0 + Math.random() * 8.0;
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
      if (shouldWakeUp(this.cat)) {
        this.cat.animationState = 'sit';
        this.wanderTimer = 8.0 + Math.random() * 8.0;
        this.playCurrentAnimation();
      }
      return;
    }
    if (this.cat.animationState === 'play') {
      this.wanderTimer -= dt;
      // Rare chirp while playing (1/20 chance every 40-80s)
      if (this.chirpCooldown <= 0) {
        this.chirpCooldown = 40 + Math.random() * 40;
        if (Math.random() < 0.05) {
          sound.playChirp();
        }
      }
      if (this.wanderTimer <= 0) {
        const roll = Math.random();
        const isSitting = roll < 0.5;
        this.cat.animationState = isSitting ? 'sit' : roll < 0.8 ? 'look' : 'lay';
        this.wanderTimer = isSitting ? (8.0 + Math.random() * 10.0) : (2.0 + Math.random() * 2.5);
        this.playCurrentAnimation();
      }
      return;
    }

    // ── Active Toy Ball Chase ─────────────────────────────────────────────
    if (this.chaseTarget) {
      const dist = Math.hypot(this.chaseTarget.x - this.x, this.chaseTarget.y - this.y);
      if (dist > 12) {
        const speed = (this.cat.stage === 'kitten' ? 140 : 165) * ((this.cat.majorTrait === 'zoomie' || this.cat.minorTrait === 'zoomie') ? 1.4 : 1) * dt;
        const safeDist = Math.max(0.01, dist);
        this.x += ((this.chaseTarget.x - this.x) / safeDist) * speed;
        this.y += ((this.chaseTarget.y - this.y) / safeDist) * speed;
        this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
        this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);
        this.currentDirection = vectorToDirection(this.chaseTarget.x - this.x, this.chaseTarget.y - this.y);
        this.cat.animationState = 'run';
        this.playCurrentAnimation();
      } else {
        // Reached chase destination: clear target and settle
        this.clearChaseTarget();
        this.cat.animationState = 'sit';
        this.wanderTimer = 8.0 + Math.random() * 8.0;
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

    // ── Zoomie Tornado High-Speed Laps ────────────────────────────────────
    if (this.isZoomieTornado) {
      if (this.zoomieWaypointIndex >= this.zoomieWaypoints.length || this.wanderTimer <= 0) {
        this.isZoomieTornado = false;
        this.zoomieWaypoints = [];
        this.cat.animationState = 'look';
        this.wanderTimer = 3.5;
        this.cat.fun = Math.min(100, this.cat.fun + 25);
        this.cat.energy = Math.max(10, this.cat.energy - 8);
        this.playCurrentAnimation();
        this.spawnPounceDust();
        this.showEmote('💨');
        return;
      }

      this.zoomieDustTimer -= dt;
      if (this.zoomieDustTimer <= 0) {
        this.zoomieDustTimer = 0.10;
        this.spawnPounceDust();
      }

      const target = this.zoomieWaypoints[this.zoomieWaypointIndex];
      const dist = Math.hypot(target.x - this.x, target.y - this.y);
      if (dist < 22) {
        this.zoomieWaypointIndex++;
      } else {
        const speed = 195 * dt;
        this.x += ((target.x - this.x) / dist) * speed;
        this.y += ((target.y - this.y) / dist) * speed;
        this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
        this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);
        this.currentDirection = vectorToDirection(target.x - this.x, target.y - this.y);
        this.cat.animationState = 'run';
        this.playCurrentAnimation();
        this.setDepth(this.y);
        return;
      }
    }

    // ── Active Peek-a-Boo Ambush Stance ────────────────────────────────────
    if (this.isAmbushing) {
      if (!this.ambushTargetSprite || !this.ambushTargetSprite.active || this.ambushTargetSprite.isCurrentlyDragged() || this.ambushWaitTimer <= 0) {
        this.isAmbushing = false;
        this.ambushTargetSprite = null;
        this.cat.animationState = 'sit';
        this.wanderTimer = 4.0;
        this.playCurrentAnimation();
      } else {
        this.ambushWaitTimer -= dt;
        const distToTarget = Math.hypot(this.ambushTargetSprite.x - this.x, this.ambushTargetSprite.y - this.y);
        this.currentDirection = vectorToDirection(this.ambushTargetSprite.x - this.x, this.ambushTargetSprite.y - this.y);
        this.playSpecificAnimation('pounce_prep');

        if (distToTarget <= 75 && !this.isPouncing) {
          const victim = this.ambushTargetSprite;
          this.isAmbushing = false;
          this.ambushTargetSprite = null;
          this.executePounce(victim.x, victim.y, () => {
            victim.showEmote('🙀');
            this.showEmote('🎉');
            sound.playPop();
            this.cat.fun = Math.min(100, this.cat.fun + 15);
            victim.cat.fun = Math.min(100, victim.cat.fun + 10);
            this.startChasingCat(victim);
            victim.startFleeingFrom(this);
          });
          return;
        }
        this.setDepth(this.y);
        return;
      }
    }

    // ── Stationary / Resting Cat CPU Fast-Path ────────────────────────────
    const isRestingState = this.cat.animationState === 'sit' || this.cat.animationState === 'lay' || this.cat.animationState === 'knead';
    const hasActiveDynamicGoal = this.wanderTarget || this.chasingCatSprite || this.fleeingFromCatSprite || this.followingAdultSprite || this.brushFleeTarget || this.isAmbushing || this.isZoomieTornado || this.perfumeFrenzyTimer > 0 || this.isCongaParadeActive || this.isRainDanceActive;

    if (isRestingState && !hasActiveDynamicGoal) {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.pickNewWanderTarget();
      }
      return;
    }

    // ── Cat Soccer / Autonomous Toy Ball Swatting ───────────────────────────
    if (this.toyBallProvider && !this.isPouncing && !this.isDragged) {
      const ball = this.toyBallProvider();
      if (ball && ball.active && this.bounds.contains(ball.x, ball.y)) {
        const dx = ball.x - this.x;
        const dy = ball.y - this.y;
        const dist2 = dx * dx + dy * dy;

        if (dist2 < 36 * 36 && ball.canBeBatted) {
          let kickAngle = Math.atan2(dy, dx);
          if (this.otherSpritesProvider && Math.random() < 0.65) {
            const others = this.otherSpritesProvider();
            let passTarget: CatSprite | null = null;
            let count = 0;
            for (let i = 0; i < others.length; i++) {
              const s = others[i];
              if (s === this || !s.active || s.cat.animationState === 'sleep' || s.isCurrentlyDragged() || !this.bounds.contains(s.x, s.y)) continue;
              count++;
              if (Math.random() < 1 / count) {
                passTarget = s;
              }
            }
            if (passTarget) {
              kickAngle = Math.atan2(passTarget.y - ball.y, passTarget.x - ball.x);
            }
          }

          const power = Phaser.Math.Between(280, 520);
          ball.kick(Math.cos(kickAngle) * power, Math.sin(kickAngle) * power);
          sound.playPop();

          this.triggerPlayState(1.2);
          this.showEmote(Math.random() < 0.5 ? '⚽' : '🧶');
        } else if (dist2 < 180 * 180 && !this.wanderTarget && !this.followingAdultSprite && !this.isAmbushing) {
          // ANY cat regardless of fun level will excitedly chase and kick the toy ball!
          if (Math.random() < 0.60) {
            this.wanderTarget = new Phaser.Math.Vector2(ball.x, ball.y);
            this.cat.animationState = 'run';
            this.wanderTimer = 3.5;
            this.playCurrentAnimation();
          }
        }
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
          const others = this.otherSpritesProvider();
          const min2 = 45 * 45;
          const max2 = 230 * 230;
          let candidate: CatSprite | null = null;
          let candidateCount = 0;

          for (let i = 0; i < others.length; i++) {
            const o = others[i];
            if (o === this || !o.active || o.cat.animationState === 'sleep' || o.isCurrentlyDragged() || o.isChasing() || o.isFleeing() || o.chaseTarget) continue;
            const dx = o.x - this.x;
            const dy = o.y - this.y;
            const d2 = dx * dx + dy * dy;
            if (d2 >= min2 && d2 <= max2) {
              candidateCount++;
              if (Math.random() < 1 / candidateCount) {
                candidate = o;
              }
            }
          }

          if (candidate) {
            this.startChasingCat(candidate);
            candidate.startFleeingFrom(this);
          }
        }
      }
    }

    // ── Kitten Follow the Leader AI (Loose, Smooth, Hysteresis Connection) ─
    if (this.followingAdultSprite) {
      const leader = this.followingAdultSprite;
      if (!leader.active || leader.isCurrentlyDragged() || this.followLeaderTimer <= 0) {
        // If direct leader was following someone else, smoothly promote target to keep the parade alive!
        const nextLeader = leader.getFollowTarget?.();
        if (nextLeader && nextLeader.active && !nextLeader.isCurrentlyDragged() && this.bounds.contains(nextLeader.x, nextLeader.y) && !nextLeader.isFollowChainAncestor(this)) {
          this.followingAdultSprite = nextLeader;
          this.followLeaderTimer = 22.0 + Math.random() * 15.0;
          this.followOffsetX = Phaser.Math.Between(-28, 28);
          this.followOffsetY = Phaser.Math.Between(-24, 24);
          if (Math.abs(this.followOffsetX) < 12 && Math.abs(this.followOffsetY) < 12) {
            this.followOffsetX = 20;
          }
        } else {
          this.followingAdultSprite = null;
          this.followLeaderTimer = 0;
          this.isFollowingWalking = false;
        }
      } else {
        this.followLeaderTimer -= dt;
        this.wanderTarget = null; // Prevent random wandering from interfering

        const leaderMoving = leader.cat.animationState === 'walk' || leader.cat.animationState === 'run';

        // Calculate a comfortable trailing anchor position behind leader
        let targetX: number;
        let targetY: number;

        if (leaderMoving) {
          // Trail behind the leader's current direction
          const dirAngle = (leader.currentDirection * 45 + 90) * Phaser.Math.DEG_TO_RAD;
          const trailDist = this.cat.stage === 'kitten' ? 34 : 38;
          targetX = leader.x - Math.cos(dirAngle) * trailDist + this.followOffsetX * 0.25;
          targetY = leader.y - Math.sin(dirAngle) * trailDist + this.followOffsetY * 0.25;
        } else {
          // Settle naturally beside the resting leader
          targetX = leader.x + this.followOffsetX;
          targetY = leader.y + this.followOffsetY;
        }

        targetX = Phaser.Math.Clamp(targetX, this.bounds.left + 24, this.bounds.right - 24);
        targetY = Phaser.Math.Clamp(targetY, this.bounds.top + 24, this.bounds.bottom - 24);

        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const distToTarget = Math.hypot(dx, dy);
        const distToLeader = Math.hypot(leader.x - this.x, leader.y - this.y);

        // Hysteresis: start moving if pulled away (> 38px or leader moving & pulled away), stop when close (< 14px)
        if (!this.isFollowingWalking) {
          if (distToTarget > 38 || (leaderMoving && distToLeader > 34)) {
            this.isFollowingWalking = true;
          }
        } else {
          if (distToTarget < 14) {
            this.isFollowingWalking = false;
          }
        }

        if (this.isFollowingWalking && distToTarget > 3) {
          const catchUpMult = distToTarget > 90 ? 1.5 : distToTarget > 45 ? 1.25 : 1.0;
          const baseSpeed = (this.isCongaParadeActive || leader.cat.animationState === 'run') ? 245 : 50;
          const speed = Math.min(270, Math.max(30, baseSpeed * catchUpMult)) * dt;

          this.x += (dx / distToTarget) * speed;
          this.y += (dy / distToTarget) * speed;
          this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
          this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);

          // Direction deadband: only update direction if movement is clear to prevent flipping
          if (distToTarget > 8) {
            this.currentDirection = vectorToDirection(dx, dy);
          }
          this.cat.animationState = (this.isCongaParadeActive || leader.cat.animationState === 'run' || distToTarget > 70) ? 'run' : 'walk';
          this.playCurrentAnimation();

          if (this.isCongaParadeActive) {
            this.congaEmoteTimer -= dt;
            if (this.congaEmoteTimer <= 0) {
              this.congaEmoteTimer = 2.5 + Math.random() * 3.0;
              this.showEmote(Phaser.Math.RND.pick(['🎶', '🐾', '🎉', '😻', '💃', '✨']));
            }
          }
        } else {
          // Stationary in loose comfort zone
          if (!leaderMoving) {
            const leaderState = leader.cat.animationState;
            if (leaderState === 'knead' && Math.random() < 0.01) {
              this.triggerKneadBiscuits(4.0);
            } else if (leaderState === 'lay' || leaderState === 'sleep') {
              this.cat.animationState = 'lay';
              this.playCurrentAnimation();
            } else {
              this.cat.animationState = 'sit';
              this.playCurrentAnimation();
            }
            // Gentle orientation towards leader without twitching
            if (distToLeader > 16) {
              this.currentDirection = vectorToDirection(leader.x - this.x, leader.y - this.y);
              this.playCurrentAnimation();
            }
          } else {
            // Leader just started moving or is close: walk along in same direction
            this.cat.animationState = 'walk';
            this.currentDirection = leader.currentDirection;
            this.playCurrentAnimation();
          }
        }

        this.setDepth(this.y);
        return;
      }
    }

    // ── Anti-Crowding / Group Dispersion Check ────────────────────────────
    // If 3 or more cats gather in a tight bunch (or 2 stacked within 45px), disperse to open space
    this.crowdCheckTimer -= dt;
    if (this.crowdCheckTimer <= 0) {
      this.crowdCheckTimer = 1.5 + Math.random() * 2.0;
      if (!this.chaseTarget && !this.chasingCatSprite && !this.fleeingFromCatSprite && !this.followingAdultSprite) {
        const crowd = this.getNearbyCrowdInfo(85);
        if (crowd.count >= 2 || (crowd.count >= 1 && this.getNearbyCrowdInfo(45).count >= 1)) {
          // Crowd of 3+ cats (or tightly packed) -> walk away to a spacious area
          this.wanderTarget = this.findLeastCrowdedPosition();
          this.targetMachineId = null;
          this.targetFurnitureId = null;
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
        const reachedFurnitureId = this.targetFurnitureId;
        this.wanderTarget = null;
        this.targetMachineId = null;
        this.targetFurnitureId = null;

        if (reachedMachineId && this.machineUseCallback) {
          this.machineUseCallback(this.cat, reachedMachineId);
          this.cat.animationState = 'sit';
          this.wanderTimer = 14.0 + Math.random() * 8.0;
          this.playCurrentAnimation();
          this.showEmote('✨');
          return;
        }

        if (reachedFurnitureId) {
          if (reachedFurnitureId === 'plush_donut_bed' || reachedFurnitureId === 'sunbeam_mat') {
            this.triggerKneadBiscuits(4.0);
            this.showEmote('🍞');
            this.scene.time.delayedCall(4000, () => {
              if (this.active && this.cat.animationState === 'knead') {
                this.cat.animationState = Math.random() < 0.65 ? 'sleep' : 'lay';
                this.wanderTimer = 18.0 + Math.random() * 12.0;
                this.playCurrentAnimation();
                this.showEmote('💤');
              }
            });
            return;
          } else if (reachedFurnitureId === 'sisal_cat_tree') {
            this.triggerPlayState(4.0);
            this.showEmote('🧶');
            this.cat.fun = Math.min(100, this.cat.fun + 18);
            return;
          } else if (reachedFurnitureId === 'cardboard_castle') {
            this.cat.animationState = 'sit';
            this.wanderTimer = 8.0 + Math.random() * 6.0;
            this.playCurrentAnimation();
            this.showEmote('📦');
            return;
          } else if (reachedFurnitureId === 'fountain_dish') {
            this.cat.animationState = 'look';
            this.wanderTimer = 4.0;
            this.cat.cleanliness = Math.min(100, this.cat.cleanliness + 15);
            this.cat.hunger = Math.min(100, this.cat.hunger + 10);
            this.playCurrentAnimation();
            this.showEmote('💦');
            return;
          }
        }
        if (this.cat.stage === 'adult' && this.otherSpritesProvider) {
          const others = this.otherSpritesProvider();
          let nearbyKitten: CatSprite | null = null;
          const kDist2 = 45 * 45;
          for (let i = 0; i < others.length; i++) {
            const o = others[i];
            if (o === this || !o.active || o.cat.stage !== 'kitten') continue;
            const dx = o.x - this.x;
            const dy = o.y - this.y;
            if (dx * dx + dy * dy < kDist2 && (o.cat.cleanliness < 75 || o.cat.affection < 75)) {
              nearbyKitten = o;
              break;
            }
          }
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
            const others = this.otherSpritesProvider();
            const fDist2 = 65 * 65;
            for (let i = 0; i < others.length; i++) {
              const o = others[i];
              if (o === this || !o.active || o.cat.animationState === 'sleep') continue;
              const dx = o.x - this.x;
              const dy = o.y - this.y;
              if (dx * dx + dy * dy < fDist2 && (this.cat.friendshipIds[o.cat.id] ?? 0) >= 25) {
                if (o.getNearbyCrowdInfo(65).count <= 1) {
                  o.triggerPlayState(2.5);
                  o.showEmote('🎉');
                  this.showEmote('🧶');
                }
                break;
              }
            }
          }
        } else {
          const isSitting = roll < playChance + 0.32;
          this.cat.animationState = isSitting ? 'sit' : roll < playChance + 0.58 ? 'look' : 'lay';
          this.wanderTimer = isSitting ? (10.0 + Math.random() * 12.0) : (2.5 + Math.random() * 3.0);
        }
        this.playCurrentAnimation();
      } else {
        // Enforce moving animation state when translating position across the room
        if (this.cat.animationState !== 'run' && this.cat.animationState !== 'walk') {
          this.cat.animationState = 'walk';
        }
        const speed = (this.cat.animationState === 'run' ? 88 : 34) * ((this.cat.majorTrait === 'zoomie' || this.cat.minorTrait === 'zoomie') ? 1.35 : 1) * (this.cat.mutation === 'tiny' ? 1.25 : 1) * dt;
        const safeDist = Math.max(0.01, dist);
        this.x += ((this.wanderTarget.x - this.x) / safeDist) * speed;
        this.y += ((this.wanderTarget.y - this.y) / safeDist) * speed;
        this.x = Phaser.Math.Clamp(this.x, this.bounds.left + 24, this.bounds.right - 24);
        this.y = Phaser.Math.Clamp(this.y, this.bounds.top + 24, this.bounds.bottom - 24);
        this.currentDirection = vectorToDirection(this.wanderTarget.x - this.x, this.wanderTarget.y - this.y);
        this.playCurrentAnimation();
      }
    }

    // ── Motion & Animation State Sync Invariant ────────────────────────────
    // If the cat did not translate position this tick and is in a moving animation state, normalize to 'sit'
    const moved = Math.hypot(this.x - startX, this.y - startY) > 0.04;
    if (!moved && !this.isPouncing && !this.isDragged && (this.cat.animationState === 'walk' || this.cat.animationState === 'run')) {
      this.cat.animationState = 'sit';
      this.wanderTimer = 8.0 + Math.random() * 8.0;
      this.wanderTarget = null;
      this.targetMachineId = null;
      this.playCurrentAnimation();
    }

    this.setDepth(this.y);
  }

  getNearbyCrowdInfo(radius = 80): { count: number; avgX: number; avgY: number } {
    if (!this.otherSpritesProvider) return { count: 0, avgX: this.x, avgY: this.y };
    const others = this.otherSpritesProvider();
    const r2 = radius * radius;
    let count = 0;
    let sumX = 0;
    let sumY = 0;

    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (o === this || o.isCurrentlyDragged() || o.cat.animationState === 'sleep') continue;
      const dx = o.x - this.x;
      const dy = o.y - this.y;
      if (dx * dx + dy * dy < r2) {
        count++;
        sumX += o.x;
        sumY += o.y;
        if (count >= 3) break; // Early exit
      }
    }

    return {
      count,
      avgX: count > 0 ? sumX / count : this.x,
      avgY: count > 0 ? sumY / count : this.y,
    };
  }

  private findLeastCrowdedPosition(): Phaser.Math.Vector2 {
    const padding = 20;
    const minX = Math.min(this.bounds.left + padding, this.bounds.right - padding);
    const maxX = Math.max(this.bounds.left + padding, this.bounds.right - padding);
    const minY = Math.min(this.bounds.top + padding, this.bounds.bottom - padding);
    const maxY = Math.max(this.bounds.top + padding, this.bounds.bottom - padding);

    if (!this.otherSpritesProvider) {
      return new Phaser.Math.Vector2(Phaser.Math.Between(minX, maxX), Phaser.Math.Between(minY, maxY));
    }

    const others = this.otherSpritesProvider();
    let bestPos = new Phaser.Math.Vector2(Phaser.Math.Between(minX, maxX), Phaser.Math.Between(minY, maxY));
    let bestCrowdScore = 999999;
    const sampleCount = Math.min(others.length, 20);
    const r2 = 110 * 110;

    for (let i = 0; i < 3; i++) {
      const candX = Phaser.Math.Between(minX, maxX);
      const candY = Phaser.Math.Between(minY, maxY);
      let score = 0;

      for (let j = 0; j < sampleCount; j++) {
        const o = others[j];
        if (o === this || !o.active) continue;
        const dx = o.x - candX;
        const dy = o.y - candY;
        const d2 = dx * dx + dy * dy;
        if (d2 < r2) {
          score += (r2 - d2);
        }
      }

      if (score < bestCrowdScore) {
        bestCrowdScore = score;
        bestPos.set(candX, candY);
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
      // Senses available machines in this partition when under threshold
      const needyMachines = this.availableMachines.filter((m) => {
        if (!this.bounds.contains(m.x, m.y)) return false;
        let currentVal = 100;
        if (m.needType === 'food') currentVal = this.cat.hunger;
        else if (m.needType === 'wash' || m.needType === 'brush') currentVal = this.cat.cleanliness;
        else if (m.needType === 'pet') currentVal = this.cat.affection;
        else if (m.needType === 'toy') currentVal = this.cat.fun;

        return currentVal < m.threshold;
      });

      if (needyMachines.length > 0) {
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
      if (friend && this.bounds.contains(friend.x, friend.y)) {
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

    // ── Active Toy Ball Attraction in Wander AI ────────────────────────────
    if (this.toyBallProvider && !this.isPouncing && !this.isAmbushing && !this.isZoomieTornado) {
      const ball = this.toyBallProvider();
      if (ball && ball.active && this.bounds.contains(ball.x, ball.y)) {
        if (Math.random() < 0.55) {
          this.wanderTarget = new Phaser.Math.Vector2(ball.x, ball.y);
          this.cat.animationState = 'run';
          this.wanderTimer = 4.0;
          this.playCurrentAnimation();
          return;
        }
      }
    }

    // ── Zoomie Tornado Trigger ─────────────────────────────────────────────
    const isZoomie = this.cat.majorTrait === 'zoomie' || this.cat.minorTrait === 'zoomie';
    const isPlayfulKitten = isKitten && this.cat.energy > 50;
    const zoomieChance = isZoomie ? 0.35 : (isPlayfulKitten ? 0.20 : 0.05);
    if (Math.random() < zoomieChance && !this.isZoomieTornado && !this.isPouncing && !this.isAmbushing) {
      this.triggerZoomieTornado();
      return;
    }

    // ── Peek-a-Boo Ambush Trigger ──────────────────────────────────────────
    const isMischiefOrHunter = this.cat.majorTrait === 'mischievous' || this.cat.majorTrait === 'hunter' || this.cat.minorTrait === 'mischievous';
    const ambushChance = isMischiefOrHunter ? 0.35 : (isKitten ? 0.20 : 0.10);
    if (this.otherSpritesProvider && Math.random() < ambushChance && !this.isPouncing && !this.isAmbushing && !this.isZoomieTornado) {
      const others = this.otherSpritesProvider();
      const min2 = 50 * 50;
      const max2 = 130 * 130;
      let target: CatSprite | null = null;
      let count = 0;

      for (let i = 0; i < others.length; i++) {
        const s = others[i];
        if (s === this || !s.active || s.cat.animationState === 'sleep' || s.isCurrentlyDragged() || !this.bounds.contains(s.x, s.y)) continue;
        if (s.cat.animationState !== 'walk' && s.cat.animationState !== 'run') continue;
        const dx = s.x - this.x;
        const dy = s.y - this.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min2 && d2 <= max2) {
          count++;
          if (Math.random() < 1 / count) {
            target = s;
          }
        }
      }

      if (target) {
        this.isAmbushing = true;
        this.ambushTargetSprite = target;
        this.ambushWaitTimer = 2.5 + Math.random() * 2.0;
        this.cat.animationState = 'pounce';
        this.wanderTarget = null;
        this.showEmote('👀');
        return;
      }
    }

    // ── Nap Clumping / Cuddle Puddle AI ────────────────────────────────────
    const isTired = this.cat.energy < 40 || shouldFallAsleep(this.cat);
    if ((isTired || Math.random() < 0.32) && this.otherSpritesProvider) {
      const others = this.otherSpritesProvider();
      let cuddleBuddy: CatSprite | null = null;
      let sleepCount = 0;

      for (let i = 0; i < others.length; i++) {
        const s = others[i];
        if (s === this || !s.active || s.isCurrentlyDragged() || !this.bounds.contains(s.x, s.y)) continue;
        if (s.cat.animationState === 'sleep' || s.cat.animationState === 'lay') {
          sleepCount++;
          if (Math.random() < 1 / sleepCount) {
            cuddleBuddy = s;
          }
        }
      }

      if (cuddleBuddy && Math.random() < 0.70) {
        const angle = Math.random() * Math.PI * 2;
        const offsetDist = Phaser.Math.Between(20, 28);
        const cuddleX = Phaser.Math.Clamp(cuddleBuddy.x + Math.cos(angle) * offsetDist, this.bounds.left + 24, this.bounds.right - 24);
        const cuddleY = Phaser.Math.Clamp(cuddleBuddy.y + Math.sin(angle) * offsetDist, this.bounds.top + 24, this.bounds.bottom - 24);

        this.wanderTarget = new Phaser.Math.Vector2(cuddleX, cuddleY);
        this.cat.animationState = 'walk';
        this.wanderTimer = 6.0;
        this.playCurrentAnimation();

        this.scene.time.delayedCall(4500, () => {
          if (this.active && cuddleBuddy && Math.hypot(cuddleBuddy.x - this.x, cuddleBuddy.y - this.y) < 36) {
            this.cat.animationState = 'sleep';
            this.wanderTimer = 22.0 + Math.random() * 18.0;
            this.cat.energy = Math.min(100, this.cat.energy + 15);
            cuddleBuddy.cat.energy = Math.min(100, cuddleBuddy.cat.energy + 10);
            this.showEmote('💕');
            cuddleBuddy.showEmote('💤');
            this.playCurrentAnimation();
          }
        });
        return;
      }
    }

    // ── Kitten & Teen Follow-the-Leader Parade AI ─────────────────────────
    const canFollow = this.cat.stage === 'kitten' || this.cat.stage === 'teen';
    const followChance = this.cat.stage === 'kitten' ? 0.80 : 0.45;

    if (canFollow && this.otherSpritesProvider && Math.random() < followChance) {
      const others = this.otherSpritesProvider();
      let chosenLeader: CatSprite | null = null;
      let preferredCount = 0;
      let fallbackCount = 0;

      for (let i = 0; i < others.length; i++) {
        const s = others[i];
        if (s === this || !s.active || s.cat.animationState === 'sleep' || s.isCurrentlyDragged() || !this.bounds.contains(s.x, s.y) || s.isFollowChainAncestor(this)) continue;

        if (s.cat.stage === 'adult' || s.isFollowingLeader()) {
          preferredCount++;
          if (Math.random() < 1 / preferredCount) {
            chosenLeader = s;
          }
        } else if (preferredCount === 0) {
          fallbackCount++;
          if (Math.random() < 1 / fallbackCount) {
            chosenLeader = s;
          }
        }
      }

      if (chosenLeader) {
        this.followingAdultSprite = chosenLeader;
        this.followLeaderTimer = 30.0 + Math.random() * 25.0;
        this.followOffsetX = Phaser.Math.Between(-28, 28);
        this.followOffsetY = Phaser.Math.Between(-24, 24);
        if (Math.abs(this.followOffsetX) < 12 && Math.abs(this.followOffsetY) < 12) {
          this.followOffsetX = 20;
        }
        this.isFollowingWalking = false;
        this.wanderTarget = null;
        this.showEmote('🐾');
        return;
      }
    }

    // ── Placed Furniture Attraction AI ─────────────────────────────────────
    if (this.availableFurniture.length > 0 && Math.random() < 0.40) {
      const nearbyFurn = this.availableFurniture.filter((f) => this.bounds.contains(f.x, f.y));
      if (nearbyFurn.length > 0) {
        const chosen = Phaser.Math.RND.pick(nearbyFurn);
        this.targetFurnitureId = chosen.id;
        this.wanderTarget = new Phaser.Math.Vector2(chosen.x, chosen.y);
        this.cat.animationState = 'walk';
        this.wanderTimer = 9.0;
        this.playCurrentAnimation();
        return;
      }
    }

    if (Math.random() < (isKitten ? 0.22 : 0.38)) {
      if (crowd.count < 2) {
        this.wanderTarget = null;
        const r = Math.random();
        const isSitting = r < 0.40;
        const isKneading = !isSitting && r < 0.60 && this.cat.happiness > 60;
        this.cat.animationState = isSitting ? 'sit' : isKneading ? 'knead' : r < 0.80 ? 'look' : (this.cat.majorTrait === 'lazy' || this.cat.minorTrait === 'lazy' ? 'lay' : 'sit');
        this.wanderTimer = isSitting ? (8.0 + Math.random() * 12.0) : isKneading ? 4.5 : (2.0 + Math.random() * 3.0);
        if (isKneading) this.showEmote('🍞');
        this.playCurrentAnimation();
        return;
      }
    }

    const candidate = this.findLeastCrowdedPosition();
    const distToCand = Math.hypot(candidate.x - this.x, candidate.y - this.y);
    if (distToCand < 16) {
      this.wanderTarget = null;
      this.cat.animationState = 'sit';
      this.wanderTimer = 10.0 + Math.random() * 10.0;
      this.playCurrentAnimation();
      return;
    }

    this.wanderTarget = candidate;
    this.cat.animationState = (isKitten && Math.random() < 0.45) || (!isKitten && Math.random() < 0.12) ? 'run' : 'walk';
    this.wanderTimer = 6.5;
    this.playCurrentAnimation();
  }

  private spawnMutationParticles(): void {
    const mut = this.cat.mutation;
    const isSleeping = this.cat.animationState === 'sleep';

    if (mut === 'sparkly') {
      this.mutationEmitterTimer = 0.35 + Math.random() * 0.20;
      this.spawnSparkleParticle();
      if (Math.random() < 0.4) this.spawnSparkleStar();
    } else if (mut === 'flaming') {
      this.mutationEmitterTimer = 0.32 + Math.random() * 0.18;
      this.spawnEmberParticle();
      if (Math.random() < 0.5) this.spawnFlameTongue();
    } else if (mut === 'frosted') {
      this.mutationEmitterTimer = 0.40 + Math.random() * 0.22;
      this.spawnFrostParticle();
      if (Math.random() < 0.4) this.spawnSnowflakeParticle();
    } else if (mut === 'gilded') {
      this.mutationEmitterTimer = 0.38 + Math.random() * 0.20;
      this.spawnGildedParticle();
    } else if (mut === 'angelic') {
      this.mutationEmitterTimer = 0.45 + Math.random() * 0.25;
      this.spawnAngelicParticle();
    } else if (mut === 'chromatic') {
      this.mutationEmitterTimer = 0.38 + Math.random() * 0.20;
      this.spawnChromaticParticle();
    } else if (mut === 'stinky' && !isSleeping) {
      this.mutationEmitterTimer = 1.2 + Math.random() * 0.8;
      this.spawnStinkyPuff();
    } else if (mut === 'inverted') {
      this.mutationEmitterTimer = 0.42 + Math.random() * 0.22;
      this.spawnInvertedParticle();
    } else if (mut === 'giant') {
      this.mutationEmitterTimer = 0.60 + Math.random() * 0.35;
      this.spawnGiantTremorParticle();
    } else if (mut === 'tiny') {
      this.mutationEmitterTimer = 0.42 + Math.random() * 0.22;
      this.spawnTinyFairyParticle();
    } else if (this.cat.isRare || this.cat.rareType || this.cat.color === 'ghost_0' || this.cat.color === 'radioactive_0' || this.cat.color === 'gold_0') {
      this.mutationEmitterTimer = 0.55 + Math.random() * 0.25;
      this.spawnRareAuraParticle();
    } else {
      this.mutationEmitterTimer = 1.5;
    }
  }

  private spawnStinkyPuff(): void {
    const puff = CatSprite.getPooledGraphics(this.scene);
    if (!puff) return;
    puff.setDepth(this.y + 4);
    const px = this.x + Phaser.Math.Between(-10, 10);
    const py = this.y + 6;
    puff.fillStyle(0x4ade80, 0.75);
    puff.fillCircle(0, 0, Phaser.Math.Between(5, 7.5));
    puff.fillStyle(0x22c55e, 0.85);
    puff.fillCircle(-3, -2, 4);
    puff.fillCircle(3.5, 1.5, 3.5);
    puff.fillStyle(0x15803d, 0.9);
    puff.fillCircle(1, -2, 2.5);
    puff.setPosition(px, py);

    this.scene.tweens.add({
      targets: puff,
      y: py - Phaser.Math.Between(28, 42),
      x: px + (Math.random() - 0.5) * 16,
      scaleX: 1.9,
      scaleY: 1.9,
      alpha: 0,
      duration: 1200,
      ease: 'Sine.easeOut',
      onComplete: () => CatSprite.recycleGraphics(puff),
    });
  }

  private spawnSparkleParticle(): void {
    const glint = CatSprite.getPooledGraphics(this.scene);
    if (!glint) return;
    glint.setDepth(this.y + 3);
    const px = this.x + Phaser.Math.Between(-18, 18);
    const py = this.y + Phaser.Math.Between(-18, 14);
    const colors = [0xf472b6, 0xc084fc, 0xfde047, 0x38bdf8, 0xffffff];
    const color = Phaser.Math.RND.pick(colors);
    const r = Phaser.Math.FloatBetween(2.0, 4.2);

    glint.fillStyle(color, 0.95);
    glint.fillCircle(0, 0, r);
    glint.setPosition(px, py);

    this.scene.tweens.add({
      targets: glint,
      y: py - Phaser.Math.Between(12, 24),
      x: px + (Math.random() - 0.5) * 10,
      scaleX: 1.5,
      scaleY: 1.5,
      alpha: 0,
      duration: 650,
      ease: 'Quad.easeOut',
      onComplete: () => CatSprite.recycleGraphics(glint),
    });
  }

  private spawnSparkleStar(): void {
    const star = CatSprite.getPooledGraphics(this.scene);
    if (!star) return;
    star.setDepth(this.y + 4);
    const px = this.x + Phaser.Math.Between(-16, 16);
    const py = this.y + Phaser.Math.Between(-16, 10);
    const color = Phaser.Math.RND.pick([0xffffff, 0xfde047, 0xf472b6, 0xa855f7]);
    const size = Phaser.Math.Between(4, 7);

    star.fillStyle(color, 0.95);
    star.beginPath();
    star.moveTo(0, -size);
    star.lineTo(size * 0.3, -size * 0.3);
    star.lineTo(size, 0);
    star.lineTo(size * 0.3, size * 0.3);
    star.lineTo(0, size);
    star.lineTo(-size * 0.3, size * 0.3);
    star.lineTo(-size, 0);
    star.lineTo(-size * 0.3, -size * 0.3);
    star.closePath();
    star.fillPath();
    star.setPosition(px, py);

    this.scene.tweens.add({
      targets: star,
      y: py - Phaser.Math.Between(16, 30),
      angle: 90,
      scaleX: 1.3,
      scaleY: 1.3,
      alpha: 0,
      duration: 750,
      ease: 'Sine.easeOut',
      onComplete: () => CatSprite.recycleGraphics(star),
    });
  }

  private spawnEmberParticle(): void {
    const ember = CatSprite.getPooledGraphics(this.scene);
    if (!ember) return;
    ember.setDepth(this.y + 3);
    const px = this.x + Phaser.Math.Between(-14, 14);
    const py = this.y + Phaser.Math.Between(0, 14);
    ember.fillStyle(Phaser.Math.RND.pick([0xff4500, 0xf97316, 0xfbbf24, 0xffedd5]), 0.9);
    ember.fillCircle(0, 0, Phaser.Math.FloatBetween(2.0, 3.8));
    ember.setPosition(px, py);

    this.scene.tweens.add({
      targets: ember,
      y: py - Phaser.Math.Between(18, 36),
      x: px + (Math.random() - 0.5) * 14,
      scaleX: 0.3,
      scaleY: 0.3,
      alpha: 0,
      duration: 550,
      ease: 'Cubic.easeOut',
      onComplete: () => CatSprite.recycleGraphics(ember),
    });
  }

  private spawnFlameTongue(): void {
    const flame = CatSprite.getPooledGraphics(this.scene);
    if (!flame) return;
    flame.setDepth(this.y + 3);
    const px = this.x + Phaser.Math.Between(-12, 12);
    const py = this.y + Phaser.Math.Between(-4, 12);
    const color = Phaser.Math.RND.pick([0xff5722, 0xff9800, 0xffeb3b]);
    flame.fillStyle(color, 0.85);
    flame.fillEllipse(0, 0, 4, 8);
    flame.setPosition(px, py);

    this.scene.tweens.add({
      targets: flame,
      y: py - 24,
      scaleX: 0.2,
      scaleY: 1.8,
      alpha: 0,
      duration: 480,
      ease: 'Quad.easeOut',
      onComplete: () => CatSprite.recycleGraphics(flame),
    });
  }

  private spawnFrostParticle(): void {
    const frost = CatSprite.getPooledGraphics(this.scene);
    if (!frost) return;
    frost.setDepth(this.y + 3);
    const px = this.x + Phaser.Math.Between(-18, 18);
    const py = this.y - Phaser.Math.Between(10, 24);
    frost.fillStyle(Phaser.Math.RND.pick([0xe0f2fe, 0x7dd3fc, 0x38bdf8, 0xffffff]), 0.9);
    frost.fillCircle(0, 0, Phaser.Math.FloatBetween(2.0, 3.6));
    frost.setPosition(px, py);

    this.scene.tweens.add({
      targets: frost,
      y: py + Phaser.Math.Between(20, 34),
      x: px + (Math.random() - 0.5) * 16,
      scaleX: 0.4,
      scaleY: 0.4,
      alpha: 0,
      duration: 850,
      ease: 'Sine.easeIn',
      onComplete: () => CatSprite.recycleGraphics(frost),
    });
  }

  private spawnSnowflakeParticle(): void {
    const snow = CatSprite.getPooledGraphics(this.scene);
    if (!snow) return;
    snow.setDepth(this.y + 3);
    const px = this.x + Phaser.Math.Between(-16, 16);
    const py = this.y - Phaser.Math.Between(12, 22);
    snow.lineStyle(1.5, 0xffffff, 0.9);
    const r = 3.5;
    snow.lineBetween(0, -r, 0, r);
    snow.lineBetween(-r * 0.866, -r * 0.5, r * 0.866, r * 0.5);
    snow.lineBetween(-r * 0.866, r * 0.5, r * 0.866, -r * 0.5);
    snow.setPosition(px, py);

    this.scene.tweens.add({
      targets: snow,
      y: py + Phaser.Math.Between(22, 38),
      angle: 180,
      alpha: 0,
      duration: 1100,
      ease: 'Sine.easeInOut',
      onComplete: () => CatSprite.recycleGraphics(snow),
    });
  }

  private spawnGildedParticle(): void {
    const gold = CatSprite.getPooledGraphics(this.scene);
    if (!gold) return;
    gold.setDepth(this.y + 3);
    const px = this.x + Phaser.Math.Between(-16, 16);
    const py = this.y + Phaser.Math.Between(-16, 12);
    const color = Phaser.Math.RND.pick([0xfde047, 0xfacc15, 0xeab308, 0xffffff]);

    if (Math.random() < 0.5) {
      gold.fillStyle(color, 0.95);
      gold.fillCircle(0, 0, Phaser.Math.FloatBetween(2.2, 4.0));
      gold.lineStyle(1, 0xca8a04, 0.8);
      gold.strokeCircle(0, 0, Phaser.Math.FloatBetween(2.2, 4.0));
    } else {
      const s = 4.5;
      gold.fillStyle(color, 0.95);
      gold.beginPath();
      gold.moveTo(0, -s);
      gold.lineTo(s * 0.25, -s * 0.25);
      gold.lineTo(s, 0);
      gold.lineTo(s * 0.25, s * 0.25);
      gold.lineTo(0, s);
      gold.lineTo(-s * 0.25, s * 0.25);
      gold.lineTo(-s, 0);
      gold.lineTo(-s * 0.25, -s * 0.25);
      gold.closePath();
      gold.fillPath();
    }
    gold.setPosition(px, py);

    this.scene.tweens.add({
      targets: gold,
      y: py - Phaser.Math.Between(14, 26),
      scaleX: 1.4,
      scaleY: 1.4,
      angle: 45,
      alpha: 0,
      duration: 650,
      ease: 'Quad.easeOut',
      onComplete: () => CatSprite.recycleGraphics(gold),
    });
  }

  private spawnAngelicParticle(): void {
    const angel = CatSprite.getPooledGraphics(this.scene);
    if (!angel) return;
    angel.setDepth(this.y + 4);
    const px = this.x + Phaser.Math.Between(-14, 14);
    const py = this.y - Phaser.Math.Between(8, 26);
    const color = Phaser.Math.RND.pick([0xfef08a, 0xfde047, 0xffffff, 0xfef9c3]);

    angel.fillStyle(color, 0.9);
    angel.fillCircle(0, 0, Phaser.Math.FloatBetween(2.5, 4.5));
    angel.setPosition(px, py);

    this.scene.tweens.add({
      targets: angel,
      y: py - Phaser.Math.Between(20, 36),
      x: px + (Math.random() - 0.5) * 12,
      scaleX: 1.3,
      scaleY: 1.3,
      alpha: 0,
      duration: 900,
      ease: 'Sine.easeOut',
      onComplete: () => CatSprite.recycleGraphics(angel),
    });
  }

  private spawnChromaticParticle(): void {
    const spark = CatSprite.getPooledGraphics(this.scene);
    if (!spark) return;
    spark.setDepth(this.y + 3);
    const px = this.x + Phaser.Math.Between(-16, 16);
    const py = this.y + Phaser.Math.Between(-16, 12);
    const rainbowColors = [0xef4444, 0xf97316, 0xeab308, 0x22c55e, 0x06b6d4, 0x8b5cf6, 0xec4899];
    const color = Phaser.Math.RND.pick(rainbowColors);

    spark.fillStyle(color, 0.95);
    spark.fillCircle(0, 0, Phaser.Math.FloatBetween(2.4, 4.2));
    spark.setPosition(px, py);

    this.scene.tweens.add({
      targets: spark,
      y: py - Phaser.Math.Between(14, 28),
      x: px + (Math.random() - 0.5) * 14,
      scaleX: 1.4,
      scaleY: 1.4,
      alpha: 0,
      duration: 700,
      ease: 'Sine.easeOut',
      onComplete: () => CatSprite.recycleGraphics(spark),
    });
  }

  private spawnInvertedParticle(): void {
    const mote = CatSprite.getPooledGraphics(this.scene);
    if (!mote) return;
    mote.setDepth(this.y + 3);
    const px = this.x + Phaser.Math.Between(-16, 16);
    const py = this.y + Phaser.Math.Between(-16, 12);
    const color = Phaser.Math.RND.pick([0x06b6d4, 0x818cf8, 0xec4899, 0xffffff]);

    mote.fillStyle(color, 0.9);
    mote.fillCircle(0, 0, Phaser.Math.FloatBetween(2.0, 3.8));
    mote.setPosition(px, py);

    this.scene.tweens.add({
      targets: mote,
      y: py + Phaser.Math.Between(-18, 18),
      x: px + (Math.random() - 0.5) * 20,
      scaleX: 0.2,
      scaleY: 0.2,
      alpha: 0,
      duration: 550,
      ease: 'Quad.easeInOut',
      onComplete: () => CatSprite.recycleGraphics(mote),
    });
  }

  private spawnGiantTremorParticle(): void {
    if (this.cat.animationState !== 'walk' && this.cat.animationState !== 'run') return;
    const dust = CatSprite.getPooledGraphics(this.scene);
    if (!dust) return;
    dust.setDepth(this.y - 1);
    const px = this.x + (Math.random() - 0.5) * 16;
    const py = this.y + 14;

    dust.fillStyle(Phaser.Math.RND.pick([0xfcd34d, 0xd1d5db, 0xa8a29e]), 0.65);
    dust.fillEllipse(0, 0, Phaser.Math.Between(7, 12), Phaser.Math.Between(4, 7));
    dust.setPosition(px, py);

    this.scene.tweens.add({
      targets: dust,
      scaleX: 1.6,
      scaleY: 1.6,
      alpha: 0,
      duration: 480,
      ease: 'Quad.easeOut',
      onComplete: () => CatSprite.recycleGraphics(dust),
    });
  }

  private spawnBiscuitHeart(): void {
    const heart = CatSprite.getPooledGraphics(this.scene);
    if (!heart) return;
    heart.setDepth(this.y + 4);
    const px = this.x + Phaser.Math.Between(-8, 8);
    const py = this.y + 2;

    heart.fillStyle(0xff758f, 0.9);
    heart.fillCircle(-2, -2, 2.5);
    heart.fillCircle(2, -2, 2.5);
    heart.beginPath();
    heart.moveTo(-4, -1);
    heart.lineTo(4, -1);
    heart.lineTo(0, 4);
    heart.closePath();
    heart.fillPath();
    heart.setPosition(px, py);

    this.scene.tweens.add({
      targets: heart,
      y: py - Phaser.Math.Between(16, 26),
      x: px + (Math.random() - 0.5) * 8,
      scaleX: 1.3,
      scaleY: 1.3,
      alpha: 0,
      duration: 800,
      ease: 'Sine.easeOut',
      onComplete: () => CatSprite.recycleGraphics(heart),
    });
  }

  private spawnTinyFairyParticle(): void {
    const fairy = CatSprite.getPooledGraphics(this.scene);
    if (!fairy) return;
    fairy.setDepth(this.y + 3);
    const px = this.x + Phaser.Math.Between(-12, 12);
    const py = this.y + Phaser.Math.Between(-12, 8);
    const color = Phaser.Math.RND.pick([0x6ee7b7, 0xa7f3d0, 0xfbcfe8, 0xffffff]);

    fairy.fillStyle(color, 0.9);
    fairy.fillCircle(0, 0, Phaser.Math.FloatBetween(1.2, 2.4));
    fairy.setPosition(px, py);

    this.scene.tweens.add({
      targets: fairy,
      y: py - Phaser.Math.Between(10, 20),
      x: px + (Math.random() - 0.5) * 12,
      scaleX: 1.5,
      scaleY: 1.5,
      alpha: 0,
      duration: 500,
      ease: 'Quad.easeOut',
      onComplete: () => CatSprite.recycleGraphics(fairy),
    });
  }

  private spawnRareAuraParticle(): void {
    const p = CatSprite.getPooledGraphics(this.scene);
    if (!p) return;
    p.setDepth(this.y + 3);
    const px = this.x + Phaser.Math.Between(-16, 16);
    const py = this.y + Phaser.Math.Between(-16, 12);

    let color = 0xfde047;
    if (this.cat.color === 'ghost_0' || this.cat.rareType === 'ghost') {
      color = Phaser.Math.RND.pick([0xcfe2f3, 0xe2e8f0, 0xffffff]);
    } else if (this.cat.color === 'radioactive_0' || this.cat.rareType === 'radioactive') {
      color = Phaser.Math.RND.pick([0x4ade80, 0x22c55e, 0x86efac]);
    } else if (this.cat.color === 'gold_0') {
      color = Phaser.Math.RND.pick([0xfde047, 0xfacc15, 0xffffff]);
    } else {
      color = Phaser.Math.RND.pick([0xfbcfe8, 0xbae6fd, 0xfde047, 0xffffff]);
    }

    p.fillStyle(color, 0.9);
    p.fillCircle(0, 0, Phaser.Math.FloatBetween(2.0, 3.8));
    p.setPosition(px, py);

    this.scene.tweens.add({
      targets: p,
      y: py - Phaser.Math.Between(14, 28),
      x: px + (Math.random() - 0.5) * 10,
      scaleX: 1.3,
      scaleY: 1.3,
      alpha: 0,
      duration: 700,
      ease: 'Sine.easeOut',
      onComplete: () => CatSprite.recycleGraphics(p),
    });
  }

  setAreaBounds(bounds: Phaser.Geom.Rectangle): void { this.bounds = bounds; }

  override setDepth(value: number): this {
    if (Math.abs(this.depth - value) >= 0.5) {
      super.setDepth(value);
    }
    return this;
  }

  setNameLabelVisible(visible: boolean): void {
    this.nameLabel.setVisible(visible);
  }

  refreshVisuals(): void {
    const scale = getScaleForCat(this.cat);
    this.baseSprite.setScale(scale);
    if (this.markingSprite) this.markingSprite.setScale(scale);
    this.shadow.setScale(0.55 * (scale / BASE_SPRITE_SCALE), 0.50 * (scale / BASE_SPRITE_SCALE));
    this.shadow.y = 18 * (scale / BASE_SPRITE_SCALE);

    const prefix = this.cat.isRare ? '✨ ' : '';
    const stageSuffix = this.cat.stage === 'kitten' ? ' (Kitten)' : this.cat.stage === 'teen' ? ' (Teen)' : '';
    this.nameLabel.setText(`${prefix}${this.cat.name}${stageSuffix}`);
    this.nameLabel.setVisible(CatSprite.showNameLabels);

    if (this.cat.mutation === 'gilded') {
      this.baseSprite.setTint(0xffd700);
      if (this.markingSprite) this.markingSprite.setTint(0xffd700);
    } else if (this.cat.mutation === 'frosted') {
      this.baseSprite.setTint(0xa5f3fc);
      if (this.markingSprite) this.markingSprite.setTint(0xa5f3fc);
    } else if (this.cat.mutation === 'flaming') {
      this.baseSprite.setTint(0xff8a4c);
      if (this.markingSprite) this.markingSprite.setTint(0xff8a4c);
    } else if (this.cat.mutation === 'stinky') {
      this.baseSprite.setTint(0xdcfce7);
      if (this.markingSprite) this.markingSprite.setTint(0xdcfce7);
    } else if (this.cat.mutation === 'inverted') {
      this.baseSprite.setTint(0x818cf8);
      if (this.markingSprite) this.markingSprite.setTint(0x38bdf8);
    } else if (this.cat.mutation !== 'chromatic') {
      this.baseSprite.clearTint();
      if (this.markingSprite) this.markingSprite.clearTint();
    }

    if (this.cat.mutation === 'angelic') {
      if (!this.haloGfx) {
        this.haloGfx = this.scene.add.graphics();
        this.add(this.haloGfx);
      }
      this.haloGfx.clear();
      this.haloGfx.lineStyle(2.5, 0xfde047, 0.95);
      this.haloGfx.strokeEllipse(0, -30 * (scale / BASE_SPRITE_SCALE), 14, 5);
    }

    this.updateDirtGfx();
    this.updateNeedIndicator();
    this.playCurrentAnimation();
  }

  destroy(fromScene?: boolean): void {
    if (this.activePounceCounterTween) {
      this.activePounceCounterTween.stop();
      this.activePounceCounterTween.remove();
      this.activePounceCounterTween = null;
    }
    if (this.activePounceMoveTween) {
      this.activePounceMoveTween.stop();
      this.activePounceMoveTween.remove();
      this.activePounceMoveTween = null;
    }
    if (this.activePouncePrepTween) {
      this.activePouncePrepTween.stop();
      this.activePouncePrepTween.remove();
      this.activePouncePrepTween = null;
    }
    if (this.activePounceLandTween) {
      this.activePounceLandTween.stop();
      this.activePounceLandTween.remove();
      this.activePounceLandTween = null;
    }
    if (this.needPulseTween) {
      this.needPulseTween.stop();
      this.needPulseTween.remove();
      this.needPulseTween = null;
    }
    if (this.scene && this.scene.tweens) {
      this.scene.tweens.killTweensOf(this);
      if (this.baseSprite) this.scene.tweens.killTweensOf(this.baseSprite);
      if (this.markingSprite) this.scene.tweens.killTweensOf(this.markingSprite);
      if (this.haloGfx) this.scene.tweens.killTweensOf(this.haloGfx);
      if (this.needIndicatorContainer) this.scene.tweens.killTweensOf(this.needIndicatorContainer);
      if (this.hoverGfx) this.scene.tweens.killTweensOf(this.hoverGfx);
      if (this.shadow) this.scene.tweens.killTweensOf(this.shadow);
    }
    this.isPouncing = false;
    this.chasingCatSprite = null;
    this.fleeingFromCatSprite = null;
    this.wanderTarget = null;
    this.chaseTarget = null;
    this.targetMachineId = null;
    this.otherSpritesProvider = null;
    this.machineUseCallback = null;
    super.destroy(fromScene);
  }
}

