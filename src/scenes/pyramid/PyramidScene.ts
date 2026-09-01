// ---------------------------------------------------------------------------
// Purrfect Pyramid — Physics Cat Stacking Mini-Game
// Full physics simulation, atmospheric layer parallax, trait mechanics,
// wobble physics, and high-altitude rewards.
// ---------------------------------------------------------------------------

import '../../ui/pyramid.css';
import type { Cat, CatMutationType, LifeStage } from '../../data/types';
import { CAT_SKINS, CAT_MARKINGS } from '../../data/catAssets';
import { sound } from '../../systems/SoundManager';
import { EventBus } from '../../ui/EventBus';

interface PhysicsCat {
  cat: Cat;
  // World coordinates
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;           // In radians
  angularVel: number;

  // Rigid Body Local coordinates (relative to platform center fulcrum)
  localX: number;
  localY: number;
  localAngle: number;

  spriteSize: number;      // Uniform square render size
  colliderWidth: number;   // Precise physical body width
  colliderHeight: number;  // Precise physical body height
  mass: number;
  isDropping: boolean;
  isSettled: boolean;
  isFallen: boolean;
  squishTimer: number;     // Landing bounce effect
  baseImg: HTMLImageElement | null;
  markingImg: HTMLImageElement | null;
  mutation: CatMutationType | null | undefined;
  stage: LifeStage;
  emote?: string;
  emoteTimer?: number;
}




interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

const MILESTONES = [
  { height: 10, label: '🏡 Garden Fence Reached!', love: 80, stars: 2 },
  { height: 25, label: '🏠 Rooftops Reached!', love: 200, stars: 5 },
  { height: 50, label: '☁️ Cloud Layer Reached!', love: 450, stars: 15 },
  { height: 100, label: '🌌 Aurora Stratosphere!', love: 1000, stars: 35 },
  { height: 200, label: '✨ Cat Constellations!', love: 2500, stars: 80 },
  { height: 300, label: '🌕 THE MOON REACHED! 👑', love: 6000, stars: 200 },
];

export class PyramidScene {
  private root: HTMLElement;
  private overlay!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private nextCanvas!: HTMLCanvasElement;
  private nextCtx!: CanvasRenderingContext2D;

  private cats: Cat[];

  // Image Cache
  private static imageCache = new Map<string, HTMLImageElement>();

  // Rigid Body Tower World
  private platformX = 0;
  private platformY = 0;
  private platformWidth = 340;
  private platformHeight = 36;

  private towerAngle = 0;          // Unified rigid body tilt angle (radians)
  private towerAngularVel = 0;     // Angular velocity of the whole tower
  private towerToppled = false;    // Whether the tower has lost balance and toppled

  private stackedCats: PhysicsCat[] = [];
  private activeFallingCat: PhysicsCat | null = null;
  private catQueue: Cat[] = [];
  private queueIndex = 0;


  // Cloud Dropper
  private dropperX = 0;
  private dropperY = 110;
  private dropperDir = 1;
  private isDropperManual = false;

  // Camera & Atmosphere
  private cameraY = 0;
  private targetCameraY = 0;
  private currentAltitude = 0;

  // Game Lifecycle
  private scoreCats = 0;
  private isGameOver = false;
  private loopAnimId: number | null = null;
  private lastTime = 0;
  private particles: Particle[] = [];
  private claimedMilestones = new Set<number>();
  private accumulatedLove = 0;
  private accumulatedStars = 0;

  constructor(root: HTMLElement, cats: Cat[], _love: number, _bestHeight = 0) {
    this.root = root;
    this.cats = cats.length > 0 ? [...cats] : [];
    this.catQueue = this.shuffleCats(this.cats);
  }

  mount(): void {
    sound.startConquestMusic(); // Cozy mini-game music
    this.overlay = document.createElement('div');
    this.overlay.id = 'pyramid-overlay';
    this.root.appendChild(this.overlay);

    this.renderShell();
    this.initCanvas();
    this.setupInputs();

    requestAnimationFrame(() => {
      this.overlay.classList.add('open');
      this.resizeCanvas();
      this.resetGame();
      this.startLoop();
    });
  }

  unmount(): void {
    this.stopLoop();
    sound.stopConquestMusic();
    this.overlay.classList.remove('open');
    setTimeout(() => this.overlay.remove(), 350);
  }

