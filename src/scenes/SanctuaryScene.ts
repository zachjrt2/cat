import Phaser from 'phaser';
import type { Cat, CatArea, GameState, RareCatType, ToolType } from '../data/types';
import { generateCat, generateRareCat } from '../data/catFactory';
import { createNewGameState, SaveManager } from '../systems/SaveManager';
import { LoveManager } from '../systems/LoveManager';
import { RelationshipSystem } from '../systems/RelationshipSystem';
import { JournalSystem } from '../systems/JournalSystem';
import { EventSystem } from '../systems/EventSystem';
import { InteractionSystem } from '../systems/InteractionSystem';
import { WeatherManager } from '../systems/WeatherManager';
import { MilestoneManager } from '../systems/MilestoneManager';
import { GrowthSystem } from '../systems/GrowthSystem';
import { AutomationSystem } from '../systems/AutomationSystem';
import { BreedingSystem } from '../systems/BreedingSystem';
import { tickCatNeeds } from '../systems/NeedsSystem';
import { CatSprite } from '../entities/CatSprite';
import { ToyBall } from '../entities/ToyBall';
import { KibbleBag, KibblePiece } from '../entities/KibbleBag';
import { AUTOSAVE_INTERVAL_MS, AREA_INFO_MAP, FURNITURE_CATALOG, RARE_SUMMONS, OFFLINE_STAR_UPGRADES, calculateRehomeLove } from '../data/constants';
import { BREED_COOLDOWN_MS } from '../systems/BreedingSystem';
import { EventBus } from '../ui/EventBus';
import { sound } from '../systems/SoundManager';
import { exportCatCardAsPng } from '../systems/CardExport';

const TOOLBAR_RESERVED_PX = 100;
const TOP_BAR_RESERVED_PX = 110;

interface AmbientEffectItem {
  type: 'ember' | 'steam' | 'mote' | 'ripple';
  x: number;
  y: number;
  speedX: number;
  speedY: number;
  alpha: number;
  size: number;
  life: number;
  maxLife: number;
  color: number;
}

export class SanctuaryScene extends Phaser.Scene {
  private state!: GameState;
  private saveManager = new SaveManager();
  private love!: LoveManager;
  private relationships!: RelationshipSystem;
  private journal!: JournalSystem;
  private events_!: EventSystem;
  private interactions!: InteractionSystem;
  private weather!: WeatherManager;
  private milestones!: MilestoneManager;
  private growth = new GrowthSystem();
  private automation!: AutomationSystem;
  private breeding!: BreedingSystem;
  private onlineProgressionAccumMs = 0;

  private currentArea: CatArea = 'yard';
  private catSprites = new Map<string, CatSprite>();
  private selectedTool: ToolType | null = null;
  private toyBall: ToyBall | null = null;
  private kibbleBag: KibbleBag | null = null;
  private kibblePieces: KibblePiece[] = [];
  private washBrushFollower: Phaser.GameObjects.Container | null = null;
  private lastTick = 0;
  private lastWashLoveTime = 0;
  private lastBubbleSpawnTime = 0;
  private relationshipTickAccum = 0;
  private animTimer = 0;

  private weatherParticlesGfx!: Phaser.GameObjects.Graphics;
  private ambientLightingGfx!: Phaser.GameObjects.Graphics;
  private dynamicEffectsGfx!: Phaser.GameObjects.Graphics;
  private particles: Array<{ x: number; y: number; speedY: number; speedX: number; size: number; alpha: number }> = [];
  private ambientEffects: AmbientEffectItem[] = [];

  // Cat Drag & Drop Interaction System
  private dragCandidate: {
    cat: Cat;
    sprite: CatSprite;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    startTime: number;
  } | null = null;
  private isDraggingCat = false;
  private currentDropTarget: CatSprite | null = null;

  constructor() {
    super('Sanctuary');
  }