  private shuffleCats(array: Cat[]): Cat[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ── Shell Layout ──────────────────────────────────────────────────────────

  private renderShell(): void {
    this.overlay.innerHTML = `
      <div class="pyr-header">
        <button class="pyr-back-btn" id="pyr-exit-btn">
          ← Back
        </button>
        <div class="pyr-title-badge">
          <span>🏗️🐾</span> Purrfect Pyramid
        </div>
        <div class="pyr-stats-row">
          <div class="pyr-stat-pill" title="Cats Stacked">
            🐱 <span id="pyr-count-val">0</span> Cats
          </div>
          <div class="pyr-stat-pill" style="color:#e11d48;" title="Care Points Earned">
            💗 <span id="pyr-love-val">0</span>
          </div>
        </div>
      </div>

      <div class="pyr-game-area" id="pyr-game-area">
        <canvas class="pyr-canvas" id="pyr-canvas"></canvas>

        <div class="pyr-height-meter">
          <div class="pyr-height-val" id="pyr-alt-val">0.0 m</div>
          <div class="pyr-height-sub">Tower Altitude</div>
        </div>

        <div class="pyr-next-cat-preview">
          <div class="pyr-next-label">Next Cat</div>
          <canvas class="pyr-next-canvas" id="pyr-next-canvas" width="56" height="56"></canvas>
          <div class="pyr-next-name" id="pyr-next-name">-</div>
        </div>

        <div class="pyr-milestone-banner" id="pyr-milestone-banner"></div>
        <div class="pyr-drop-hint" id="pyr-drop-hint">Tap Anywhere to Drop Cat!</div>

        <div class="pyr-results-card" id="pyr-results-card">
          <h2 class="pyr-results-title">Tower Tumbled!</h2>
          <div class="pyr-results-sub" id="pyr-results-sub">Awesome balance run!</div>


          <div class="pyr-results-grid">
            <div class="pyr-res-stat">
              <span class="pyr-res-stat-val" id="pyr-res-height">0.0 m</span>
              <span class="pyr-res-stat-lbl">Peak Height</span>
            </div>
            <div class="pyr-res-stat">
              <span class="pyr-res-stat-val" id="pyr-res-cats">0</span>
              <span class="pyr-res-stat-lbl">Cats Stacked</span>
            </div>
          </div>

          <div class="pyr-rewards-box" id="pyr-rewards-box">
            <span>+0 💗</span>
            <span>•</span>
            <span>+0 ⭐</span>
          </div>

          <div class="pyr-actions-row">
            <button class="pyr-btn-primary" id="pyr-retry-btn">Stack Again</button>
            <button class="pyr-btn-secondary" id="pyr-done-btn">Sanctuary</button>
          </div>
        </div>
      </div>
    `;

    this.overlay.querySelector('#pyr-exit-btn')?.addEventListener('click', () => {
      sound.playTap();
      this.claimAndExit();
    });

    this.overlay.querySelector('#pyr-retry-btn')?.addEventListener('click', () => {
      sound.playTap();
      this.resetGame();
    });

    this.overlay.querySelector('#pyr-done-btn')?.addEventListener('click', () => {
      sound.playTap();
      this.claimAndExit();
    });
  }

  private initCanvas(): void {
    this.canvas = this.overlay.querySelector('#pyr-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;

    this.nextCanvas = this.overlay.querySelector('#pyr-next-canvas') as HTMLCanvasElement;
    this.nextCtx = this.nextCanvas.getContext('2d')!;

    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    if (this.canvas) this.resizeCanvas();
  };

  private resizeCanvas(): void {
    const area = this.overlay.querySelector('#pyr-game-area') as HTMLElement;
    if (!area || !this.canvas) return;
    this.canvas.width = area.clientWidth || window.innerWidth;
    this.canvas.height = area.clientHeight || (window.innerHeight - 56);
    this.platformX = this.canvas.width / 2;
    this.platformY = this.canvas.height - 70;
  }

  // ── Input Handling ────────────────────────────────────────────────────────

  private setupInputs(): void {
    const area = this.overlay.querySelector('#pyr-game-area') as HTMLElement;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if (this.isGameOver) return;
      const rect = this.canvas.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const x = clientX - rect.left;
      this.dropperX = Phaser.Math.Clamp(x, 60, this.canvas.width - 60);
      this.isDropperManual = true;
    };

    const handleDrop = (e: Event) => {
      e.preventDefault();
      if (this.isGameOver) return;
      this.dropCurrentCat();
    };

    area.addEventListener('mousemove', handlePointerMove);
    area.addEventListener('touchmove', handlePointerMove, { passive: true });
    area.addEventListener('mousedown', handleDrop);
    area.addEventListener('touchstart', handleDrop, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowDown') {
        if (!this.isGameOver) this.dropCurrentCat();
      }
    });
  }


  private resetGame(): void {
    this.stackedCats = [];
    this.activeFallingCat = null;
    this.particles = [];
    this.scoreCats = 0;
    this.currentAltitude = 0;
    this.cameraY = 0;
    this.targetCameraY = 0;
    this.towerAngle = 0;
    this.towerAngularVel = 0;
    this.towerToppled = false;
    this.isGameOver = false;
    this.queueIndex = 0;
    this.claimedMilestones.clear();
    this.accumulatedLove = 0;
    this.accumulatedStars = 0;

    const resultsCard = this.overlay.querySelector('#pyr-results-card');
    resultsCard?.classList.remove('open');

    this.updateHud();
    this.prepareNextCat();
  }

  private prepareNextCat(): void {
    if (this.catQueue.length === 0) return;
    const cat = this.catQueue[this.queueIndex % this.catQueue.length];
    this.renderNextPreview(cat);
  }

  private renderNextPreview(cat: Cat): void {
    const nextName = this.overlay.querySelector('#pyr-next-name');
    if (nextName) nextName.textContent = cat.name;

    const FRAME_SIZE = 32;
    const srcX = 0;
    const srcY = 2 * FRAME_SIZE; // Row 2, Col 0: Front sitting loaf

    this.nextCtx.clearRect(0, 0, 56, 56);
    const skinDef = CAT_SKINS.find((s) => s.id === cat.color) || CAT_SKINS[0];
    const skinSrc = skinDef?.file ? `./assets/cats/${skinDef.file}` : './assets/cats/orange_0.png';
    const markingDef = cat.pattern ? CAT_MARKINGS.find((m) => m.id === cat.pattern) : null;
    const markingSrc = markingDef?.file ? `./assets/cats/Markings/${markingDef.file}` : null;

    PyramidScene.loadImage(skinSrc).then((baseImg) => {
      this.nextCtx.clearRect(0, 0, 56, 56);
      this.nextCtx.save();
      this.nextCtx.imageSmoothingEnabled = false;

      // Mutation color filters
      if (cat.mutation === 'inverted') {
        this.nextCtx.filter = 'invert(0.92) hue-rotate(180deg) saturate(1.8)';
      } else if (cat.mutation === 'frosted') {
        this.nextCtx.filter = 'hue-rotate(180deg) saturate(2.0) brightness(1.15)';
      } else if (cat.mutation === 'flaming') {
        this.nextCtx.filter = 'sepia(0.65) saturate(3.5) hue-rotate(-30deg) brightness(1.1)';
      } else if (cat.mutation === 'sparkly') {
        this.nextCtx.filter = 'hue-rotate(280deg) saturate(2.2) brightness(1.25)';
      } else if (cat.mutation === 'gilded') {
        this.nextCtx.filter = 'sepia(0.9) saturate(4.0) hue-rotate(10deg) brightness(1.15)';
      } else if (cat.mutation === 'stinky') {
        this.nextCtx.filter = 'sepia(0.55) hue-rotate(85deg) saturate(2.5) brightness(0.95)';
      }

      this.nextCtx.drawImage(baseImg, srcX, srcY, FRAME_SIZE, FRAME_SIZE, 0, 0, 56, 56);
      if (markingSrc) {
        PyramidScene.loadImage(markingSrc).then((markImg) => {
          this.nextCtx.drawImage(markImg, srcX, srcY, FRAME_SIZE, FRAME_SIZE, 0, 0, 56, 56);
        });
      }
      this.nextCtx.restore();
    });
  }

  private static loadImage(src: string): Promise<HTMLImageElement> {
    const cached = PyramidScene.imageCache.get(src);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        PyramidScene.imageCache.set(src, img);
        resolve(img);
      };
      img.onerror = reject;
    });
  }

  // ── Drop Cat Action ───────────────────────────────────────────────────────

  private dropCurrentCat(): void {
    if (this.activeFallingCat || this.isGameOver || this.catQueue.length === 0) return;

    const cat = this.catQueue[this.queueIndex % this.catQueue.length];
    this.queueIndex++;

    const isGiant = cat.mutation === 'giant';
    const isTiny = cat.mutation === 'tiny' || cat.stage === 'kitten';
    const isTeen = cat.stage === 'teen';

    // 2x Scaled Dimensions
    const spriteSize = isGiant ? 136 : isTiny ? 72 : isTeen ? 88 : 104;
    const colliderWidth = Math.round(spriteSize * 0.76);
    const colliderHeight = Math.round(spriteSize * 0.50);
    const mass = isGiant ? 3.5 : isTiny ? 0.75 : isTeen ? 1.0 : 1.4;

    const physCat: PhysicsCat = {
      cat,
      x: this.dropperX,
      y: this.dropperY - this.cameraY,
      vx: (Math.random() - 0.5) * 15,
      vy: 20,
      angle: (Math.random() - 0.5) * 0.08,
      angularVel: (Math.random() - 0.5) * 0.05,
      localX: 0,
      localY: 0,
      localAngle: 0,
      spriteSize,
      colliderWidth,
      colliderHeight,
      mass,
      isDropping: true,
      isSettled: false,
      isFallen: false,
      squishTimer: 0,
      baseImg: null,
      markingImg: null,
      mutation: cat.mutation,
      stage: cat.stage,
    };

    const skinDef = CAT_SKINS.find((s) => s.id === cat.color) || CAT_SKINS[0];
    const skinSrc = skinDef?.file ? `./assets/cats/${skinDef.file}` : './assets/cats/orange_0.png';
    const markingDef = cat.pattern ? CAT_MARKINGS.find((m) => m.id === cat.pattern) : null;
    const markingSrc = markingDef?.file ? `./assets/cats/Markings/${markingDef.file}` : null;

    PyramidScene.loadImage(skinSrc).then((img) => { physCat.baseImg = img; });
    if (markingSrc) {
      PyramidScene.loadImage(markingSrc).then((img) => { physCat.markingImg = img; });
    }

    sound.playPop();
    this.activeFallingCat = physCat;
    this.prepareNextCat();
  }

  // ── Main Loop & Physics Engine ────────────────────────────────────────────

  private startLoop(): void {
    this.lastTime = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - this.lastTime) / 1000, 0.06);
      this.lastTime = now;
      this.updatePhysics(dt);
      this.renderCanvas();
      this.loopAnimId = requestAnimationFrame(tick);
    };
    this.loopAnimId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.loopAnimId) {
      cancelAnimationFrame(this.loopAnimId);
      this.loopAnimId = null;
    }
  }

  private updatePhysics(dt: number): void {
    // 1. Oscillate Dropper Cloud if not dragged
    if (!this.isDropperManual) {
      this.dropperX += this.dropperDir * (this.canvas.width * 0.4) * dt;
      if (this.dropperX > this.canvas.width - 70) {
        this.dropperX = this.canvas.width - 70;
        this.dropperDir = -1;
      } else if (this.dropperX < 70) {
        this.dropperX = 70;
        this.dropperDir = 1;
      }
    }

    // 2. Active Falling Cat Physics
    if (this.activeFallingCat) {
      const cat = this.activeFallingCat;
      const isAngelic = cat.mutation === 'angelic';
      const gravity = isAngelic ? 260 : 540;

      cat.vy += gravity * dt;
      cat.x += cat.vx * dt;
      cat.y += cat.vy * dt;
      cat.angle += cat.angularVel * dt;

      // Angelic feather particles
      if (isAngelic && Math.random() < 0.3) {
        this.spawnParticle(cat.x + (Math.random() - 0.5) * 20, cat.y, '#ffffff', 4);
      }

      // Check collision with platform
      const catBottom = cat.y + cat.colliderHeight / 2;
      const catTop = cat.y - cat.colliderHeight / 2;

      if (
        catBottom >= this.platformY &&
        catTop < this.platformY + this.platformHeight &&
        cat.x >= this.platformX - this.platformWidth / 2 - 8 &&
        cat.x <= this.platformX + this.platformWidth / 2 + 8 &&
        cat.vy > 0
      ) {
        this.landCat(cat, this.platformY - cat.colliderHeight / 2);
      } else {
        // Check collision with already stacked cats
        for (let i = this.stackedCats.length - 1; i >= 0; i--) {
          const target = this.stackedCats[i];
          if (target.isFallen) continue;

          const targetTop = target.y - target.colliderHeight / 2;
          const dx = Math.abs(cat.x - target.x);
          const dy = targetTop - catBottom;

          // Land if bottom touches top of below cat
          if (dx < (cat.colliderWidth + target.colliderWidth) * 0.46 && dy >= -10 && dy <= 12 && cat.vy > 0) {
            const landY = targetTop - cat.colliderHeight / 2 + 1;
            this.landCat(cat, landY, target);
            break;
          }
        }
      }

      // Fell off screen
      if (cat.y - cat.colliderHeight > this.platformY + 120) {
        this.onCatFell(cat);
      }
    }

    // 3. Singular Rigid Body Tower Physics Solver
    if (!this.towerToppled) {
      const cos = Math.cos(this.towerAngle);
      const sin = Math.sin(this.towerAngle);

      let highestCatY = this.platformY;
      let totalMass = 0;
      let weightedX = 0;

      for (const cat of this.stackedCats) {
        if (cat.isFallen) continue;

        // Transform local coordinates into world coordinates on the rotated rigid body
        cat.x = this.platformX + cat.localX * cos - cat.localY * sin;
        cat.y = this.platformY + cat.localX * sin + cat.localY * cos;
        cat.angle = this.towerAngle + cat.localAngle;

        if (cat.squishTimer > 0) cat.squishTimer -= dt;

        totalMass += cat.mass;
        weightedX += cat.x * cat.mass;

        const topY = cat.y - cat.colliderHeight / 2;
        if (topY < highestCatY) highestCatY = topY;
      }

      if (totalMass > 0) {
        const centerOfMassX = weightedX / totalMass;
        const comOffset = centerOfMassX - this.platformX;
        const baseHalfWidth = this.platformWidth * 0.45;

        // Target angle based on center of mass position
        let targetAngle = 0;
        let tippingAccel = 0;

        if (Math.abs(comOffset) <= baseHalfWidth) {
          // Center of mass is supported by the platform base -> stable gentle lean
          targetAngle = (comOffset / baseHalfWidth) * 0.18; // Max ~10 degrees lean while on base
        } else {
          // Center of mass is outside base -> toppling torque!
          const overhang = Math.abs(comOffset) - baseHalfWidth;
          const dir = comOffset > 0 ? 1 : -1;
          targetAngle = dir * (0.18 + overhang * 0.005);
          tippingAccel = dir * overhang * 0.8;
        }

        // Spring torque towards target equilibrium angle
        const springTorque = (targetAngle - this.towerAngle) * 35.0;
        const dampingTorque = -this.towerAngularVel * 7.5;

        this.towerAngularVel += (springTorque + dampingTorque + tippingAccel) * dt;
        this.towerAngle += this.towerAngularVel * dt;

        // If tower leans beyond ~38° (0.66 rad), it topples!
        if (Math.abs(this.towerAngle) > 0.66) {
          this.toppleTower();
        }
      }


      // 4. Camera Altitude Tracking
      const peakHeightPixels = Math.max(0, this.platformY - highestCatY);
      this.currentAltitude = parseFloat((peakHeightPixels / 22.0).toFixed(1));

      // Target Camera Y so highest cat is kept in middle 55% of canvas
      if (highestCatY < this.canvas.height * 0.55 + this.cameraY) {
        this.targetCameraY = this.canvas.height * 0.55 - highestCatY;
      }
      this.cameraY = Phaser.Math.Linear(this.cameraY, this.targetCameraY, 0.08);

    } else {
      // Tower has toppled: All cats tumble freely with ragdoll physics
      for (const cat of this.stackedCats) {
        cat.vy += 540 * dt;
        cat.x += cat.vx * dt;
        cat.y += cat.vy * dt;
        cat.angle += cat.angularVel * dt;

        if (cat.y > this.platformY + 65) {
          this.onCatFell(cat);
        }
      }
    }

    // 5. Milestones Check
    for (const ms of MILESTONES) {
      if (this.currentAltitude >= ms.height && !this.claimedMilestones.has(ms.height)) {
        this.claimedMilestones.add(ms.height);
        this.accumulatedLove += ms.love;
        this.accumulatedStars += ms.stars;
        this.triggerMilestoneBanner(ms.label, ms.love, ms.stars);
      }
    }

    // 6. Update Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life += dt;
      p.alpha = 1 - p.life / p.maxLife;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
      }
    }

    this.updateHud();
  }

  // ── Cat Landing on Rigid Body Tower ───────────────────────────────────────

  private landCat(cat: PhysicsCat, landY: number, _beneath?: PhysicsCat): void {
    // Invert the tower rotation matrix to compute exact local coordinates on the rigid body
    const cos = Math.cos(this.towerAngle);
    const sin = Math.sin(this.towerAngle);

    const contactX = cat.x;
    const contactY = landY;
    const dx = contactX - this.platformX;
    const dy = contactY - this.platformY;

    // Inverse rotation: local = R(-θ) * world
    cat.localX = dx * cos + dy * sin;
    cat.localY = -dx * sin + dy * cos;
    cat.localAngle = 0;

    cat.vx = 0;
    cat.vy = 0;
    cat.isDropping = false;
    cat.isSettled = true;
    cat.squishTimer = 0.25;


    // Impart impact angular momentum to the tower
    const impactTorque = (cat.x - this.platformX) * cat.mass * 35;
    this.towerAngularVel += impactTorque / 6000;

    this.stackedCats.push(cat);
    this.activeFallingCat = null;
    this.scoreCats++;

    // Trait sound & particle juice
    sound.playCrunch();
    this.spawnParticle(cat.x - 18, cat.y + 12, '#ffffff', 6);
    this.spawnParticle(cat.x + 18, cat.y + 12, '#ffffff', 6);

    if (cat.mutation === 'sparkly' || cat.mutation === 'gilded') {
      sound.playCoin();
      this.accumulatedStars += 2;
      for (let i = 0; i < 6; i++) {
        this.spawnParticle(cat.x + (Math.random() - 0.5) * 35, cat.y - 10, '#fbbf24', 6);
      }
    } else if (cat.mutation === 'flaming') {
      for (let i = 0; i < 6; i++) {
        this.spawnParticle(cat.x + (Math.random() - 0.5) * 30, cat.y - 8, '#f97316', 6);
      }
    }

    this.accumulatedLove += 15;
    this.updateHud();
  }

  private toppleTower(): void {
    if (this.towerToppled) return;
    this.towerToppled = true;
    sound.playCrunch();

    const dir = this.towerAngle > 0 ? 1 : -1;
    for (const cat of this.stackedCats) {
      const r = Math.hypot(cat.x - this.platformX, cat.y - this.platformY);
      cat.vx = dir * Math.max(80, Math.abs(this.towerAngularVel) * r * 0.9) + (Math.random() - 0.5) * 50;
      cat.vy = -Math.abs(this.towerAngularVel) * 35 + Math.random() * 30;
      cat.angularVel = this.towerAngularVel * 1.5 + (Math.random() - 0.5) * 2;
    }
  }




  // ── Cat Fall Loss Condition ───────────────────────────────────────────────

  private onCatFell(cat: PhysicsCat): void {
    cat.isFallen = true;
    if (this.activeFallingCat === cat) {
      this.activeFallingCat = null;
    }

    sound.playPop();
    this.spawnParticle(cat.x, this.canvas.height - 40, '#f43f5e', 12);
    this.triggerGameOver();
  }

  private triggerGameOver(): void {
    if (this.isGameOver) return;
    this.isGameOver = true;
    this.updateHud();
    sound.playTap();

    const resultsCard = this.overlay.querySelector('#pyr-results-card');
    const resHeight = this.overlay.querySelector('#pyr-res-height');
    const resCats = this.overlay.querySelector('#pyr-res-cats');
    const resRewards = this.overlay.querySelector('#pyr-rewards-box');

    if (resHeight) resHeight.textContent = `${this.currentAltitude.toFixed(1)} m`;
    if (resCats) resCats.textContent = `${this.scoreCats} Cats`;
    if (resRewards) {
      resRewards.innerHTML = `<span>+${this.accumulatedLove.toLocaleString()} 💗</span><span>•</span><span>+${this.accumulatedStars} ⭐</span>`;
    }

    resultsCard?.classList.add('open');
  }

  private triggerMilestoneBanner(label: string, love: number, stars: number): void {
    const banner = this.overlay.querySelector('#pyr-milestone-banner');
    if (!banner) return;

    sound.playDone();
    banner.innerHTML = `<span>${label}</span> <span style="font-size:12px;opacity:0.85;">(+${love} 💗, +${stars} ⭐)</span>`;
    banner.classList.add('show');

    setTimeout(() => {
      banner.classList.remove('show');
    }, 2800);
  }

  private updateHud(): void {
    const countEl = this.overlay.querySelector('#pyr-count-val');
    const loveEl = this.overlay.querySelector('#pyr-love-val');
    const altEl = this.overlay.querySelector('#pyr-alt-val');

    if (countEl) countEl.textContent = `${this.scoreCats}`;
    if (loveEl) loveEl.textContent = `${this.accumulatedLove}`;
    if (altEl) altEl.textContent = `${this.currentAltitude.toFixed(1)} m`;
  }

  private spawnParticle(x: number, y: number, color: string, size = 4): void {
    this.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 60,
      vy: -Math.random() * 60 - 20,
      alpha: 1,
      color,
      size,
      life: 0,
      maxLife: 0.55 + Math.random() * 0.3,
    });
  }

  // ── Render Frame ──────────────────────────────────────────────────────────

  private renderCanvas(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);

    // 1. Atmosphere Dynamic Background Gradient
    const alt = this.currentAltitude;
    let bgGrad = this.ctx.createLinearGradient(0, 0, 0, h);

    if (alt < 35) {
      // Warm Sunny Garden to Light Sky
      bgGrad.addColorStop(0, '#38bdf8');
      bgGrad.addColorStop(0.6, '#bae6fd');
      bgGrad.addColorStop(1, '#fef08a');
    } else if (alt < 90) {
      // Golden Sunset Clouds
      bgGrad.addColorStop(0, '#fb923c');
      bgGrad.addColorStop(0.5, '#f472b6');
      bgGrad.addColorStop(1, '#bae6fd');
    } else if (alt < 180) {
      // Twilight Starry Aurora
      bgGrad.addColorStop(0, '#312e81');
      bgGrad.addColorStop(0.5, '#6366f1');
      bgGrad.addColorStop(1, '#ec4899');
    } else {
      // Deep Cosmic Space & Moon
      bgGrad.addColorStop(0, '#09090b');
      bgGrad.addColorStop(0.6, '#1e1b4b');
      bgGrad.addColorStop(1, '#312e81');
    }

    this.ctx.fillStyle = bgGrad;
    this.ctx.fillRect(0, 0, w, h);

    this.ctx.save();
    // Apply Camera translation
    this.ctx.translate(0, this.cameraY);

    // 2. Base Platform / Cozy Cushion Pedestal (Scaled up)
    const platX = this.platformX;
    const platY = this.platformY;

    this.ctx.fillStyle = '#78350f'; // Dark hardwood base
    this.ctx.fillRect(platX - this.platformWidth / 2, platY + 16, this.platformWidth, 18);

    this.ctx.fillStyle = '#ea580c'; // Cozy Plaid Cushion
    this.ctx.beginPath();
    this.ctx.roundRect(platX - this.platformWidth / 2 - 6, platY, this.platformWidth + 12, 22, 10);
    this.ctx.fill();

    this.ctx.fillStyle = '#fed7aa'; // Cushion highlights
    this.ctx.fillRect(platX - this.platformWidth / 2 + 14, platY + 3, this.platformWidth - 28, 4);

    // 3. Render Stacked Cats
    for (const cat of this.stackedCats) {
      if (cat.isFallen) continue;
      this.drawCat(cat);
    }

    // 4. Render Active Falling Cat
    if (this.activeFallingCat) {
      this.drawCat(this.activeFallingCat);
    }

    // 5. Render Particles
    for (const p of this.particles) {
      this.ctx.globalAlpha = p.alpha;
      this.ctx.fillStyle = p.color;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.globalAlpha = 1.0;

    this.ctx.restore();

    // 6. Dropper Cloud Crane (Fixed Screen Space)
    this.drawDropperCloud(this.dropperX, this.dropperY);

    // Draw Ready Cat swaying under the cloud before drop
    if (!this.activeFallingCat && this.catQueue.length > 0) {
      const nextReadyCat = this.catQueue[this.queueIndex % this.catQueue.length];
      this.drawReadyCat(nextReadyCat, this.dropperX, this.dropperY + 28);
    }
  }

  private drawCat(physCat: PhysicsCat): void {
    this.ctx.save();
    this.ctx.translate(physCat.x, physCat.y);
    this.ctx.rotate(physCat.angle);

    const squish = physCat.squishTimer > 0 ? 0.85 : 1.0;
    const stretch = physCat.squishTimer > 0 ? 1.15 : 1.0;
    this.ctx.scale(stretch, squish);

    const size = physCat.spriteSize;
    const FRAME_SIZE = 32;

    let srcX = 0;
    let srcY = 2 * FRAME_SIZE; // Row 2, Col 0: Front sitting loaf

    if (physCat.isDropping) {
      // In air spread legs jump/fall frame
      srcX = 20 * FRAME_SIZE;
      srcY = 10 * FRAME_SIZE;
    }

    // Mutation color filters
    if (physCat.mutation === 'inverted') {
      this.ctx.filter = 'invert(0.92) hue-rotate(180deg) saturate(1.8)';
    } else if (physCat.mutation === 'frosted') {
      this.ctx.filter = 'hue-rotate(180deg) saturate(2.0) brightness(1.15)';
    } else if (physCat.mutation === 'flaming') {
      this.ctx.filter = 'sepia(0.65) saturate(3.5) hue-rotate(-30deg) brightness(1.1)';
    } else if (physCat.mutation === 'chromatic') {
      this.ctx.filter = `hue-rotate(${(performance.now() / 12) % 360}deg) saturate(2.4)`;
    } else if (physCat.mutation === 'sparkly') {
      this.ctx.filter = 'hue-rotate(280deg) saturate(2.2) brightness(1.25)';
    } else if (physCat.mutation === 'gilded') {
      this.ctx.filter = 'sepia(0.9) saturate(4.0) hue-rotate(10deg) brightness(1.15)';
    } else if (physCat.mutation === 'stinky') {
      this.ctx.filter = 'sepia(0.55) hue-rotate(85deg) saturate(2.5) brightness(0.95)';
    }

    // Paws sit at y = 28 in 32x32 frame (0.875 of sprite height).
    // Align bottom paws with collider bottom (+colliderHeight / 2):
    const drawOffsetX = -size / 2;
    const drawOffsetY = (physCat.colliderHeight / 2) - (size * 0.875);

    if (physCat.baseImg && physCat.baseImg.complete) {
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.drawImage(physCat.baseImg, srcX, srcY, FRAME_SIZE, FRAME_SIZE, drawOffsetX, drawOffsetY, size, size);
      if (physCat.markingImg && physCat.markingImg.complete) {
        this.ctx.drawImage(physCat.markingImg, srcX, srcY, FRAME_SIZE, FRAME_SIZE, drawOffsetX, drawOffsetY, size, size);
      }
    } else {
      // Fallback cozy loaf silhouette
      this.ctx.fillStyle = '#f59e0b';
      this.ctx.beginPath();
      this.ctx.roundRect(-physCat.colliderWidth / 2, -physCat.colliderHeight / 2, physCat.colliderWidth, physCat.colliderHeight, 8);
      this.ctx.fill();
    }

    // Angelic wings render
    if (physCat.mutation === 'angelic') {
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      this.ctx.beginPath();
      this.ctx.ellipse(-physCat.colliderWidth / 2 - 2, 0, 12, 6, -0.4, 0, Math.PI * 2);
      this.ctx.ellipse(physCat.colliderWidth / 2 + 2, 0, 12, 6, 0.4, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  private drawReadyCat(cat: Cat, x: number, y: number): void {
    const isGiant = cat.mutation === 'giant';
    const isTiny = cat.mutation === 'tiny' || cat.stage === 'kitten';
    const isTeen = cat.stage === 'teen';

    const spriteSize = isGiant ? 136 : isTiny ? 72 : isTeen ? 88 : 104;
    const colliderHeight = Math.round(spriteSize * 0.50);
    const drawOffsetY = (colliderHeight / 2) - (spriteSize * 0.875);
    const drawOffsetX = -spriteSize / 2;

    const skinDef = CAT_SKINS.find((s) => s.id === cat.color) || CAT_SKINS[0];
    const skinSrc = skinDef?.file ? `./assets/cats/${skinDef.file}` : './assets/cats/orange_0.png';
    const markingDef = cat.pattern ? CAT_MARKINGS.find((m) => m.id === cat.pattern) : null;
    const markingSrc = markingDef?.file ? `./assets/cats/Markings/${markingDef.file}` : null;

    const FRAME_SIZE = 32;
    const srcX = 0;
    const srcY = 2 * FRAME_SIZE;

    PyramidScene.loadImage(skinSrc).then((baseImg) => {
      this.ctx.save();
      this.ctx.translate(x, y);

      // Mutation color filters
      if (cat.mutation === 'inverted') {
        this.ctx.filter = 'invert(0.92) hue-rotate(180deg) saturate(1.8)';
      } else if (cat.mutation === 'frosted') {
        this.ctx.filter = 'hue-rotate(180deg) saturate(2.0) brightness(1.15)';
      } else if (cat.mutation === 'flaming') {
        this.ctx.filter = 'sepia(0.65) saturate(3.5) hue-rotate(-30deg) brightness(1.1)';
      } else if (cat.mutation === 'sparkly') {
        this.ctx.filter = 'hue-rotate(280deg) saturate(2.2) brightness(1.25)';
      } else if (cat.mutation === 'gilded') {
        this.ctx.filter = 'sepia(0.9) saturate(4.0) hue-rotate(10deg) brightness(1.15)';
      } else if (cat.mutation === 'stinky') {
        this.ctx.filter = 'sepia(0.55) hue-rotate(85deg) saturate(2.5) brightness(0.95)';
      }

      this.ctx.imageSmoothingEnabled = false;
      this.ctx.drawImage(baseImg, srcX, srcY, FRAME_SIZE, FRAME_SIZE, drawOffsetX, drawOffsetY, spriteSize, spriteSize);

      if (markingSrc) {
        PyramidScene.loadImage(markingSrc).then((markImg) => {
          this.ctx.drawImage(markImg, srcX, srcY, FRAME_SIZE, FRAME_SIZE, drawOffsetX, drawOffsetY, spriteSize, spriteSize);
        });
      }

      if (cat.mutation === 'angelic') {
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        this.ctx.beginPath();
        this.ctx.ellipse(-spriteSize * 0.38 - 2, 0, 12, 6, -0.4, 0, Math.PI * 2);
        this.ctx.ellipse(spriteSize * 0.38 + 2, 0, 12, 6, 0.4, 0, Math.PI * 2);
        this.ctx.fill();
      }

      this.ctx.restore();
    });
  }

  private drawDropperCloud(x: number, y: number): void {
    this.ctx.save();
    this.ctx.fillStyle = '#ffffff';
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
    this.ctx.shadowBlur = 12;

    // Puffy cloud shape (Scaled up for 2x cats)
    this.ctx.beginPath();
    this.ctx.arc(x - 42, y, 26, 0, Math.PI * 2);
    this.ctx.arc(x, y - 14, 34, 0, Math.PI * 2);
    this.ctx.arc(x + 42, y, 26, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.shadowBlur = 0;
    this.ctx.restore();
  }


  // ── Exit & Claim Rewards ──────────────────────────────────────────────────

  private claimAndExit(): void {
    if (this.accumulatedLove > 0 || this.accumulatedStars > 0) {
      EventBus.emit('pyramid-reward', {
        love: this.accumulatedLove,
        stars: this.accumulatedStars,
        height: this.currentAltitude,
        catsCount: this.scoreCats,
      });
      EventBus.emit('toast', {
        message: `🏆 Pyramid Rewards: +${this.accumulatedLove.toLocaleString()} 💗, +${this.accumulatedStars} ⭐!`,
      });
    }
    this.unmount();
  }
}