  create(): void {
    this.initState();
    this.initWeatherAndLighting();
    this.drawCurrentArea();
    this.spawnCatsInCurrentArea();
    this.bindUiEvents();

    this.lastTick = this.time.now;

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.selectedTool === 'toy' && this.toyBall && !this.toyBall.isDragging) {
        const bounds = this.areaBounds();
        if (bounds.contains(pointer.x, pointer.y)) {
          const dx = pointer.x - this.toyBall.x;
          const dy = pointer.y - this.toyBall.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 24) {
            const speed = Math.min(650, dist * 3.5);
            this.toyBall.kick((dx / dist) * speed, (dy / dist) * speed);
            sound.playTap();
          }
        }
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.onScenePointerMove(pointer);
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.onScenePointerUp(pointer);
    });

    this.time.addEvent({
      delay: AUTOSAVE_INTERVAL_MS,
      loop: true,
      callback: () => this.saveManager.save(this.state),
    });


    this.scale.on('resize', () => {
      this.drawCurrentArea();
    });

    this.notifyUiState();
  }

  private initState(): void {
    const loaded = this.saveManager.load();
    this.state = loaded ?? createNewGameState();

    // Ensure all areas are properly structured in state
    if (!this.state.areas.yard) {
      this.state.areas = {
        yard: { id: 'yard', unlocked: true, unlockThreshold: 0, capacity: 5 },
        shelter: { id: 'shelter', unlocked: false, unlockThreshold: 3, capacity: 15 },
        sunroom: { id: 'sunroom', unlocked: false, unlockThreshold: 8, capacity: 25 },
        cafe: { id: 'cafe', unlocked: false, unlockThreshold: 15, capacity: 40 },
      };
    }

    // Ensure all cats have a valid area assignment
    for (const cat of this.state.cats) {
      if (!cat.area || !this.state.areas[cat.area]?.unlocked) {
        cat.area = 'yard';
      }
    }

    this.love = new LoveManager(this.state);
    this.relationships = new RelationshipSystem(this.state);
    this.journal = new JournalSystem(this.state);
    this.events_ = new EventSystem(this.state, this.love, this.journal, this.relationships);
    this.interactions = new InteractionSystem(this.love, this.journal);
    this.weather = new WeatherManager(this.state);
    this.milestones = new MilestoneManager(this.state);
    this.automation = new AutomationSystem(this.state, this.love);
    this.breeding = new BreedingSystem(this.state);

    if (loaded) {
      const summary = this.saveManager.applyOfflineProgress(this.state);
      if (summary.minutesAway > 1) {
        EventBus.emit('offline-summary', summary);
      }
    } else {
      // Warm onboarding: sanctuary starts with TWO adult cats in the Yard ready to pair & play
      const usedNames = new Set<string>();
      this.state.cats.push(generateCat({ day: this.state.day, usedNames, stage: 'adult' }));
      this.state.cats.push(generateCat({ day: this.state.day, usedNames, stage: 'adult' }));
      this.love.add(50);
    }
  }


  private initWeatherAndLighting(): void {
    this.dynamicEffectsGfx = this.add.graphics();
    this.dynamicEffectsGfx.setDepth(800);

    this.weatherParticlesGfx = this.add.graphics();
    this.weatherParticlesGfx.setDepth(900);

    this.ambientLightingGfx = this.add.graphics();
    this.ambientLightingGfx.setDepth(950);

    this.resetWeatherParticles();
  }

  private resetWeatherParticles(): void {
    const bounds = this.areaBounds();
    this.particles = [];
    const count = this.weather.weather === 'rain' ? 65 : this.weather.weather === 'snow' ? 50 : 0;

    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Phaser.Math.Between(bounds.left, bounds.right),
        y: Phaser.Math.Between(bounds.top, bounds.bottom),
        speedY: this.weather.weather === 'rain' ? Phaser.Math.Between(220, 320) : Phaser.Math.Between(35, 75),
        speedX: this.weather.weather === 'rain' ? -25 : Phaser.Math.Between(-15, 15),
        size: this.weather.weather === 'rain' ? Phaser.Math.Between(8, 16) : Phaser.Math.Between(2, 4.5),
        alpha: Phaser.Math.FloatBetween(0.35, 0.85),
      });
    }
  }

  private notifyUiState(): void {
    EventBus.emit('love-changed', { love: this.love.love });
    EventBus.emit('tokens-changed', { tokens: this.milestones.tokens });
    EventBus.emit('cats-changed', { count: this.state.cats.length });
    EventBus.emit('time-changed', { timeOfDay: this.weather.timeOfDay });
    EventBus.emit('weather-changed', { weather: this.weather.weather });
    EventBus.emit('sanctuary-state', {
      areas: this.state.areas,
      currentArea: this.currentArea,
      cats: this.state.cats,
      furniture: this.state.furniture,
      machines: this.state.machines,
      strayDueAt: this.state.strayArrivalDueAt,
      milestones: this.milestones.getMilestones(),
      tokens: this.milestones.tokens,
    });
  }


  private areaBounds(): Phaser.Geom.Rectangle {
    const w = this.scale.width;
    const h = this.scale.height;
    return new Phaser.Geom.Rectangle(
      16,
      TOP_BAR_RESERVED_PX,
      Math.max(280, w - 32),
      Math.max(300, h - TOP_BAR_RESERVED_PX - TOOLBAR_RESERVED_PX - 16),
    );
  }

  private drawCurrentArea(): void {
    this.children.getAll('name', 'area-bg').forEach((c) => c.destroy());
    this.ambientEffects = [];

    switch (this.currentArea) {
      case 'yard':
        this.drawYardBackground();
        break;
      case 'shelter':
        this.drawShelterBackground();
        break;
      case 'sunroom':
        this.drawSunroomBackground();
        break;
      case 'cafe':
        this.drawCafeBackground();
        break;
    }

    // Render Placed Furniture in this area
    this.drawPlacedFurniture();

    const bounds = this.areaBounds();
    if (this.kibbleBag) {
      this.kibbleBag.setBounds(bounds);
    }
    if (this.toyBall) {
      this.toyBall.setBounds(bounds);
    }
    for (const sprite of this.catSprites.values()) {
      sprite.setAreaBounds(bounds);
      sprite.setSelectedTool(this.selectedTool);
    }
  }

  // =========================================================================
  // 1. OUTDOOR SUNNY YARD (Lush Botanical Sanctuary)
  // =========================================================================
  private drawYardBackground(): void {
    const bounds = this.areaBounds();
    const g = this.add.graphics({ x: 0, y: 0 });
    g.name = 'area-bg';
    g.setDepth(-100);

    // Stone Garden Wall Border
    g.fillStyle(0x607d47, 0.45);
    g.fillRoundedRect(bounds.x - 6, bounds.y - 6, bounds.width + 12, bounds.height + 12, 28);
    g.fillStyle(0x8fa878, 1);
    g.fillRoundedRect(bounds.x - 3, bounds.y - 3, bounds.width + 6, bounds.height + 6, 26);

    // Multi-Tone Rolling Grass Lawn Base
    g.fillStyle(0xcce8a9, 1);
    g.fillRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, 24);

    // Lush Hill Contours
    g.fillStyle(0xddf4c3, 1);
    g.fillRoundedRect(bounds.x + 8, bounds.y + 8, bounds.width - 16, bounds.height * 0.46, 20);
    g.fillStyle(0xbadc92, 1);
    g.fillRoundedRect(bounds.x + 10, bounds.y + bounds.height * 0.54, bounds.width - 20, bounds.height * 0.43, 20);

    // Clover Patches
    const cloverCoords = [
      [bounds.left + 35, bounds.top + 50],
      [bounds.left + 80, bounds.bottom - 80],
      [bounds.right - 70, bounds.top + 130],
      [bounds.right - 120, bounds.bottom - 60],
      [bounds.left + bounds.width * 0.4, bounds.top + 45],
    ];
    cloverCoords.forEach(([cx, cy]) => {
      g.fillStyle(0x9fc871, 0.85);
      g.fillCircle(cx - 3, cy, 3.5);
      g.fillCircle(cx + 3, cy, 3.5);
      g.fillCircle(cx, cy - 3.5, 3.5);
      g.fillStyle(0x85ad57, 0.9);
      g.fillCircle(cx, cy, 1.5);
    });

    // White Picket Fence along the Top
    const fenceY = bounds.top + 14;
    const postCount = Math.floor((bounds.width - 40) / 22);
    g.fillStyle(0xede7d9, 1);
    g.fillRect(bounds.left + 15, fenceY + 6, bounds.width - 30, 4);
    g.fillRect(bounds.left + 15, fenceY + 16, bounds.width - 30, 4);

    for (let i = 0; i < postCount; i++) {
      const px = bounds.left + 22 + i * 22;
      g.fillStyle(0xffffff, 1);
      g.fillRect(px - 4, fenceY, 8, 24);
      // Picket tip
      g.fillTriangle(px - 4, fenceY, px + 4, fenceY, px, fenceY - 5);
      // Shadow
      g.fillStyle(0xd9d3c5, 0.8);
      g.fillRect(px + 2, fenceY, 2, 24);
    }

    // Climbing Ivy on Fence
    g.fillStyle(0x52b788, 0.9);
    for (let i = 0; i < postCount; i += 3) {
      const px = bounds.left + 22 + i * 22;
      g.fillEllipse(px - 2, fenceY + 8, 9, 6);
      g.fillEllipse(px + 4, fenceY + 14, 8, 5);
      g.fillStyle(0xff99c8, 1);
      g.fillCircle(px + 1, fenceY + 11, 2.5); // morning glory bloom
      g.fillStyle(0x52b788, 0.9);
    }

    // Winding Cobblestone Garden Path
    const startX = bounds.left + 58;
    const startY = bounds.top + 50;
    const stoneCoords: [number, number, number, number][] = [
      [startX, startY, 24, 16],
      [startX + 18, startY + 36, 26, 17],
      [startX + 42, startY + 74, 28, 18],
      [startX + 28, startY + 116, 24, 16],
      [startX + 50, startY + 158, 27, 18],
      [startX + 38, startY + 200, 25, 17],
    ];
    stoneCoords.forEach(([sx, sy, rw, rh]) => {
      if (sy < bounds.bottom - 45) {
        // Drop shadow
        g.fillStyle(0x8a9e70, 0.6);
        g.fillEllipse(sx + 2, sy + 3, rw, rh);
        // Flagstone body
        g.fillStyle(0xe2ded4, 0.95);
        g.fillEllipse(sx, sy, rw, rh);
        // Inner highlight & texture
        g.fillStyle(0xf5f3ee, 0.8);
        g.fillEllipse(sx - 2, sy - 2, rw * 0.65, rh * 0.6);
      }
    });

    // Checkered Gingham Outdoor Picnic Blanket & Tufted Pillows (Top Right)
    const rugX = bounds.right - 76;
    const rugY = bounds.top + 62;
    g.fillStyle(0x8a9e70, 0.4);
    g.fillRoundedRect(rugX - 48, rugY - 26, 96, 56, 16);

    // Base Blanket
    g.fillStyle(0xffccd5, 1);
    g.fillRoundedRect(rugX - 45, rugY - 24, 90, 52, 14);

    // Gingham Check Pattern
    g.fillStyle(0xffb3c1, 0.7);
    for (let bx = rugX - 42; bx < rugX + 42; bx += 14) {
      g.fillRect(bx, rugY - 24, 7, 52);
    }
    for (let by = rugY - 22; by < rugY + 26; by += 14) {
      g.fillRect(rugX - 45, by, 90, 7);
    }

    // Plush Tufted Pillow on Blanket
    g.fillStyle(0xffffff, 0.95);
    g.fillEllipse(rugX - 22, rugY - 4, 24, 18);
    g.fillStyle(0xffe5ec, 1);
    g.fillCircle(rugX - 22, rugY - 4, 4);

    // Stone Birdbath with Glistening Water (Bottom Right)
    const bbX = bounds.right - 58;
    const bbY = bounds.bottom - 70;
    g.fillStyle(0x768a62, 0.5);
    g.fillEllipse(bbX, bbY + 12, 38, 16); // shadow
    g.fillStyle(0xc5beaf, 1);
    g.fillEllipse(bbX, bbY + 10, 24, 10); // base pedestal
    g.fillRect(bbX - 4, bbY - 8, 8, 18);
    g.fillStyle(0xdcd7cd, 1);
    g.fillEllipse(bbX, bbY - 8, 44, 24); // bowl outer rim
    g.fillStyle(0x8ecae6, 0.95);
    g.fillEllipse(bbX, bbY - 9, 36, 18); // fresh water
    g.fillStyle(0xffffff, 0.7);
    g.fillEllipse(bbX - 6, bbY - 11, 14, 6); // water glint

    // Blooming Flowerbeds (Daisies, Lavender, Buttercups)
    const flowerCoords: [number, number, number, number][] = [
      [bounds.left + 32, bounds.top + 88, 0xffffff, 0xffcc00],
      [bounds.left + 44, bounds.top + 96, 0xc77dff, 0xffffff],
      [bounds.right - 35, bounds.bottom - 42, 0xffd166, 0xff9f1c],
      [bounds.right - 50, bounds.bottom - 38, 0xffffff, 0xffcc00],
      [bounds.left + bounds.width * 0.48, bounds.top + 42, 0xff99c8, 0xffffff],
      [bounds.left + bounds.width * 0.72, bounds.bottom - 52, 0xc77dff, 0xffffff],
      [bounds.left + bounds.width * 0.28, bounds.bottom - 44, 0xffffff, 0xffcc00],
    ];
    flowerCoords.forEach(([fx, fy, petalCol, centerCol]) => {
      // Petals
      g.fillStyle(petalCol, 0.95);
      g.fillCircle(fx - 3.5, fy, 3.5);
      g.fillCircle(fx + 3.5, fy, 3.5);
      g.fillCircle(fx, fy - 3.5, 3.5);
      g.fillCircle(fx, fy + 3.5, 3.5);
      // Center
      g.fillStyle(centerCol, 1);
      g.fillCircle(fx, fy, 2.5);
    });

    // Elevated Wooden Bowls Station
    this.drawBowlsStation(g, bounds, 0xff758f, 0x48cae4);

    // Warm Sunbeam Rays
    if (this.weather.weather === 'sunny' && this.weather.timeOfDay !== 'night') {
      g.fillStyle(0xfffae6, 0.14);
      g.fillTriangle(bounds.right - 180, bounds.top, bounds.right, bounds.top, bounds.right, bounds.top + 260);
      g.fillTriangle(bounds.right - 90, bounds.top, bounds.right, bounds.top, bounds.right, bounds.top + 140);
    }
  }

  // =========================================================================
  // 2. COZY INDOOR SHELTER (Warm Living Room Sanctuary with Fireplace)
  // =========================================================================
  private drawShelterBackground(): void {
    const bounds = this.areaBounds();
    const g = this.add.graphics({ x: 0, y: 0 });
    g.name = 'area-bg';
    g.setDepth(-100);

    // Outer Room Frame
    g.fillStyle(0x543d2b, 0.5);
    g.fillRoundedRect(bounds.x - 6, bounds.y - 6, bounds.width + 12, bounds.height + 12, 28);
    g.fillStyle(0x735741, 1);
    g.fillRoundedRect(bounds.x - 3, bounds.y - 3, bounds.width + 6, bounds.height + 6, 26);

    // Warm Honey Oak Hardwood Planks Floor
    g.fillStyle(0xdfba87, 1);
    g.fillRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, 24);

    // Baseboard & Cozy Cream Wainscoting Upper Wall
    const wallHeight = Math.min(84, bounds.height * 0.28);
    g.fillStyle(0xf7ede2, 1);
    g.fillRoundedRect(bounds.x, bounds.y, bounds.width, wallHeight, 20);
    g.fillRect(bounds.x, bounds.y + wallHeight - 14, bounds.width, 14);

    // Wallpaper subtle stripe pattern
    g.fillStyle(0xf1e3d3, 0.7);
    for (let wx = bounds.x + 12; wx < bounds.right - 12; wx += 20) {
      g.fillRect(wx, bounds.y + 4, 3, wallHeight - 16);
    }

    // Wooden Baseboard Trim
    g.fillStyle(0x8a6240, 1);
    g.fillRect(bounds.x, bounds.y + wallHeight - 6, bounds.width, 8);
    g.fillStyle(0xa97d53, 1);
    g.fillRect(bounds.x, bounds.y + wallHeight - 8, bounds.width, 2);

    // Hardwood Floor Wood Planks Lines & Grain
    g.lineStyle(1.5, 0xbe9667, 0.65);
    const plankHeight = 32;
    for (let y = bounds.y + wallHeight + plankHeight; y < bounds.bottom - 8; y += plankHeight) {
      g.beginPath();
      g.moveTo(bounds.x + 8, y);
      g.lineTo(bounds.right - 8, y);
      g.strokePath();

      // Planks offset vertical cuts
      const offset = (y % 64 === 0) ? 40 : 90;
      for (let x = bounds.x + offset; x < bounds.right - 20; x += 110) {
        g.beginPath();
        g.moveTo(x, y - plankHeight);
        g.lineTo(x, y);
        g.strokePath();
      }
    }

    // Warm Twinkling Fairy Lights strung across top wall
    const fairyY = bounds.y + 12;
    g.lineStyle(1, 0xb08968, 0.7);
    g.beginPath();
    g.moveTo(bounds.left + 16, fairyY);
    for (let fx = bounds.left + 16; fx < bounds.right - 16; fx += 32) {
      g.lineTo(fx + 16, fairyY + 6);
      g.lineTo(fx + 32, fairyY);
    }
    g.strokePath();

    for (let fx = bounds.left + 24; fx < bounds.right - 24; fx += 32) {
      g.fillStyle(0xffe169, 0.95);
      g.fillCircle(fx, fairyY + 5, 3.5);
      g.fillStyle(0xfffae0, 1);
      g.fillCircle(fx, fairyY + 4, 1.5);
    }

    // Stone Brick Fireplace / Hearth (Top Center)
    const fpX = bounds.x + bounds.width * 0.5;
    const fpY = bounds.y + wallHeight - 12;
    const fpW = Math.min(120, bounds.width * 0.35);

    // Fireplace Mantle & Brick Surround
    g.fillStyle(0x735741, 0.5);
    g.fillRect(fpX - fpW / 2 - 2, fpY - 42, fpW + 4, 48); // drop shadow
    g.fillStyle(0xb08968, 1);
    g.fillRoundedRect(fpX - fpW / 2, fpY - 40, fpW, 46, 6);

    // Brick texture
    g.fillStyle(0x9c6644, 0.9);
    g.fillRect(fpX - fpW / 2 + 6, fpY - 34, 18, 8);
    g.fillRect(fpX - fpW / 2 + 28, fpY - 34, 18, 8);
    g.fillRect(fpX + fpW / 2 - 24, fpY - 34, 18, 8);
    g.fillRect(fpX - fpW / 2 + 16, fpY - 22, 20, 8);
    g.fillRect(fpX + fpW / 2 - 36, fpY - 22, 20, 8);

    // Firebox Cavity
    g.fillStyle(0x2b1e17, 1);
    g.fillRoundedRect(fpX - 26, fpY - 26, 52, 32, 6);

    // Glowing Animated Fire & Embers in Hearth
    g.fillStyle(0xff5400, 0.9);
    g.fillTriangle(fpX - 16, fpY + 2, fpX + 16, fpY + 2, fpX, fpY - 18);
    g.fillStyle(0xffbe0b, 1);
    g.fillTriangle(fpX - 10, fpY + 2, fpX + 10, fpY + 2, fpX, fpY - 12);
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(fpX, fpY - 2, 4);

    // Hearth Fire Glow Ambient Light
    g.fillStyle(0xff9e00, 0.15);
    g.fillCircle(fpX, fpY, 44);

    // Mantle Shelf with Miniature Succulents & Cat Clock
    g.fillStyle(0x582f0e, 1);
    g.fillRoundedRect(fpX - fpW / 2 - 8, fpY - 44, fpW + 16, 8, 3);
    g.fillStyle(0x7f4f24, 1);
    g.fillRect(fpX - fpW / 2 - 6, fpY - 44, fpW + 12, 2);

    // Succulents on Mantle
    g.fillStyle(0xd4a373, 1);
    g.fillRect(fpX - fpW / 2 + 2, fpY - 50, 8, 6);
    g.fillStyle(0x52b788, 1);
    g.fillCircle(fpX - fpW / 2 + 6, fpY - 52, 5);

    // Mini Cat Clock
    g.fillStyle(0xffcad4, 1);
    g.fillCircle(fpX + fpW / 2 - 6, fpY - 50, 6);
    g.fillStyle(0x4a4e69, 1);
    g.fillCircle(fpX + fpW / 2 - 6, fpY - 50, 1.5);

    // Left Plush Round Velvet Donut Bed (Sky Blue)
    const bed1X = bounds.left + 64;
    const bed1Y = bounds.top + wallHeight + 36;
    g.fillStyle(0x7a6855, 0.35);
    g.fillEllipse(bed1X, bed1Y + 6, 68, 36);
    g.fillStyle(0x90e0ef, 1);
    g.fillEllipse(bed1X, bed1Y, 64, 40);
    g.fillStyle(0x00b4d8, 0.4);
    g.fillEllipse(bed1X, bed1Y, 52, 30);
    g.fillStyle(0xcaf0f8, 1);
    g.fillEllipse(bed1X, bed1Y - 2, 44, 24);

    // Right Plush Round Velvet Donut Bed (Blush Pink)
    const bed2X = bounds.right - 68;
    const bed2Y = bounds.top + wallHeight + 36;
    g.fillStyle(0x7a6855, 0.35);
    g.fillEllipse(bed2X, bed2Y + 6, 68, 36);
    g.fillStyle(0xffb3c1, 1);
    g.fillEllipse(bed2X, bed2Y, 64, 40);
    g.fillStyle(0xff758f, 0.4);
    g.fillEllipse(bed2X, bed2Y, 52, 30);
    g.fillStyle(0xffe5ec, 1);
    g.fillEllipse(bed2X, bed2Y - 2, 44, 24);

    // Large Braided Boho Wool Rug with Fringe Tassels in Center
    const rugX = bounds.x + bounds.width * 0.5;
    const rugY = bounds.y + bounds.height * 0.68;
    const rugW = Math.min(180, bounds.width * 0.6);
    const rugH = Math.min(90, bounds.height * 0.32);

    g.fillStyle(0x8a705a, 0.3);
    g.fillRoundedRect(rugX - rugW / 2 - 2, rugY - rugH / 2 + 2, rugW + 4, rugH + 2, 22);

    // Rug Body
    g.fillStyle(0xf7ede2, 0.96);
    g.fillRoundedRect(rugX - rugW / 2, rugY - rugH / 2, rugW, rugH, 20);

    // Decorative Geometric Inset
    g.lineStyle(2, 0xddb892, 0.85);
    g.strokeRoundedRect(rugX - rugW / 2 + 8, rugY - rugH / 2 + 8, rugW - 16, rugH - 16, 14);
    g.fillStyle(0xe6ccb2, 0.5);
    g.fillEllipse(rugX, rugY, rugW * 0.5, rugH * 0.5);

    // Rug Fringe Tassels
    g.fillStyle(0xddb892, 0.9);
    for (let fx = rugX - rugW / 2 + 10; fx < rugX + rugW / 2 - 10; fx += 12) {
      g.fillRect(fx, rugY - rugH / 2 - 4, 3, 5);
      g.fillRect(fx, rugY + rugH / 2 - 1, 3, 5);
    }

    // Cute Paw-Shaped Silicone Mat Feeding Station
    this.drawBowlsStation(g, bounds, 0xff758f, 0x48cae4);
  }

  // =========================================================================
  // 3. WARM SUNROOM (Victorian Solarium & Conservatory)
  // =========================================================================
  private drawSunroomBackground(): void {
    const bounds = this.areaBounds();
    const g = this.add.graphics({ x: 0, y: 0 });
    g.name = 'area-bg';
    g.setDepth(-100);

    // Solarium Wrought-Iron Frame Outer
    g.fillStyle(0x2d4a3e, 0.5);
    g.fillRoundedRect(bounds.x - 6, bounds.y - 6, bounds.width + 12, bounds.height + 12, 28);
    g.fillStyle(0x406a52, 1);
    g.fillRoundedRect(bounds.x - 3, bounds.y - 3, bounds.width + 6, bounds.height + 6, 26);

    // Terracotta & Sage Mosaic Floor Base
    g.fillStyle(0xeddcd2, 1);
    g.fillRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, 24);

    // Victorian Arched Glass Windows Upper Half
    const winH = Math.min(100, bounds.height * 0.32);
    g.fillStyle(0xd8f3dc, 0.7);
    g.fillRoundedRect(bounds.x, bounds.y, bounds.width, winH, 20);

    // Sky gradient inside solarium windows
    g.fillStyle(0x95d5b2, 0.4);
    g.fillRect(bounds.x, bounds.y + 4, bounds.width, winH * 0.5);

    // Solarium Glass Arches Mullions
    g.lineStyle(2, 0x2d6a4f, 0.75);
    const archWidth = Math.max(50, Math.floor(bounds.width / 5));
    for (let ax = bounds.x + archWidth; ax < bounds.right - 10; ax += archWidth) {
      g.beginPath();
      g.moveTo(ax, bounds.y + 4);
      g.lineTo(ax, bounds.y + winH);
      g.strokePath();

      // Top Glass Arch Curves
      g.beginPath();
      g.arc(ax - archWidth / 2, bounds.y + 24, archWidth / 2 - 4, Math.PI, 0, false);
      g.strokePath();
    }

    // Glass Window Shelf Divider
    g.fillStyle(0x1b4332, 1);
    g.fillRect(bounds.x, bounds.y + winH - 4, bounds.width, 6);
    g.fillStyle(0x40916c, 1);
    g.fillRect(bounds.x, bounds.y + winH - 6, bounds.width, 2);

    // Mosaic Terracotta Tile Grid Lower Floor
    g.lineStyle(1.5, 0xddb892, 0.6);
    const tileSize = 36;
    for (let x = bounds.x + tileSize; x < bounds.right - 8; x += tileSize) {
      g.beginPath();
      g.moveTo(x, bounds.y + winH);
      g.lineTo(x, bounds.bottom - 8);
      g.strokePath();
    }
    for (let y = bounds.y + winH + tileSize; y < bounds.bottom - 8; y += tileSize) {
      g.beginPath();
      g.moveTo(bounds.x + 8, y);
      g.lineTo(bounds.right - 8, y);
      g.strokePath();
    }

    // Mosaic Inset Star Floral Tiles
    for (let tx = bounds.x + tileSize * 1.5; tx < bounds.right - tileSize; tx += tileSize * 2) {
      for (let ty = bounds.y + winH + tileSize * 1.5; ty < bounds.bottom - tileSize; ty += tileSize * 2) {
        g.fillStyle(0x74c69d, 0.45);
        g.fillCircle(tx, ty, 6);
        g.fillStyle(0xd94e34, 0.45);
        g.fillCircle(tx, ty, 3);
      }
    }

    // Hanging Macramé Planters from Glass Ceiling
    const planter1X = bounds.left + 54;
    const planter2X = bounds.right - 54;
    [planter1X, planter2X].forEach((px) => {
      // Hanging cord
      g.lineStyle(1.5, 0xd4a373, 0.9);
      g.beginPath();
      g.moveTo(px, bounds.y);
      g.lineTo(px, bounds.y + 36);
      g.strokePath();

      // Ceramic Pot
      g.fillStyle(0xffffff, 0.95);
      g.fillEllipse(px, bounds.y + 40, 26, 16);
      g.fillStyle(0xe9ecef, 1);
      g.fillEllipse(px, bounds.y + 43, 20, 10);

      // Trailing English Ivy & Pearls
      g.fillStyle(0x2d6a4f, 0.95);
      g.fillEllipse(px - 8, bounds.y + 36, 16, 12);
      g.fillEllipse(px + 8, bounds.y + 36, 16, 12);
      g.fillEllipse(px, bounds.y + 32, 14, 18);
      // Trailing strands
      g.fillCircle(px - 10, bounds.y + 48, 4);
      g.fillCircle(px - 8, bounds.y + 55, 3);
      g.fillCircle(px + 10, bounds.y + 48, 4);
      g.fillCircle(px + 12, bounds.y + 57, 3.5);
    });

    // Giant Potted Monstera Deliciosa (Left Corner)
    const mX = bounds.left + 50;
    const mY = bounds.bottom - 68;
    g.fillStyle(0x8a705a, 0.35);
    g.fillEllipse(mX, mY + 22, 38, 14); // shadow
    g.fillStyle(0xba7c59, 1);
    g.fillPoints([
      new Phaser.Geom.Point(mX - 16, mY),
      new Phaser.Geom.Point(mX + 16, mY),
      new Phaser.Geom.Point(mX + 12, mY + 24),
      new Phaser.Geom.Point(mX - 12, mY + 24),
    ], true);
    // Monstera Leaves
    g.fillStyle(0x40916c, 0.95);
    g.fillEllipse(mX - 18, mY - 14, 28, 18);
    g.fillEllipse(mX + 18, mY - 14, 28, 18);
    g.fillEllipse(mX, mY - 26, 22, 32);
    g.fillStyle(0x52b788, 1);
    g.fillCircle(mX - 12, mY - 14, 4); // leaf fenestration cutout
    g.fillCircle(mX + 12, mY - 14, 4);

    // Tiered Indoor Stone Fountain with Bubbling Water (Right Center)
    const ftX = bounds.right - 64;
    const ftY = bounds.y + winH + 46;
    g.fillStyle(0x8a705a, 0.35);
    g.fillEllipse(ftX, ftY + 20, 52, 20); // shadow
    g.fillStyle(0xb7b7a4, 1);
    g.fillEllipse(ftX, ftY + 14, 38, 16); // base
    g.fillRect(ftX - 5, ftY - 4, 10, 18);
    g.fillStyle(0xddbea9, 1);
    g.fillEllipse(ftX, ftY - 4, 48, 24); // main basin
    g.fillStyle(0x90e0ef, 0.95);
    g.fillEllipse(ftX, ftY - 5, 40, 18); // pool water
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(ftX, ftY - 6, 4); // fountain spout bubble

    // Velvet Sunbeam Daybed Lounge Cushion (Center)
    const cushX = bounds.x + bounds.width * 0.48;
    const cushY = bounds.y + bounds.height * 0.62;
    g.fillStyle(0x8a705a, 0.3);
    g.fillEllipse(cushX, cushY + 8, 96, 46);
    g.fillStyle(0xffb703, 0.95);
    g.fillEllipse(cushX, cushY, 90, 48);
    g.fillStyle(0xfb8500, 0.35);
    g.fillEllipse(cushX, cushY, 72, 34);
    g.fillStyle(0xffe3a8, 1);
    g.fillEllipse(cushX, cushY - 4, 58, 24);

    // Warm Sunbeam God-Rays slicing through the conservatory
    if (this.weather.timeOfDay !== 'night') {
      g.fillStyle(0xfffa80, 0.16);
      g.fillTriangle(bounds.left + 50, bounds.top, bounds.left + 180, bounds.top, bounds.left + 270, bounds.bottom - 30);
      g.fillTriangle(bounds.right - 210, bounds.top, bounds.right - 70, bounds.top, bounds.right - 10, bounds.bottom - 40);
    }

    // Feeding Station
    this.drawBowlsStation(g, bounds, 0xfb8500, 0x00b4d8);
  }

  // =========================================================================
  // 4. BUSTLING CAT CAFÉ (Artisan Coffeehouse Sanctuary)
  // =========================================================================
  private drawCafeBackground(): void {
    const bounds = this.areaBounds();
    const g = this.add.graphics({ x: 0, y: 0 });
    g.name = 'area-bg';
    g.setDepth(-100);

    // Café Outer Frame
    g.fillStyle(0x3e2723, 0.55);
    g.fillRoundedRect(bounds.x - 6, bounds.y - 6, bounds.width + 12, bounds.height + 12, 28);
    g.fillStyle(0x5d4037, 1);
    g.fillRoundedRect(bounds.x - 3, bounds.y - 3, bounds.width + 6, bounds.height + 6, 26);

    // Rich Dark Walnut Chevron / Parquet Flooring
    g.fillStyle(0xd7ba89, 1);
    g.fillRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, 24);

    // Upper Brick Accent Wall
    const wallH = Math.min(88, bounds.height * 0.28);
    g.fillStyle(0x8d5b4c, 1);
    g.fillRoundedRect(bounds.x, bounds.y, bounds.width, wallH, 20);
    g.fillRect(bounds.x, bounds.y + wallH - 14, bounds.width, 14);

    // Brick Pattern
    g.fillStyle(0x6d3d30, 0.85);
    for (let by = bounds.y + 6; by < bounds.y + wallH - 12; by += 14) {
      const offset = (by % 28 === 0) ? 0 : 16;
      for (let bx = bounds.x + 8 + offset; bx < bounds.right - 16; bx += 32) {
        g.fillRect(bx, by, 28, 10);
      }
    }

    // Polished Mahogany Wall Baseboard & Counter Rail
    g.fillStyle(0x4e342e, 1);
    g.fillRect(bounds.x, bounds.y + wallH - 6, bounds.width, 8);
    g.fillStyle(0x8d6e63, 1);
    g.fillRect(bounds.x, bounds.y + wallH - 8, bounds.width, 2);

    // Floor Chevron Plank Lines
    g.lineStyle(1.5, 0xb08968, 0.6);
    for (let y = bounds.y + wallH + 28; y < bounds.bottom - 8; y += 28) {
      g.beginPath();
      g.moveTo(bounds.x + 8, y);
      g.lineTo(bounds.right - 8, y);
      g.strokePath();
    }

    // Artisan Espresso Coffee Bar (Top Center)
    const barX = bounds.x + bounds.width * 0.5;
    const barY = bounds.y + wallH - 14;
    const barW = Math.min(220, bounds.width * 0.65);

    g.fillStyle(0x2d1810, 0.4);
    g.fillRoundedRect(barX - barW / 2 - 2, barY - 26, barW + 4, 46, 12);
    // Counter Body
    g.fillStyle(0x5d4037, 1);
    g.fillRoundedRect(barX - barW / 2, barY - 24, barW, 44, 10);
    // Polished Marble Countertop
    g.fillStyle(0xede0d4, 1);
    g.fillRoundedRect(barX - barW / 2 - 4, barY - 26, barW + 8, 12, 6);

    // Shiny Brass Barista Espresso Machine
    g.fillStyle(0xd4af37, 1);
    g.fillRoundedRect(barX - 44, barY - 48, 38, 24, 4);
    g.fillStyle(0xffe066, 1);
    g.fillRect(barX - 40, barY - 44, 30, 4); // machine chrome top
    // Group heads & portafilter
    g.fillStyle(0x333333, 1);
    g.fillRect(barX - 38, barY - 26, 8, 4);
    g.fillRect(barX - 22, barY - 26, 8, 4);

    // Glass Pastry Dome Case (Right on Counter)
    g.fillStyle(0xe0f7fa, 0.8);
    g.fillCircle(barX + 32, barY - 32, 12);
    g.fillStyle(0xd4a373, 1);
    g.fillCircle(barX + 32, barY - 30, 6); // croissant

    // Coffee Mugs on Counter
    g.fillStyle(0xff758f, 1);
    g.fillRoundedRect(barX - 4, barY - 24, 10, 10, 2);
    g.fillStyle(0x48cae4, 1);
    g.fillRoundedRect(barX + 10, barY - 24, 10, 10, 2);

    // Vintage Framed Chalkboard Menu Sign (Left Wall)
    const menuX = bounds.left + 24;
    const menuY = bounds.top + 16;
    g.fillStyle(0x3e2723, 1);
    g.fillRoundedRect(menuX, menuY, 52, 38, 6); // wood frame
    g.fillStyle(0x263238, 1);
    g.fillRoundedRect(menuX + 4, menuY + 4, 44, 30, 4); // blackboard
    g.fillStyle(0xffffff, 0.85);
    g.fillRect(menuX + 10, menuY + 10, 26, 2); // Latte
    g.fillRect(menuX + 10, menuY + 16, 32, 2); // Cappuccino
    g.fillRect(menuX + 10, menuY + 22, 22, 2); // Meowcha
    g.fillStyle(0xffcad4, 1);
    g.fillCircle(menuX + 38, menuY + 24, 3); // cute chalk paw

    // Hanging Brass Pendant Drop-Lamps casting Warm Light Pools
    const lamp1X = bounds.left + bounds.width * 0.28;
    const lamp2X = bounds.right - bounds.width * 0.28;
    [lamp1X, lamp2X].forEach((lx) => {
      // Cord
      g.lineStyle(1.5, 0x3e2723, 1);
      g.beginPath();
      g.moveTo(lx, bounds.y);
      g.lineTo(lx, bounds.y + 26);
      g.strokePath();

      // Brass shade
      g.fillStyle(0xd4af37, 1);
      g.fillTriangle(lx - 12, bounds.y + 36, lx + 12, bounds.y + 36, lx, bounds.y + 24);
      // Bulb
      g.fillStyle(0xfffae0, 1);
      g.fillCircle(lx, bounds.y + 37, 4);

      // Light pool
      g.fillStyle(0xfffae0, 0.12);
      g.fillEllipse(lx, bounds.y + bounds.height * 0.5, 110, 50);
    });

    // Bistro Round Coffee Table with Rug (Center Bottom)
    const tableX = bounds.x + bounds.width * 0.5;
    const tableY = bounds.y + bounds.height * 0.65;
    g.fillStyle(0x8a705a, 0.35);
    g.fillEllipse(tableX, tableY + 8, 116, 62); // shadow

    // Patterned Tablecloth / Rug Underneath
    g.fillStyle(0xccd5ae, 0.95);
    g.fillEllipse(tableX, tableY, 108, 56);
    g.fillStyle(0xe9edc9, 1);
    g.fillEllipse(tableX, tableY, 92, 44);

    // Polished Wooden Table Surface
    g.fillStyle(0x7f4f24, 1);
    g.fillEllipse(tableX, tableY - 14, 56, 28);
    g.fillStyle(0x936639, 1);
    g.fillEllipse(tableX, tableY - 16, 48, 22);

    // Latte Cup with Latte Art on Table
    g.fillStyle(0xffffff, 1);
    g.fillCircle(tableX, tableY - 18, 7);
    g.fillStyle(0x8d5b4c, 1);
    g.fillCircle(tableX, tableY - 18, 5);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(tableX, tableY - 18, 2); // latte art heart

    // Bowls Station
    this.drawBowlsStation(g, bounds, 0x9c27b0, 0x009688);
  }

  // Common elevated food and water bowl station
  private drawBowlsStation(
    g: Phaser.GameObjects.Graphics,
    bounds: Phaser.Geom.Rectangle,
    foodColor: number,
    waterColor: number,
  ): void {
    const bowlY = bounds.bottom - 34;
    const foodBowlX = bounds.left + 48;
    const waterBowlX = bounds.left + 94;

    // Soft Shadow
    g.fillStyle(0x000000, 0.15);
    g.fillRoundedRect(bounds.left + 22, bowlY - 18, 98, 40, 16);

    // Silicone Paw-Shaped / Woven Mat
    g.fillStyle(0xfdf0d5, 1);
    g.fillRoundedRect(bounds.left + 24, bowlY - 20, 94, 38, 14);
    g.lineStyle(2, 0xe0c3aa, 0.9);
    g.strokeRoundedRect(bounds.left + 24, bowlY - 20, 94, 38, 14);

    // Mat cute paw prints
    g.fillStyle(0xd4a373, 0.7);
    g.fillCircle(bounds.left + 35, bowlY - 6, 3);
    g.fillCircle(bounds.left + 107, bowlY - 6, 3);

    // Food Bowl (Left)
    g.fillStyle(0x666666, 0.35);
    g.fillEllipse(foodBowlX, bowlY + 4, 32, 16); // shadow
    g.fillStyle(foodColor, 1);
    g.fillEllipse(foodBowlX, bowlY, 30, 18); // ceramic outer
    g.fillStyle(0x7f4f24, 1);
    g.fillEllipse(foodBowlX, bowlY - 2, 22, 12); // kibble / tuna
    g.fillStyle(0xba7c59, 1);
    g.fillCircle(foodBowlX - 4, bowlY - 3, 3); // kibble pieces
    g.fillCircle(foodBowlX + 3, bowlY - 2, 2.5);

    // Water Bowl (Right)
    g.fillStyle(0x666666, 0.35);
    g.fillEllipse(waterBowlX, bowlY + 4, 32, 16); // shadow
    g.fillStyle(waterColor, 1);
    g.fillEllipse(waterBowlX, bowlY, 30, 18); // ceramic outer
    g.fillStyle(0x8ecae6, 1);
    g.fillEllipse(waterBowlX, bowlY - 2, 22, 12); // sparkling water
    g.fillStyle(0xffffff, 0.85);
    g.fillEllipse(waterBowlX - 4, bowlY - 4, 10, 4); // water shine
  }

  // =========================================================================
  // Enhanced Illustrated Placed Furniture
  // =========================================================================
  private drawPlacedFurniture(): void {
    const bounds = this.areaBounds();
    const ownedFurniture = FURNITURE_CATALOG.filter(
      (f) => f.area === this.currentArea && this.state.furniture.includes(f.id),
    );

    for (const item of ownedFurniture) {
      const fx = bounds.left + bounds.width * item.xPercent;
      const fy = bounds.top + bounds.height * item.yPercent;

      const fGfx = this.add.graphics();
      fGfx.name = 'area-bg';
      fGfx.setDepth(fy - 5);

      // Custom Illustrated Graphics per Furniture Item
      switch (item.id) {
        case 'plush_donut_bed': {
          // Shadow
          fGfx.fillStyle(0x000000, 0.2);
          fGfx.fillEllipse(fx, fy + 12, 64, 28);
          // Donut Ring
          fGfx.fillStyle(0xff758f, 1);
          fGfx.fillEllipse(fx, fy, 58, 36);
          fGfx.fillStyle(0xffb3c1, 1);
          fGfx.fillEllipse(fx, fy - 2, 48, 28);
          fGfx.fillStyle(0xffe5ec, 1);
          fGfx.fillEllipse(fx, fy - 4, 34, 20);
          break;
        }
        case 'sisal_cat_tree': {
          // Shadow
          fGfx.fillStyle(0x000000, 0.22);
          fGfx.fillEllipse(fx, fy + 24, 60, 24);
          // Base
          fGfx.fillStyle(0x8a6240, 1);
          fGfx.fillEllipse(fx, fy + 20, 52, 20);
          // Sisal Scratching Post Pillar
          fGfx.fillStyle(0xd4a373, 1);
          fGfx.fillRect(fx - 8, fy - 36, 16, 56);
          // Sisal rope stripes
          fGfx.fillStyle(0xbc6c25, 0.7);
          for (let sy = fy - 32; sy < fy + 16; sy += 8) {
            fGfx.fillRect(fx - 8, sy, 16, 2);
          }
          // Top Plush Perch Platform
          fGfx.fillStyle(0xffccd5, 1);
          fGfx.fillEllipse(fx, fy - 38, 48, 20);
          fGfx.fillStyle(0xffb3c1, 1);
          fGfx.fillEllipse(fx, fy - 40, 40, 14);
          // Hanging pom-pom toy
          fGfx.lineStyle(1.5, 0x666666, 0.8);
          fGfx.beginPath();
          fGfx.moveTo(fx + 16, fy - 36);
          fGfx.lineTo(fx + 16, fy - 18);
          fGfx.strokePath();
          fGfx.fillStyle(0xff4d6d, 1);
          fGfx.fillCircle(fx + 16, fy - 16, 5);
          break;
        }
        case 'sunbeam_mat': {
          // Golden Velvet Sunbeam Mat
          fGfx.fillStyle(0x000000, 0.18);
          fGfx.fillEllipse(fx, fy + 10, 72, 34);
          fGfx.fillStyle(0xffb703, 0.95);
          fGfx.fillEllipse(fx, fy, 68, 38);
          fGfx.fillStyle(0xfb8500, 0.4);
          fGfx.fillEllipse(fx, fy, 54, 28);
          fGfx.fillStyle(0xfff3b0, 1);
          fGfx.fillEllipse(fx, fy - 3, 44, 20);
          break;
        }
        case 'cardboard_castle': {
          // Mischievous Cardboard Castle Box
          fGfx.fillStyle(0x000000, 0.2);
          fGfx.fillEllipse(fx, fy + 18, 64, 26);
          // Box Body
          fGfx.fillStyle(0xcb997e, 1);
          fGfx.fillRoundedRect(fx - 28, fy - 24, 56, 42, 6);
          // Turret battlements
          fGfx.fillRect(fx - 28, fy - 32, 14, 10);
          fGfx.fillRect(fx + 14, fy - 32, 14, 10);
          // Doorway
          fGfx.fillStyle(0x6b4f3b, 1);
          fGfx.fillRoundedRect(fx - 12, fy - 6, 24, 24, 10);
          break;
        }
        case 'fountain_dish': {
          // Ceramic Flower Water Fountain
          fGfx.fillStyle(0x000000, 0.2);
          fGfx.fillEllipse(fx, fy + 16, 56, 24);
          // Basin
          fGfx.fillStyle(0xa2d2ff, 1);
          fGfx.fillEllipse(fx, fy + 8, 48, 24);
          fGfx.fillStyle(0x48cae4, 1);
          fGfx.fillEllipse(fx, fy + 6, 40, 18);
          // Center Flower Spout
          fGfx.fillStyle(0xffffff, 1);
          fGfx.fillCircle(fx, fy - 2, 8);
          fGfx.fillStyle(0xffd166, 1);
          fGfx.fillCircle(fx, fy - 2, 4);
          break;
        }
        default: {
          const fText = this.add.text(fx, fy, item.bonusText || '✨', {
            fontSize: '12px',
          }).setOrigin(0.5, 0.7).setDepth(fy);
          fText.name = 'area-bg';
        }
      }
    }

    // Draw Installed Automation Machines
    const installedMachines = this.automation.getMachinesInArea(this.currentArea);
    for (const { def, level } of installedMachines) {
      const mx = bounds.left + def.xPercent * bounds.width;
      const my = bounds.top + def.yPercent * bounds.height;

      const mGfx = this.add.graphics();
      mGfx.name = 'area-bg';
      mGfx.setDepth(my - 5);

      // Soft Shadow
      mGfx.fillStyle(0x000000, 0.22);
      mGfx.fillEllipse(mx, my + 14, 48, 18);

      switch (def.needType) {
        case 'food': {
          // Smart Feeder Station: Hopper + Bowl + LED
          mGfx.fillStyle(0xd5bdaf, 1);
          mGfx.fillRoundedRect(mx - 18, my - 28, 36, 32, 6);
          mGfx.fillStyle(0xb7b7a4, 1);
          mGfx.fillRoundedRect(mx - 15, my - 25, 30, 16, 4);
          // Kibble Bowl
          mGfx.fillStyle(0xe63946, 1);
          mGfx.fillEllipse(mx, my + 4, 30, 14);
          mGfx.fillStyle(0x6b4f2c, 1);
          mGfx.fillEllipse(mx, my + 2, 24, 10);
          // Power LED
          mGfx.fillStyle(level === 3 ? 0xc77dff : level === 2 ? 0x06d6a0 : 0x48cae4, 1);
          mGfx.fillCircle(mx + 10, my - 20, 3);
          break;
        }
        case 'pet': {
          // Rotating Cuddle Pad Station
          mGfx.fillStyle(0xffcbf2, 1);
          mGfx.fillEllipse(mx, my + 2, 42, 24);
          mGfx.fillStyle(0xf72585, 0.6);
          mGfx.fillEllipse(mx, my, 32, 18);
          // Soft robotic arch
          mGfx.lineStyle(3, 0xff758f, 0.9);
          mGfx.beginPath();
          mGfx.arc(mx, my - 8, 16, Math.PI, 0);
          mGfx.strokePath();
          break;
        }
        case 'brush': {
          // Self-Grooming Arch
          mGfx.fillStyle(0x52b788, 1);
          mGfx.fillRect(mx - 18, my - 20, 8, 26);
          mGfx.fillRect(mx + 10, my - 20, 8, 26);
          mGfx.fillStyle(0x40916c, 1);
          mGfx.fillRoundedRect(mx - 18, my - 28, 36, 12, 4);
          // Bristles
          mGfx.lineStyle(1.5, 0xd8f3dc, 0.8);
          for (let i = -14; i <= 14; i += 4) {
            mGfx.beginPath();
            mGfx.moveTo(mx + i, my - 16);
            mGfx.lineTo(mx + i, my - 8);
            mGfx.strokePath();
          }
          break;
        }
        case 'toy': {
          // Laser & Feather Toy Tower
          mGfx.fillStyle(0x7209b7, 1);
          mGfx.fillRoundedRect(mx - 8, my - 34, 16, 38, 4);
          // Glowing top orb
          mGfx.fillStyle(0xf72585, 1);
          mGfx.fillCircle(mx, my - 36, 7);
          // Laser beam to floor
          mGfx.lineStyle(1, 0xff0054, 0.6);
          mGfx.beginPath();
          mGfx.moveTo(mx, my - 36);
          mGfx.lineTo(mx + 18, my + 6);
          mGfx.strokePath();
          mGfx.fillStyle(0xff0054, 0.9);
          mGfx.fillCircle(mx + 18, my + 6, 3);
          break;
        }
        case 'wash': {
          // Ultrasonic Bubble Mist Basin
          mGfx.fillStyle(0x48cae4, 1);
          mGfx.fillEllipse(mx, my + 4, 46, 22);
          mGfx.fillStyle(0x90e0ef, 1);
          mGfx.fillEllipse(mx, my + 2, 38, 16);
          // Bubbles
          mGfx.fillStyle(0xffffff, 0.8);
          mGfx.fillCircle(mx - 8, my - 4, 4);
          mGfx.fillCircle(mx + 6, my - 8, 3);
          mGfx.fillCircle(mx + 12, my - 2, 5);
          break;
        }
      }

      // Tier Level Badge
      const tierBadge = this.add.text(mx, my + 16, `T${level}`, {
        fontFamily: '"Nunito", sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: level === 3 ? '#ffe66d' : '#ffffff',
        backgroundColor: 'rgba(26, 18, 40, 0.8)',
        padding: { left: 4, right: 4, top: 1, bottom: 1 },
      }).setOrigin(0.5, 0).setDepth(my + 10);
      tierBadge.name = 'area-bg';
    }
  }


  private spawnCatsInCurrentArea(): void {
    for (const sprite of this.catSprites.values()) {
      sprite.destroy();
    }
    this.catSprites.clear();

    const bounds = this.areaBounds();
    const areaCats = this.state.cats.filter((c) => c.area === this.currentArea);

    for (const cat of areaCats) {
      this.spawnCatSprite(cat, bounds);
    }
  }

  private spawnCatSprite(cat: Cat, bounds: Phaser.Geom.Rectangle): void {
    const x = Phaser.Math.Between(bounds.left + 30, bounds.right - 30);
    const y = Phaser.Math.Between(bounds.top + 30, bounds.bottom - 30);
    const sprite = new CatSprite(this, cat, x, y, bounds);
    sprite.setSelectedTool(this.selectedTool);

    // Provide machines in current area to cat AI
    const machines = this.automation.getMachinesInArea(this.currentArea).map((m) => ({
      id: m.def.id,
      needType: m.def.needType,
      x: bounds.left + m.def.xPercent * bounds.width,
      y: bounds.top + m.def.yPercent * bounds.height,
    }));
    sprite.setAvailableMachines(machines);
    sprite.setOtherSpritesProvider(() => Array.from(this.catSprites.values()));
    sprite.setMachineUseCallback((c, machineId) => {
      const res = this.automation.useMachine(c, machineId);
      if (res) {
        sound.playSparkle();
        EventBus.emit('toast', { message: res.message });
        EventBus.emit('love-changed', { love: this.love.love });
        this.saveManager.save(this.state);
        this.notifyUiState();
      }
    });

    sprite.on('cat-pointerdown', (ptr: Phaser.Input.Pointer) => {
      this.onCatPointerDown(cat, sprite, ptr);
    });

    this.catSprites.set(cat.id, sprite);
  }


  private spawnKibblePiece(targetX: number, targetY: number, fromX?: number, fromY?: number): void {
    const startX = fromX ?? (this.kibbleBag ? this.kibbleBag.x : targetX);
    const startY = fromY ?? (this.kibbleBag ? this.kibbleBag.y - 14 : targetY - 10);

    if (this.kibblePieces.length >= 30) {
      const oldest = this.kibblePieces.shift();
      oldest?.despawn();
    }

    const piece = new KibblePiece(this, startX, startY, targetX, targetY);
    this.kibblePieces.push(piece);
  }

  private bindUiEvents(): void {
    EventBus.on('tool-selected', ({ tool }: { tool: string | null }) => {
      this.selectedTool = tool as ToolType | null;
      if (this.selectedTool) sound.playTap();

      for (const sprite of this.catSprites.values()) {
        sprite.setSelectedTool(this.selectedTool);
      }

      if (this.selectedTool === 'food') {
        if (!this.kibbleBag) {
          const bounds = this.areaBounds();
          this.kibbleBag = new KibbleBag(this, bounds.centerX, bounds.centerY, bounds);
          this.kibbleBag.onDropFood = (x, y) => this.spawnKibblePiece(x, y);
          this.kibbleBag.setScale(0);
          this.tweens.add({
            targets: this.kibbleBag,
            scaleX: 1,
            scaleY: 1,
            duration: 250,
            ease: 'Back.easeOut',
          });
          sound.playPop();
          EventBus.emit('toast', { message: '🥣 Kibble Bag ready! Drag it around to drop food for hungry cats!' });
        }
      } else {
        if (this.kibbleBag) {
          this.tweens.add({
            targets: this.kibbleBag,
            scaleX: 0,
            scaleY: 0,
            alpha: 0,
            duration: 150,
            ease: 'Quad.easeIn',
            onComplete: () => {
              this.kibbleBag?.destroy();
              this.kibbleBag = null;
            },
          });
        }
      }

      if (this.selectedTool === 'toy') {
        if (!this.toyBall) {
          const bounds = this.areaBounds();
          this.toyBall = new ToyBall(this, bounds.centerX, bounds.centerY, bounds);
          this.toyBall.setScale(0);
          this.tweens.add({
            targets: this.toyBall,
            scaleX: 1,
            scaleY: 1,
            duration: 250,
            ease: 'Back.easeOut',
          });
          sound.playPop();
          EventBus.emit('toast', { message: '🧶 Threw a Toy Ball! Drag and toss it around for cats to chase!' });
        }
      } else {
        if (this.toyBall) {
          this.tweens.add({
            targets: this.toyBall,
            scaleX: 0,
            scaleY: 0,
            alpha: 0,
            duration: 150,
            ease: 'Quad.easeIn',
            onComplete: () => {
              this.toyBall?.destroy();
              this.toyBall = null;
            },
          });
          for (const sprite of this.catSprites.values()) {
            sprite.clearChaseTarget();
          }
        }
      }

      if (this.selectedTool === 'wash') {
        if (!this.washBrushFollower) {
          const container = this.add.container(400, 300);
          container.setDepth(99999);

          const gfx = this.add.graphics();
          // Wooden Brush Handle
          gfx.fillStyle(0xd4a373, 1);
          gfx.fillRoundedRect(-6, -28, 12, 22, 4);
          gfx.fillStyle(0xbc6c25, 1);
          gfx.fillCircle(0, -22, 3);

          // Brush Head (Sponge / Foam)
          gfx.fillStyle(0x48cae4, 0.95);
          gfx.fillRoundedRect(-16, -6, 32, 20, 7);
          gfx.fillStyle(0x90e0ef, 1);
          gfx.fillRoundedRect(-14, -4, 28, 16, 5);

          // Soft Suds / Bristles
          gfx.fillStyle(0xffffff, 0.95);
          gfx.fillCircle(-10, 14, 5);
          gfx.fillCircle(-4, 15, 6);
          gfx.fillCircle(4, 15, 6);
          gfx.fillCircle(10, 14, 5);

          // Cute floating bubbles
          gfx.fillStyle(0x72efdd, 0.85);
          gfx.fillCircle(12, -8, 4);
          gfx.fillStyle(0xffffff, 0.95);
          gfx.fillCircle(11, -9, 1.5);

          container.add(gfx);
          container.setScale(1.25);
          this.washBrushFollower = container;

          EventBus.emit('toast', { message: '🫧 Wash brush active! Drag it over cats to scrub and clean them!' });
        }
      } else {
        if (this.washBrushFollower) {
          this.washBrushFollower.destroy();
          this.washBrushFollower = null;
        }
      }
    });

    EventBus.on('adopt-requested', () => this.tryAdopt());

    EventBus.on('switch-area', ({ area }: { area: CatArea }) => {
      this.switchArea(area);
    });

    EventBus.on('unlock-area', ({ area }: { area: CatArea }) => {
      this.tryUnlockArea(area);
    });

    EventBus.on('upgrade-capacity', ({ area }: { area: CatArea }) => {
      this.tryUpgradeCapacity(area);
    });

    EventBus.on('move-cat', ({ catId, toArea }: { catId: string; toArea: CatArea }) => {
      this.moveCat(catId, toArea);
    });

    EventBus.on('buy-furniture', ({ furnitureId }: { furnitureId: string }) => {
      this.tryBuyFurniture(furnitureId);
    });

    EventBus.on('buy-machine', ({ machineId }: { machineId: string }) => {
      if (this.automation.buyMachine(machineId)) {
        this.saveManager.save(this.state);
        this.drawCurrentArea();
        this.spawnCatsInCurrentArea();
        this.notifyUiState();
      }
    });

    EventBus.on('upgrade-machine', ({ machineId }: { machineId: string }) => {
      if (this.automation.upgradeMachine(machineId)) {
        this.saveManager.save(this.state);
        this.drawCurrentArea();
        this.spawnCatsInCurrentArea();
        this.notifyUiState();
      }
    });

    EventBus.on('rehome-cat', ({ catId }: { catId: string }) => {
      const catIndex = this.state.cats.findIndex((c) => c.id === catId);
      if (catIndex === -1) return;
      const cat = this.state.cats[catIndex];

      const reward = calculateRehomeLove(cat);
      this.love.add(reward.total);
      this.state.totalLoveEarned += reward.total;
      this.state.totalRehomedCats = (this.state.totalRehomedCats || 0) + 1;
      this.state.totalRehomeLoveEarned = (this.state.totalRehomeLoveEarned || 0) + reward.total;

      this.state.cats.splice(catIndex, 1);
      const sprite = this.catSprites.get(catId);
      if (sprite) {
        sprite.destroy();
        this.catSprites.delete(catId);
      }

      sound.playAdoptFanfare();
      EventBus.emit('toast', {
        message: `🏡 ${cat.name} found a loving forever home! (+${reward.total.toLocaleString()} 💗 Love)`,
      });

      // If ALL cats are gone: immediately take half love and give two new adults
      if (this.state.cats.length === 0) {
        const penalty = Math.floor(this.state.love / 2);
        this.state.love = Math.max(0, this.state.love - penalty);

        const bounds = this.areaBounds();
        const usedNames = new Set(this.state.cats.map((c) => c.name));

        for (let i = 0; i < 2; i++) {
          const newCat = generateCat({ day: this.state.day, usedNames, stage: 'adult' });
          newCat.area = 'yard';
          newCat.journal.entries.push({
            day: this.state.day,
            timestamp: Date.now(),
            message: 'Arrived at the empty sanctuary, drawn by a warm familiar scent.',
          });
          this.state.cats.push(newCat);
          usedNames.add(newCat.name);
          if (this.currentArea === 'yard') {
            this.spawnCatSprite(newCat, bounds);
          }
          sound.playPop();
          setTimeout(() => sound.playKittenMeow(false), 400 + i * 300);
        }

        EventBus.emit('love-changed', { love: this.love.love });
        EventBus.emit('toast', {
          message: `🏠 The sanctuary is empty… two cats wandered in, but it cost you ${penalty.toLocaleString()} 💗 love.`,
        });
      } else if (this.state.cats.length < 2 && !this.state.strayArrivalDueAt) {
        // < 2 cats: stray arrives after 1 hour
        this.state.strayArrivalDueAt = Date.now() + 60 * 60 * 1000;
      }

      this.saveManager.save(this.state);
      this.notifyUiState();
    });


    EventBus.on('breed-cats', ({ parentAId, parentBId }: { parentAId: string; parentBId: string }) => {
      const parentA = this.state.cats.find((c) => c.id === parentAId);
      const parentB = this.state.cats.find((c) => c.id === parentBId);
      if (!parentA || !parentB) return;

      const result = this.breeding.breed(parentA, parentB);
      if (result) {
        this.saveManager.save(this.state);
        this.notifyUiState();
      }
    });

    EventBus.on('cat-acquired-from-plinko', ({ cat }: { cat: Cat }) => {
      if (!this.state.cats.some((c) => c.id === cat.id)) {
        this.state.cats.push(cat);
      }
      if (cat.area === this.currentArea) {
        this.spawnCatSprite(cat, this.areaBounds());
      }
      this.saveManager.save(this.state);
      this.notifyUiState();
    });

    EventBus.on('spend-tokens', ({ amount }: { amount: number }) => {
      this.state.adoptionTokens = Math.max(0, (this.state.adoptionTokens || 0) - amount);
      this.saveManager.save(this.state);
      this.notifyUiState();
    });

    EventBus.on('tokens-changed', ({ tokens }: { tokens: number }) => {
      if (this.state.adoptionTokens !== tokens) {
        this.state.adoptionTokens = tokens;
        this.saveManager.save(this.state);
      }
    });

    EventBus.on('upgrade-offline-stars', () => {
      const currentLevel = this.state.offlineStarLevel || 1;
      if (currentLevel >= 5) return;
      const nextUpgrade = OFFLINE_STAR_UPGRADES[currentLevel];
      if (!nextUpgrade) return;

      if (this.love.spend(nextUpgrade.costCarePoints)) {
        this.state.offlineStarLevel = currentLevel + 1;
        sound.playAdoptFanfare();
        EventBus.emit('toast', { message: `⭐ Upgraded offline rate to ${this.state.offlineStarLevel} Stars/hr!` });
        this.saveManager.save(this.state);
        this.notifyUiState();
      } else {
        EventBus.emit('toast', { message: `Need ${nextUpgrade.costCarePoints.toLocaleString()} Care Points for this upgrade.` });
      }
    });

    EventBus.on('instant-grow-cat', ({ catId, cost }: { catId: string; cost: number }) => {
      const cat = this.state.cats.find((c) => c.id === catId);
      if (!cat || cat.stage === 'adult') return;
      if (this.love.spend(cost)) {
        if (cat.stage === 'kitten') {
          cat.stage = 'teen';
          cat.growthProgress = 0;
          cat.journal.entries.push({
            day: this.state.day,
            timestamp: Date.now(),
            message: 'Grew into an active, playful Teen cat with a burst of Care Points!',
          });
        } else if (cat.stage === 'teen') {
          cat.stage = 'adult';
          cat.growthProgress = 100;
          cat.journal.entries.push({
            day: this.state.day,
            timestamp: Date.now(),
            message: 'Fully matured into a majestic Adult cat!',
          });
        }
        sound.playAdoptFanfare();
        const sprite = this.catSprites.get(cat.id);
        if (sprite) {
          sprite.refreshVisuals();
          sprite.showEmote('✨');
        }
        EventBus.emit('toast', { message: `✨ ${cat.name} grew to ${cat.stage === 'teen' ? 'Teen' : 'Adult'} stage!` });
        this.saveManager.save(this.state);
        this.notifyUiState();
      } else {
        EventBus.emit('toast', { message: `Need ${cost.toLocaleString()} Care Points to grow ${cat.name}.` });
      }
    });

    EventBus.on('claim-milestone', ({ milestoneId }: { milestoneId: string }) => {
      this.milestones.claim(milestoneId);
      this.saveManager.save(this.state);
      this.notifyUiState();
    });

    EventBus.on('summon-rare-cat', ({ rareType }: { rareType: RareCatType }) => {
      this.trySummonRareCat(rareType);
    });

    EventBus.on('toggle-time', () => {
      this.weather.cycleTime();
      this.saveManager.save(this.state);
      this.notifyUiState();
    });

    EventBus.on('toggle-weather', () => {
      this.weather.cycleWeather();
      this.resetWeatherParticles();
      this.saveManager.save(this.state);
      this.notifyUiState();
    });

    EventBus.on('export-cat-card', async ({ catId }: { catId: string }) => {
      const cat = this.state.cats.find((c) => c.id === catId);
      if (cat) {
        await exportCatCardAsPng(cat);
        EventBus.emit('toast', { message: `📸 Saved ${cat.name}'s Adoption Card to your device!` });
      }
    });

    EventBus.on('direct-care-cat', ({ catId, tool }: { catId: string; tool: ToolType }) => {
      const cat = this.state.cats.find((c) => c.id === catId);
      if (cat) {
        const sprite = this.catSprites.get(catId);
        if (sprite) {
          this.interactWithCat(cat, sprite, tool);
        } else {
          // Cat in another area
          const result = this.interactions.applyTool(cat, tool);
          this.state.totalLoveEarned += result.loveEarned;
          if (tool === 'pet' && result.loveEarned > 0) this.state.totalPetsGiven++;
          if (result.loveEarned > 0) this.growth.addGrowth(cat, 10);
          const toastMsg = result.loveEarned > 0
            ? `${result.message} (+${result.loveEarned} 💗)`
            : result.message;
          EventBus.emit('toast', { message: toastMsg });
          EventBus.emit('love-changed', { love: this.love.love });
          this.notifyUiState();
        }
      }
    });
  }


  private switchArea(area: CatArea): void {
    if (!this.state.areas[area]?.unlocked) return;
    this.currentArea = area;
    sound.playTap();

    if (this.toyBall) {
      const bounds = this.areaBounds();
      this.toyBall.setBounds(bounds);
      this.toyBall.setPosition(bounds.centerX, bounds.centerY);
      this.toyBall.vx = 0;
      this.toyBall.vy = 0;
    }

    if (this.kibbleBag) {
      const bounds = this.areaBounds();
      this.kibbleBag.setBounds(bounds);
      this.kibbleBag.setPosition(bounds.centerX, bounds.centerY);
    }
    for (const piece of this.kibblePieces) {
      piece.destroy();
    }
    this.kibblePieces = [];

    this.drawCurrentArea();
    this.spawnCatsInCurrentArea();
    this.notifyUiState();
  }

  private tryUnlockArea(area: CatArea): void {
    const areaState = this.state.areas[area];
    const info = AREA_INFO_MAP[area];
    if (areaState.unlocked) return;

    if (this.state.cats.length < info.unlockThresholdCats) {
      EventBus.emit('toast', {
        message: `Need at least ${info.unlockThresholdCats} cats in sanctuary to unlock ${info.label}.`,
      });
      return;
    }

    if (!this.love.spend(info.unlockCostLove)) {
      EventBus.emit('toast', {
        message: `Not enough Love! Unlocking ${info.label} costs ${info.unlockCostLove} 💗.`,
      });
      return;
    }

    areaState.unlocked = true;
    sound.playAdoptFanfare();
    EventBus.emit('toast', { message: `🎉 Unlocked ${info.emoji} ${info.label}!` });
    this.saveManager.save(this.state);
    this.notifyUiState();
    this.switchArea(area);
  }

  private tryUpgradeCapacity(area: CatArea): void {
    const areaState = this.state.areas[area];
    const info = AREA_INFO_MAP[area];
    const cost = info.capacityUpgradeCost;

    if (!this.love.spend(cost)) {
      EventBus.emit('toast', { message: `Need ${cost} 💗 to upgrade ${info.label} capacity.` });
      return;
    }

    areaState.capacity += 5;
    sound.playSparkle();
    EventBus.emit('toast', {
      message: `🏡 Expanded ${info.label} capacity to ${areaState.capacity} cats!`,
    });
    this.saveManager.save(this.state);
    this.notifyUiState();
  }

  private tryBuyFurniture(furnitureId: string): void {
    const item = FURNITURE_CATALOG.find((f) => f.id === furnitureId);
    if (!item) return;

    if (this.state.furniture.includes(furnitureId)) {
      EventBus.emit('toast', { message: `You already placed ${item.name} in the sanctuary!` });
      return;
    }

    if (!this.love.spend(item.loveCost)) {
      EventBus.emit('toast', { message: `Need ${item.loveCost} 💗 to purchase ${item.name}.` });
      return;
    }

    this.state.furniture.push(furnitureId);
    sound.playAdoptFanfare();
    EventBus.emit('toast', { message: `✨ Placed ${item.name} in the sanctuary!` });
    this.saveManager.save(this.state);

    this.notifyUiState();
    this.drawCurrentArea();
  }

  private trySummonRareCat(rareType: RareCatType): void {
    const summonDef = RARE_SUMMONS.find((s) => s.id === rareType);
    if (!summonDef) return;

    if (this.milestones.tokens < summonDef.tokenCost) {
      EventBus.emit('toast', {
        message: `Need ${summonDef.tokenCost} Adoption Tokens ⭐ to summon ${summonDef.name}.`,
      });
      return;
    }

    // Check area capacity
    let targetArea: CatArea = this.currentArea;
    const currentCount = this.state.cats.filter((c) => c.area === targetArea).length;
    if (currentCount >= this.state.areas[targetArea].capacity) {
      const openArea = (Object.keys(this.state.areas) as CatArea[]).find((aKey) => {
        const a = this.state.areas[aKey];
        const count = this.state.cats.filter((c) => c.area === aKey).length;
        return a.unlocked && count < a.capacity;
      });

      if (!openArea) {
        EventBus.emit('toast', { message: 'No room in sanctuary! Expand or unlock an area first.' });
        return;
      }
      targetArea = openArea;
    }

    this.milestones.spendTokens(summonDef.tokenCost);

    const usedNames = new Set(this.state.cats.map((c) => c.name));
    const cat = generateRareCat(rareType, { day: this.state.day, usedNames });
    cat.area = targetArea;
    this.state.cats.push(cat);

    if (targetArea === this.currentArea) {
      this.spawnCatSprite(cat, this.areaBounds());
    }

    sound.playAdoptFanfare();
    EventBus.emit('toast', {
      message: `🌟 SUMMONED ${cat.name} (${summonDef.title})!`,
    });

    this.saveManager.save(this.state);
    this.notifyUiState();
  }

  private moveCat(catId: string, toArea: CatArea): void {
    const cat = this.state.cats.find((c) => c.id === catId);
    if (!cat) return;

    const targetAreaState = this.state.areas[toArea];
    if (!targetAreaState?.unlocked) {
      EventBus.emit('toast', { message: 'Area is locked!' });
      return;
    }

    const currentInTarget = this.state.cats.filter((c) => c.area === toArea).length;
    if (currentInTarget >= targetAreaState.capacity) {
      EventBus.emit('toast', { message: `${AREA_INFO_MAP[toArea].label} is at max capacity!` });
      return;
    }

    const prevArea = cat.area;
    cat.area = toArea;
    this.journal.log(cat, `Moved from ${AREA_INFO_MAP[prevArea].label} to ${AREA_INFO_MAP[toArea].label}.`);
    sound.playTap();

    if (prevArea === this.currentArea || toArea === this.currentArea) {
      this.spawnCatsInCurrentArea();
    }

    this.notifyUiState();
  }

  private onCatPointerDown(cat: Cat, sprite: CatSprite, pointer: Phaser.Input.Pointer): void {
    if (this.selectedTool) {
      this.interactWithCat(cat, sprite, this.selectedTool);
      return;
    }

    this.dragCandidate = {
      cat,
      sprite,
      startX: pointer.worldX,
      startY: pointer.worldY,
      offsetX: pointer.worldX - sprite.x,
      offsetY: pointer.worldY - sprite.y,
      startTime: this.time.now,
    };
    this.isDraggingCat = false;
    this.currentDropTarget = null;
  }

  private onScenePointerMove(pointer: Phaser.Input.Pointer): void {
    // ── Wash Brush Follower Position Update ──────────────────────────────
    if (this.washBrushFollower) {
      this.washBrushFollower.setPosition(pointer.worldX, pointer.worldY);
      if (pointer.isDown || Math.hypot(pointer.velocity.x, pointer.velocity.y) > 15) {
        this.washBrushFollower.rotation = Math.sin(this.animTimer * 16) * 0.22;
      } else {
        this.washBrushFollower.rotation = 0;
      }
    }

    // ── Wash Tool Active Drag / Scrubbing ────────────────────────────────
    if (this.selectedTool === 'wash') {
      const px = pointer.worldX;
      const py = pointer.worldY;
      const now = this.time.now;
      const dt = Math.max(0.016, (this.game.loop.delta || 16) / 1000);

      for (const sprite of this.catSprites.values()) {
        if (sprite.isCurrentlyDragged()) continue;
        const dist = Phaser.Math.Distance.Between(px, py, sprite.x, sprite.y);
        if (dist < 65) {
          this.spawnSoapBubbles(px, py);

          const wasDirty = sprite.cat.cleanliness < 98;
          sprite.cat.cleanliness = Math.min(100, sprite.cat.cleanliness + 2.5);
          sprite.cat.happiness = Math.min(100, sprite.cat.happiness + 0.35);

          if (wasDirty && (!this.lastWashLoveTime || now - this.lastWashLoveTime > 300)) {
            this.lastWashLoveTime = now;
            this.love.add(3);
            this.state.totalLoveEarned += 3;
            this.growth.addGrowth(sprite.cat, 2);
            EventBus.emit('love-changed', { love: this.love.love });
            sound.playBubble();
            sprite.showEmote('🫧');
          }

          // Cat slowly walks away from the brush
          sprite.slinkAwayFrom(px, py, dt);
          sprite.refreshVisuals();
          this.notifyUiState();
        }
      }
    }

    if (!this.dragCandidate) return;

    const dx = pointer.worldX - this.dragCandidate.startX;
    const dy = pointer.worldY - this.dragCandidate.startY;
    const dist = Math.hypot(dx, dy);

    if (!this.isDraggingCat && dist > 6) {
      this.isDraggingCat = true;
      this.dragCandidate.sprite.setDragged(true);
      sound.playTap();

      // If dragging an adult cat, visually highlight all ready adult partners & show readiness bars
      if (this.dragCandidate.cat.stage === 'adult') {
        this.showBreedingPartnersFor(this.dragCandidate.cat);
      }
    }

    if (this.isDraggingCat) {
      const bounds = this.areaBounds();
      const newX = Phaser.Math.Clamp(pointer.worldX - this.dragCandidate.offsetX, bounds.left + 20, bounds.right - 20);
      const newY = Phaser.Math.Clamp(pointer.worldY - this.dragCandidate.offsetY, bounds.top + 20, bounds.bottom - 20);
      this.dragCandidate.sprite.setPosition(newX, newY);

      let closestTarget: CatSprite | null = null;
      let closestDist = 65;

      for (const otherSprite of this.catSprites.values()) {
        if (otherSprite.cat.id === this.dragCandidate.cat.id) continue;
        const d = Phaser.Math.Distance.Between(newX, newY, otherSprite.x, otherSprite.y);
        if (d < closestDist) {
          closestDist = d;
          closestTarget = otherSprite;
        }
      }

      if (this.currentDropTarget && this.currentDropTarget !== closestTarget) {
        this.currentDropTarget.highlightAsDropTarget(false);
      }
      this.currentDropTarget = closestTarget;
      if (this.currentDropTarget) {
        this.currentDropTarget.highlightAsDropTarget(true);
      }
    }
  }

  private spawnSoapBubbles(x: number, y: number): void {
    if (this.lastBubbleSpawnTime && this.time.now - this.lastBubbleSpawnTime < 50) return;
    this.lastBubbleSpawnTime = this.time.now;

    for (let i = 0; i < 2; i++) {
      const bubble = this.add.graphics();
      const r = Phaser.Math.Between(4, 10);
      const offsetX = Phaser.Math.Between(-14, 14);
      const offsetY = Phaser.Math.Between(-12, 12);

      bubble.setPosition(x + offsetX, y + offsetY);
      bubble.setDepth(y + 120);

      // Iridescent bubble: translucent cyan/pink ring + glossy highlight
      bubble.fillStyle(0x70d6ff, 0.45);
      bubble.fillCircle(0, 0, r);
      bubble.lineStyle(1.5, 0xff99c8, 0.75);
      bubble.strokeCircle(0, 0, r);
      bubble.fillStyle(0xffffff, 0.85);
      bubble.fillCircle(-r * 0.35, -r * 0.35, r * 0.28);

      this.tweens.add({
        targets: bubble,
        y: bubble.y - Phaser.Math.Between(25, 50),
        x: bubble.x + Phaser.Math.Between(-12, 12),
        alpha: { from: 0.9, to: 0 },
        scaleX: { from: 0.7, to: 1.25 },
        scaleY: { from: 0.7, to: 1.25 },
        duration: Phaser.Math.Between(400, 650),
        ease: 'Cubic.easeOut',
        onComplete: () => bubble.destroy(),
      });
    }
  }

  private onScenePointerUp(_pointer: Phaser.Input.Pointer): void {
    if (!this.dragCandidate) return;


    const { cat, sprite } = this.dragCandidate;
    const target = this.currentDropTarget;

    if (target) {
      target.highlightAsDropTarget(false);
    }

    // Always clear temporary breeding partner highlights and readiness bars
    this.clearAllBreedingPartners();

    if (this.isDraggingCat) {
      sprite.setDragged(false);

      if (target) {
        this.handleCatPairDrop(sprite, target);
      } else {
        this.tweens.add({
          targets: sprite,
          y: sprite.y + 4,
          duration: 120,
          yoyo: true,
          ease: 'Quad.easeOut',
        });
      }
    } else {
      // Tap / click with no tool: cute meow & emote, does NOT open info modal
      const pitchOffset = cat.stage === 'kitten' ? 5 : cat.stage === 'teen' ? 2 : Phaser.Math.Between(-2, 2);
      sound.playMeow(pitchOffset);
      sprite.showEmote(cat.stage === 'kitten' ? '🐾' : '❤️');
    }

    this.dragCandidate = null;
    this.isDraggingCat = false;
    this.currentDropTarget = null;
  }

  private handleCatPairDrop(spriteA: CatSprite, spriteB: CatSprite): void {
    const catA = spriteA.cat;
    const catB = spriteB.cat;
    const midX = (spriteA.x + spriteB.x) / 2;
    const midY = (spriteA.y + spriteB.y) / 2;

    // 1. Two Adult Cats: Breeding Attempt (generates Stars)!
    if (catA.stage === 'adult' && catB.stage === 'adult') {
      const check = this.breeding.canBreed(catA, catB);
      if (check.eligible) {
        sound.playAdoptFanfare();
        spriteA.showEmote('💖');
        spriteB.showEmote('💖');
        this.createHeartBurst(midX, midY);

        const result = this.breeding.breed(catA, catB);
        if (result) {
          this.saveManager.save(this.state);
          this.notifyUiState();
        }
      } else {
        sound.playPurr();
        spriteA.showEmote('💕');
        spriteB.showEmote('💕');
        EventBus.emit('toast', {
          message: `🐾 ${catA.name} and ${catB.name} are cuddling! (${check.reason || 'Breeding on cooldown'})`,
        });
      }
      return;
    }

    // 2. Adult + Kitten / Teen: Grooming & Comfort!
    if ((catA.stage === 'adult' && catB.stage !== 'adult') || (catB.stage === 'adult' && catA.stage !== 'adult')) {
      const adult = catA.stage === 'adult' ? catA : catB;
      const young = catA.stage === 'adult' ? catB : catA;
      const youngSprite = catA.stage === 'adult' ? spriteB : spriteA;
      const adultSprite = catA.stage === 'adult' ? spriteA : spriteB;

      young.cleanliness = Math.min(100, young.cleanliness + 30);
      young.affection = Math.min(100, young.affection + 25);
      young.happiness = Math.min(100, young.happiness + 20);
      this.growth.addGrowth(young, 5);

      adultSprite.showEmote('👅');
      youngSprite.showEmote('✨');
      sound.playPurr();

      EventBus.emit('toast', {
        message: `✨ ${adult.name} lovingly groomed and cared for ${young.name}!`,
      });
      this.saveManager.save(this.state);
      this.notifyUiState();
      return;
    }

    // 3. Two Kittens / Teens: Play Session!
    catA.fun = Math.min(100, catA.fun + 35);
    catB.fun = Math.min(100, catB.fun + 35);
    catA.affection = Math.min(100, catA.affection + 20);
    catB.affection = Math.min(100, catB.affection + 20);

    spriteA.showEmote('🧶');
    spriteB.showEmote('🧶');
    sound.playSparkle();

    this.tweens.add({
      targets: spriteA,
      y: spriteA.y - 12,
      duration: 150,
      yoyo: true,
      repeat: 2,
      ease: 'Sine.easeInOut',
    });
    this.tweens.add({
      targets: spriteB,
      y: spriteB.y - 12,
      duration: 150,
      yoyo: true,
      repeat: 2,
      delay: 75,
      ease: 'Sine.easeInOut',
    });

    EventBus.emit('toast', {
      message: `🧶 ${catA.name} and ${catB.name} had a blast playing together!`,
    });
    this.saveManager.save(this.state);
    this.notifyUiState();
  }

  private showBreedingPartnersFor(dragCat: Cat): void {
    if (dragCat.stage !== 'adult') return;
    for (const otherSprite of this.catSprites.values()) {
      if (otherSprite.cat.id === dragCat.id) continue;
      if (otherSprite.cat.stage !== 'adult') continue;
      if (otherSprite.cat.area !== dragCat.area) continue;

      const progress = this.breeding.getPairCooldownProgress(dragCat, otherSprite.cat);
      otherSprite.setBreedingPartnerHighlight(true, progress.isReady);
      otherSprite.showBreedingReadinessBar(progress.ratio, progress.isReady);
    }
  }

  private clearAllBreedingPartners(): void {
    for (const sprite of this.catSprites.values()) {
      sprite.clearBreedingReadinessBar();
    }
  }

  private createHeartBurst(x: number, y: number): void {
    const emojis = ['💖', '💕', '✨', '🐾', '🌸'];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const dist = Phaser.Math.Between(30, 60);
      const targetX = x + Math.cos(angle) * dist;
      const targetY = y + Math.sin(angle) * dist - 20;

      const heart = this.add.text(x, y, emojis[i % emojis.length], {
        fontSize: `${Phaser.Math.Between(16, 24)}px`,
      }).setOrigin(0.5).setDepth(9999);

      this.tweens.add({
        targets: heart,
        x: targetX,
        y: targetY,
        alpha: 0,
        scaleX: 1.4,
        scaleY: 1.4,
        duration: 1200 + Phaser.Math.Between(0, 300),
        ease: 'Quad.easeOut',
        onComplete: () => heart.destroy(),
      });
    }
  }


  private interactWithCat(cat: Cat, sprite: CatSprite, tool: ToolType): void {
    sprite.recordInteraction(this.time.now);

    const result = this.interactions.applyTool(cat, tool);
    this.state.totalLoveEarned += result.loveEarned;

    if (tool === 'pet' && result.loveEarned > 0) {
      this.state.totalPetsGiven++;
    }

    // Direct care advances life stage growth only when need was satisfied
    if (result.loveEarned > 0) {
      const evo = this.growth.addGrowth(cat, 10);
      if (evo) {
        sprite.refreshVisuals();
      }
    }

    switch (tool) {
      case 'food':
        sound.playCrunch();
        this.spawnKibblePiece(sprite.x, sprite.y + 8);
        sprite.showEmote(result.loveEarned > 0 ? '🐟' : '😋');
        break;
      case 'pet':
        sound.playPurr();
        sprite.showEmote(result.loveEarned > 0 ? '❤️' : '🥰');
        break;
      case 'brush':
        sound.playSparkle();
        sprite.showEmote(result.loveEarned > 0 ? '✨' : '😸');
        break;
      case 'toy':
        sound.playMeow(cat.stage === 'kitten' ? 4 : 2);
        sprite.showEmote(result.loveEarned > 0 ? '🧶' : '🎉');
        break;
      case 'wash':
        sound.playBubble();
        this.spawnSoapBubbles(sprite.x, sprite.y);
        sprite.slinkAwayFrom(sprite.x, sprite.y + 12, 0.4);
        sprite.showEmote(result.loveEarned > 0 ? '🫧' : '✨');
        break;
    }

    sprite.refreshVisuals();

    const toastMsg = result.loveEarned > 0
      ? `${result.message} (+${result.loveEarned} 💗)`
      : result.message;
    EventBus.emit('toast', { message: toastMsg });
    EventBus.emit('love-changed', { love: this.love.love });
    this.notifyUiState();
  }

  private tryAdopt(): void {
    let targetAreaKey: CatArea = this.currentArea;
    const currentTargetArea = this.state.areas[targetAreaKey];
    const countInCurrent = this.state.cats.filter((c) => c.area === targetAreaKey).length;

    if (!currentTargetArea.unlocked || countInCurrent >= currentTargetArea.capacity) {
      const availableArea = (Object.keys(this.state.areas) as CatArea[]).find((aKey) => {
        const a = this.state.areas[aKey];
        const count = this.state.cats.filter((c) => c.area === aKey).length;
        return a.unlocked && count < a.capacity;
      });

      if (!availableArea) {
        EventBus.emit('toast', {
          message: 'All sanctuary areas are full! Open the Shop to unlock or expand an area.',
        });
        return;
      }
      targetAreaKey = availableArea;
    }

    const cost = this.love.nextAdoptionCost();
    if (!this.love.spend(cost)) {
      EventBus.emit('toast', { message: `Not enough Love. Need ${cost} 💗.` });
      return;
    }

    const usedNames = new Set(this.state.cats.map((c) => c.name));
    const cat = generateCat({ day: this.state.day, usedNames });
    cat.area = targetAreaKey;
    this.state.cats.push(cat);

    if (targetAreaKey === this.currentArea) {
      this.spawnCatSprite(cat, this.areaBounds());
    }

    sound.playAdoptFanfare();

    const rareBadge = cat.isRare ? '✨ Rare ' : '';
    const areaMeta = AREA_INFO_MAP[targetAreaKey];
    EventBus.emit('toast', {
      message: `🎉 ${rareBadge}${cat.name} joined the ${areaMeta.emoji} ${areaMeta.label}!`,
    });

    this.saveManager.save(this.state);
    this.notifyUiState();
  }

  update(time: number): void {
    const deltaMs = time - this.lastTick;
    this.lastTick = time;
    const deltaSeconds = deltaMs / 1000;
    const deltaMinutes = deltaMs / 60000;
    this.animTimer += deltaSeconds;

    // Tick Weather, Day/Night & Atmospheric Effects
    this.weather.tick(deltaSeconds);
    this.updateWeatherAndLighting(deltaSeconds);
    this.updateAmbientAtmosphere(deltaSeconds);

    // Update sprites currently visible in active area
    for (const sprite of this.catSprites.values()) {
      sprite.update(deltaMs);
    }

    // Update Interactive Toy Ball and Cat Chase AI
    if (this.toyBall) {
      this.toyBall.update(deltaSeconds);
      const ballSpeed = Math.hypot(this.toyBall.vx, this.toyBall.vy);
      const isMoving = ballSpeed > 25 || this.toyBall.isDragging;

      for (const sprite of this.catSprites.values()) {
        if (sprite.cat.animationState === 'sleep' || sprite.isCurrentlyDragged()) {
          sprite.clearChaseTarget();
          continue;
        }

        const dist = Phaser.Math.Distance.Between(sprite.x, sprite.y, this.toyBall.x, this.toyBall.y);

        if (isMoving && dist < 320) {
          sprite.setChaseTarget(this.toyBall.x, this.toyBall.y);
        } else if (!isMoving && dist > 40 && sprite.isChasing()) {
          sprite.clearChaseTarget();
        }

        // Cat catches & bats the ball
        if (dist <= 30 && this.toyBall.canBeBatted) {
          const kickAngle = Phaser.Math.Between(0, 360) * (Math.PI / 180);
          const kickPower = Phaser.Math.Between(260, 420);
          this.toyBall.kick(Math.cos(kickAngle) * kickPower, Math.sin(kickAngle) * kickPower);

          // Fast Fun meter gain!
          sprite.cat.fun = Math.min(100, sprite.cat.fun + 22);
          sprite.cat.affection = Math.min(100, sprite.cat.affection + 6);
          sprite.cat.happiness = Math.min(100, sprite.cat.happiness + 8);
          this.growth.addGrowth(sprite.cat, 8);

          // Award Care Points
          this.love.add(5);
          this.state.totalLoveEarned += 5;
          EventBus.emit('love-changed', { love: this.love.love });

          sound.playMeow(sprite.cat.stage === 'kitten' ? 4 : 2);
          sound.playSparkle();
          sprite.triggerPlayState(1.8);
          sprite.showEmote('🧶');
          sprite.refreshVisuals();
          this.notifyUiState();
        }
      }
    }

    // ── Update Kibble Bag & Cat Food Eating AI ─────────────────────────────
    if (this.kibbleBag) {
      this.kibbleBag.update();
    }

    if (this.kibblePieces.length > 0) {
      this.kibblePieces = this.kibblePieces.filter((p) => p.active && !p.isEaten);
    }

    if (this.kibblePieces.length > 0) {
      // Check if any awake, non-dragged cat in the sanctuary area is hungry (hunger < 98)
      const anyCatHungry = Array.from(this.catSprites.values()).some(
        (sprite) => sprite.cat.animationState !== 'sleep' && !sprite.isCurrentlyDragged() && sprite.cat.hunger < 98
      );

      for (const piece of this.kibblePieces) {
        piece.updateNoHungry(deltaSeconds, anyCatHungry);
      }

      for (const sprite of this.catSprites.values()) {
        if (sprite.cat.animationState === 'sleep' || sprite.isCurrentlyDragged()) {
          continue;
        }

        // Hungry cats prioritize finding food (hunger < 98)
        if (sprite.cat.hunger < 98) {
          let nearestPiece: KibblePiece | null = null;
          let minDist = 999999;

          for (const piece of this.kibblePieces) {
            if (!piece.active || piece.isEaten) continue;
            const dist = Phaser.Math.Distance.Between(sprite.x, sprite.y, piece.x, piece.y);
            if (dist < minDist) {
              minDist = dist;
              nearestPiece = piece;
            }
          }

          if (nearestPiece) {
            if (minDist <= 22) {
              sprite.clearChaseTarget();
              nearestPiece.eat();
              sound.playCrunch();

              const wasVeryHungry = sprite.cat.hunger < 50;
              sprite.cat.hunger = Math.min(100, sprite.cat.hunger + 32);
              sprite.cat.happiness = Math.min(100, sprite.cat.happiness + 8);
              sprite.cat.affection = Math.min(100, sprite.cat.affection + 4);
              this.growth.addGrowth(sprite.cat, 6);

              // Award Care Points
              this.love.add(3);
              this.state.totalLoveEarned += 3;
              EventBus.emit('love-changed', { love: this.love.love });

              // Eating chew state & emote
              sprite.triggerPlayState(1.4);
              sprite.showEmote(wasVeryHungry ? '🐟' : '😋');
              sprite.refreshVisuals();
              this.notifyUiState();
            } else if (minDist < 650) {
              sprite.setChaseTarget(nearestPiece.x, nearestPiece.y);
            }
          }
        }
      }
    }

    // Tick needs for ALL cats in the sanctuary
    for (const cat of this.state.cats) {
      tickCatNeeds(cat, deltaMinutes);
    }

    // Tick Life Stage Growth
    const evoEvents = this.growth.tickGrowth(this.state.cats, deltaMinutes);
    for (const evo of evoEvents) {
      const sp = this.catSprites.get(evo.cat.id);
      if (sp) sp.refreshVisuals();
    }


    // Passive Love Generation
    let loveGained = this.love.tickPassiveLove(deltaMinutes);
    const cafeCats = this.state.cats.filter((c) => c.area === 'cafe').length;
    if (this.state.areas.cafe?.unlocked && cafeCats > 0) {
      const fountainBoost = this.state.furniture.includes('fountain_dish') ? 1.2 : 1.0;
      const cafeTipLove = cafeCats * 0.12 * fountainBoost * deltaMinutes;
      this.love.add(cafeTipLove);
      loveGained += cafeTipLove;
    }

    if (loveGained > 0) {
      this.state.totalLoveEarned += loveGained;
      EventBus.emit('love-changed', { love: this.love.love });
    }

    // 1-minute Online Passive Care Points Progression (Kitten: 1CP/10m, Teen: 2CP/10m, Adult: 3CP/10m)
    this.onlineProgressionAccumMs += deltaMs;
    if (this.onlineProgressionAccumMs >= 60_000) {
      const minutes = this.onlineProgressionAccumMs / 60_000;
      this.onlineProgressionAccumMs = 0;

      let exactCp = 0;
      for (const cat of this.state.cats) {
        const cpPerMin = cat.stage === 'kitten' ? 0.1 : cat.stage === 'teen' ? 0.2 : 0.3;
        exactCp += cpPerMin * minutes;
      }
      const roundedCp = Math.ceil(exactCp);
      if (roundedCp > 0) {
        this.love.add(roundedCp);
        this.state.totalLoveEarned += roundedCp;
        EventBus.emit('love-changed', { love: this.love.love });
      }
    }

    this.relationshipTickAccum += deltaMs;
    if (this.relationshipTickAccum > 4000) {
      const periodSeconds = this.relationshipTickAccum / 1000;
      this.relationshipTickAccum = 0;
      this.tickRelationshipsAndEvents(periodSeconds);

      // Stray Cat Safety Net Tick: ensure sanctuary always has at least 2 cats
      const strayResult = this.breeding.tickStraySafetyNet();
      if (strayResult) {
        if (strayResult.cat.area === this.currentArea) {
          this.spawnCatSprite(strayResult.cat, this.areaBounds());
        }
        this.saveManager.save(this.state);
        this.notifyUiState();
      }

      // Update breed-ready heart emote for adult cats in the current area
      const now = Date.now();
      for (const [catId, sprite] of this.catSprites.entries()) {
        const cat = this.state.cats.find((c) => c.id === catId);
        if (!cat || cat.stage !== 'adult') { sprite.setBreedReady(false); continue; }
        // Find any other adult in same area to pair with
        const hasPartner = this.state.cats.some(
          (c) => c.id !== catId && c.stage === 'adult' && c.area === cat.area
        );
        if (!hasPartner) { sprite.setBreedReady(false); continue; }
        // Check if this cat's cooldown (keyed by any pair it's in) has expired
        const onCooldown = Object.entries(this.state.breedingCooldowns).some(([key, ts]) => {
          return key.includes(catId) && now - ts < BREED_COOLDOWN_MS;
        });
        sprite.setBreedReady(!onCooldown);
      }
    }
  }



  private updateAmbientAtmosphere(deltaSeconds: number): void {
    const bounds = this.areaBounds();
    this.dynamicEffectsGfx.clear();

    // Spawn Area-Specific Micro Particles
    if (this.currentArea === 'shelter' && Math.random() < 0.25) {
      // Fireplace Embers
      const fpX = bounds.x + bounds.width * 0.5;
      const wallHeight = Math.min(84, bounds.height * 0.28);
      const fpY = bounds.y + wallHeight - 12;
      this.ambientEffects.push({
        type: 'ember',
        x: fpX + Phaser.Math.Between(-12, 12),
        y: fpY - 8,
        speedX: Phaser.Math.FloatBetween(-15, 15),
        speedY: Phaser.Math.FloatBetween(-30, -60),
        alpha: 0.9,
        size: Phaser.Math.FloatBetween(2, 3.5),
        life: 0,
        maxLife: Phaser.Math.FloatBetween(1.0, 1.8),
        color: Phaser.Math.RND.pick([0xff5400, 0xffbe0b, 0xff0054]),
      });
    } else if (this.currentArea === 'cafe' && Math.random() < 0.2) {
      // Coffee Steam Wisps
      const barX = bounds.x + bounds.width * 0.5;
      const wallH = Math.min(88, bounds.height * 0.28);
      const barY = bounds.y + wallH - 14;
      this.ambientEffects.push({
        type: 'steam',
        x: barX - 44 + Phaser.Math.Between(4, 30),
        y: barY - 48,
        speedX: Phaser.Math.FloatBetween(-8, 8),
        speedY: Phaser.Math.FloatBetween(-20, -40),
        alpha: 0.6,
        size: Phaser.Math.FloatBetween(3, 6),
        life: 0,
        maxLife: Phaser.Math.FloatBetween(1.2, 2.0),
        color: 0xffffff,
      });
    } else if ((this.currentArea === 'sunroom' || this.currentArea === 'yard') && Math.random() < 0.15) {
      // Floating Golden Sun Motes / Pollen
      this.ambientEffects.push({
        type: 'mote',
        x: Phaser.Math.Between(bounds.left + 20, bounds.right - 20),
        y: Phaser.Math.Between(bounds.top + 20, bounds.bottom - 20),
        speedX: Phaser.Math.FloatBetween(-10, 10),
        speedY: Phaser.Math.FloatBetween(-10, 10),
        alpha: 0.7,
        size: Phaser.Math.FloatBetween(1.5, 3.0),
        life: 0,
        maxLife: Phaser.Math.FloatBetween(2.0, 3.5),
        color: 0xfffa80,
      });
    }

    // Render & Update Atmosphere
    for (let i = this.ambientEffects.length - 1; i >= 0; i--) {
      const e = this.ambientEffects[i];
      e.life += deltaSeconds;
      if (e.life >= e.maxLife) {
        this.ambientEffects.splice(i, 1);
        continue;
      }

      e.x += e.speedX * deltaSeconds;
      e.y += e.speedY * deltaSeconds;
      const progress = e.life / e.maxLife;
      const currentAlpha = e.alpha * (1 - progress);

      this.dynamicEffectsGfx.fillStyle(e.color, currentAlpha);
      this.dynamicEffectsGfx.fillCircle(e.x, e.y, e.size * (e.type === 'steam' ? 1 + progress : 1));
    }
  }

  private updateWeatherAndLighting(deltaSeconds: number): void {
    const bounds = this.areaBounds();

    // 1. Ambient Lighting (Day / Morning / Sunset / Night)
    this.ambientLightingGfx.clear();
    const ambient = this.weather.getAmbientOverlayColor();
    if (ambient.alpha > 0) {
      this.ambientLightingGfx.fillStyle(ambient.color, ambient.alpha);
      this.ambientLightingGfx.fillRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, 22);

      // If Night, draw little twinkling moon stars
      if (this.weather.timeOfDay === 'night') {
        this.ambientLightingGfx.fillStyle(0xffffff, 0.7);
        const starSeeds = [
          [bounds.left + 40, bounds.top + 30],
          [bounds.left + 120, bounds.top + 50],
          [bounds.right - 80, bounds.top + 35],
          [bounds.right - 140, bounds.top + 65],
          [bounds.left + bounds.width * 0.5, bounds.top + 25],
        ];
        starSeeds.forEach(([sx, sy]) => {
          this.ambientLightingGfx.fillCircle(sx, sy, 1.5);
        });
      }
    }

    // 2. Weather Particles (Rain / Snow only outdoors or in Sunroom glass)
    this.weatherParticlesGfx.clear();
    if (this.weather.weather === 'rain') {
      this.weatherParticlesGfx.lineStyle(1.5, 0x90caf9, 0.7);
      for (const p of this.particles) {
        p.y += p.speedY * deltaSeconds;
        p.x += p.speedX * deltaSeconds;

        if (p.y > bounds.bottom - 10) {
          p.y = bounds.top + 10;
          p.x = Phaser.Math.Between(bounds.left + 10, bounds.right - 10);
        }

        this.weatherParticlesGfx.beginPath();
        this.weatherParticlesGfx.moveTo(p.x, p.y);
        this.weatherParticlesGfx.lineTo(p.x - 3, p.y + p.size);
        this.weatherParticlesGfx.strokePath();
      }
    } else if (this.weather.weather === 'snow') {
      this.weatherParticlesGfx.fillStyle(0xffffff, 0.85);
      for (const p of this.particles) {
        p.y += p.speedY * deltaSeconds;
        p.x += Math.sin(p.y * 0.05) * 12 * deltaSeconds + p.speedX * deltaSeconds;

        if (p.y > bounds.bottom - 10) {
          p.y = bounds.top + 10;
          p.x = Phaser.Math.Between(bounds.left + 10, bounds.right - 10);
        }

        this.weatherParticlesGfx.fillCircle(p.x, p.y, p.size);
      }
    }
  }

  private tickRelationshipsAndEvents(periodSeconds: number): void {
    const sleeping = this.state.cats.filter((c) => c.animationState === 'sleep');
    for (let i = 0; i < sleeping.length; i++) {
      for (let j = i + 1; j < sleeping.length; j++) {
        if (sleeping[i].area === sleeping[j].area) {
          this.relationships.nap(sleeping[i], sleeping[j]);
        }
      }
    }

    // Cats that are playing in the same area build friendship from shared play
    const playing = this.state.cats.filter((c) => c.animationState === 'play');
    for (let i = 0; i < playing.length; i++) {
      for (let j = i + 1; j < playing.length; j++) {
        if (playing[i].area === playing[j].area) {
          this.relationships.play(playing[i], playing[j]);
        }
      }
    }

    // Cats eating (hunger recently refreshed, hunger > 80) build rapport from shared meals
    const eating = this.state.cats.filter((c) => c.hunger > 80 && c.animationState !== 'sleep');
    for (let i = 0; i < eating.length; i++) {
      for (let j = i + 1; j < eating.length; j++) {
        if (eating[i].area === eating[j].area && Math.random() < 0.3) {
          this.relationships.eat(eating[i], eating[j]);
        }
      }
    }

    this.relationships.updateAllBestFriends();

    const events = this.events_.tick(periodSeconds);
    for (const e of events) {
      EventBus.emit('toast', { message: e.message });
    }
    if (events.length > 0) {
      EventBus.emit('love-changed', { love: this.love.love });
    }
  }
}

