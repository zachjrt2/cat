import Phaser from 'phaser';
import type { Cat, CatArea, FenceLayout, GameState, RareCatType, ToolType, WeatherType } from '../data/types';
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
import { BreedingSystem, BREED_COOLDOWN_MS } from '../systems/BreedingSystem';
import { tickCatNeeds, applyAutomationThresholds } from '../systems/NeedsSystem';
import { CatSprite, type AvailableMachineInfo, type AvailableFurnitureInfo } from '../entities/CatSprite';
import { DeliveryBox, type DeliveryData } from '../entities/DeliveryBox';
import {
  AUTOSAVE_INTERVAL_MS,
  AREA_INFO_MAP,
  FURNITURE_CATALOG,
  RARE_SUMMONS,
  OFFLINE_STAR_UPGRADES,
  calculateRehomeLove,
  getAreaCapacityUpgradeCost,
  CAT_PERFUME_COST,
  CAT_PERFUME_COOLDOWN_MS,
  CAT_PERFUME_FRENZY_SECONDS,
  CONGA_WHISTLE_COST,
  SNOWFLAKE_WAND_COST,
  HEART_WAND_COST,
  INFINITY_METRONOME_COST,
  SOLAR_PRISM_COST,
  STAR_COMPASS_COST,
} from '../data/constants';
import { EventBus } from '../ui/EventBus';
import { sound } from '../systems/SoundManager';
import { exportCatCardAsPng } from '../systems/CardExport';
import { AreaRenderer } from './controllers/AreaRenderer';
import { WeatherAndLightingController } from './controllers/WeatherAndLightingController';
import { ToolInteractionController } from './controllers/ToolInteractionController';
import { CatDragDropManager } from './controllers/CatDragDropManager';

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

  private currentArea: CatArea = 'yard';
  private catSprites = new Map<string, CatSprite>();
  private activeCatSpriteList: CatSprite[] = [];
  private needsTickAccumMs = 0;
  private lastTick = 0;
  private lastPerfumeBondSoundTime = 0;
  private relationshipTickAccum = 0;
  private onlineProgressionAccumMs = 0;
  private animTimer = 0;
  private activeDeliveryBoxes: DeliveryBox[] = [];

  // Conga Parade Event (~every 10 minutes)
  private congaParadeTimer = 600;
  private isCongaParadeActive = false;
  private congaParadeDuration = 0;

  // Rain Ritual Concentric Circles Event (once per storm, matches rain.mp3 duration)
  private isRainDanceActive = false;
  private rainDanceTimer = 0;
  private wasRaining = false;
  private hasDoneRainDanceThisStorm = false;

  // Active Dance Formations Event State
  private isDanceFormationActive = false;
  private activeDanceFormation: 'none' | 'snowflake' | 'heart' | 'infinity' | 'sunset' | 'constellation' = 'none';
  private danceFormationDuration = 0;
  private wasSnowing = false;
  private wasSunset = false;
  private hasDoneSnowflakeDanceThisSnow = false;
  private hasDoneSunsetDanceThisSunset = false;

  // Sub-Controllers
  private areaRenderer!: AreaRenderer;
  private weatherAndLighting!: WeatherAndLightingController;
  private toolController!: ToolInteractionController;
  private dragDropManager!: CatDragDropManager;

  constructor() {
    super('Sanctuary');
  }

  create(): void {
    this.initState();
    this.initControllers();
    this.drawCurrentArea();
    this.spawnCatsInCurrentArea();
    this.bindUiEvents();

    this.wasRaining = this.state.weather === 'rain';
    this.hasDoneRainDanceThisStorm = this.wasRaining;
    this.wasSnowing = this.state.weather === 'snow';
    this.hasDoneSnowflakeDanceThisSnow = this.wasSnowing;
    this.wasSunset = this.state.timeOfDay === 'sunset';
    this.hasDoneSunsetDanceThisSunset = this.wasSunset;

    this.lastTick = this.time.now;

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const selectedTool = this.toolController.getSelectedTool();
      const toyBall = this.toolController.getToyBall();
      if (selectedTool === 'toy' && toyBall && !toyBall.isDragging) {
        const bounds = this.areaRenderer.areaBounds();
        if (bounds.contains(pointer.x, pointer.y)) {
          const dx = pointer.x - toyBall.x;
          const dy = pointer.y - toyBall.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 24) {
            const speed = Math.min(650, dist * 3.5);
            toyBall.kick((dx / dist) * speed, (dy / dist) * speed);
            sound.playTap();
          }
        }
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.toolController.onScenePointerMove(pointer, this.animTimer);
      this.dragDropManager.onScenePointerMove(pointer);
    });

    this.input.on('pointerup', () => {
      this.dragDropManager.onScenePointerUp();
    });

    this.time.addEvent({
      delay: AUTOSAVE_INTERVAL_MS,
      loop: true,
      callback: () => this.saveManager.save(this.state),
    });

    this.scale.on('resize', () => {
      this.drawCurrentArea();
    });

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => CatSprite.clearPools());
    this.events.on(Phaser.Scenes.Events.DESTROY, () => CatSprite.clearPools());

    sound.startMusic();
    this.notifyUiState();
  }

  private initState(): void {
    const loaded = this.saveManager.load();
    this.state = loaded ?? createNewGameState();

    if (!this.state.areas.yard) {
      this.state.areas = {
        yard: { id: 'yard', unlocked: true, unlockThreshold: 0, capacity: 5 },
        shelter: { id: 'shelter', unlocked: false, unlockThreshold: 3, capacity: 15 },
        sunroom: { id: 'sunroom', unlocked: false, unlockThreshold: 8, capacity: 25 },
        cafe: { id: 'cafe', unlocked: false, unlockThreshold: 15, capacity: 40 },
      };
    }

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
      const usedNames = new Set<string>();
      const cat1 = generateCat({ day: this.state.day, usedNames, existingCats: this.state.cats, stage: 'adult' });
      this.state.cats.push(cat1);
      const cat2 = generateCat({ day: this.state.day, usedNames, existingCats: this.state.cats, stage: 'adult' });
      this.state.cats.push(cat2);
      this.love.add(50);
    }

    CatSprite.showNameLabels = this.state.showCatNames !== false;
  }

  private initControllers(): void {
    this.areaRenderer = new AreaRenderer(this);
    this.weatherAndLighting = new WeatherAndLightingController(
      this,
      this.weather,
      () => this.areaRenderer.areaBounds(),
    );
    this.toolController = new ToolInteractionController(
      this,
      this.love,
      this.growth,
      this.interactions,
      {
        getWalkableBounds: () => this.areaRenderer.walkableBounds(this.currentArea),
        getCatSprites: () => this.catSprites,
        saveGame: () => this.saveManager.save(this.state),
        notifyUi: () => this.notifyUiState(),
      },
    );
    this.dragDropManager = new CatDragDropManager(
      this,
      this.state,
      this.breeding,
      this.growth,
      this.love,
      {
        getWalkableBounds: () => this.areaRenderer.walkableBounds(this.currentArea),
        getAreaBounds: () => this.areaRenderer.areaBounds(),
        getPartitions: () => this.areaRenderer.getPartitionBounds(this.state.fenceLayout || 'none', this.currentArea),
        findPartitionForPoint: (x, y) => {
          const parts = this.areaRenderer.getPartitionBounds(this.state.fenceLayout || 'none', this.currentArea);
          return this.areaRenderer.findPartitionForPoint(x, y, parts);
        },
        getAdoptionBoxContainer: () => this.areaRenderer.getAdoptionBoxContainer(),
        getAdoptionBoxGlow: () => this.areaRenderer.getAdoptionBoxGlow(),
        getInspectContainer: () => this.areaRenderer.getInspectContainer(),
        getInspectGlow: () => this.areaRenderer.getInspectGlow(),
        getCatSprites: () => this.catSprites,
        createHeartBurst: (x, y) => this.createHeartBurst(x, y),
        saveGame: () => this.saveManager.save(this.state),
        notifyUi: () => this.notifyUiState(),
      },
    );
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
      offlineStarLevel: this.state.offlineStarLevel || 1,
      catPerfumeCount: this.state.catPerfumeCount || 0,
      congaWhistleCount: this.state.congaWhistleCount || 0,
      snowflakeWandCount: this.state.snowflakeWandCount || 0,
      heartWandCount: this.state.heartWandCount || 0,
      infinityMetronomeCount: this.state.infinityMetronomeCount || 0,
      solarPrismCount: this.state.solarPrismCount || 0,
      starCompassCount: this.state.starCompassCount || 0,
      fenceLayout: this.state.fenceLayout || 'none',
      plinkoUpgrades: this.state.plinkoUpgrades || {},
    });
  }

  private drawCurrentArea(): void {
    this.areaRenderer.drawArea(this.currentArea, this.state);

    const partitions = this.areaRenderer.getPartitionBounds(this.state.fenceLayout || 'none', this.currentArea);
    const areaWalkable = this.areaRenderer.walkableBounds(this.currentArea);

    const kibbleBag = this.toolController.getKibbleBag();
    if (kibbleBag) {
      kibbleBag.setBounds(areaWalkable);
    }
    const toyBall = this.toolController.getToyBall();
    if (toyBall) {
      toyBall.setBounds(areaWalkable);
    }

    for (const sprite of this.catSprites.values()) {
      if (sprite.cat.area !== this.currentArea) continue;
      const assignedPart = this.areaRenderer.findPartitionForPoint(sprite.x, sprite.y, partitions);
      sprite.setAreaBounds(assignedPart);
      sprite.setSelectedTool(this.toolController.getSelectedTool());
      sprite.x = Phaser.Math.Clamp(sprite.x, assignedPart.left + 20, assignedPart.right - 20);
      sprite.y = Phaser.Math.Clamp(sprite.y, assignedPart.top + 20, assignedPart.bottom - 20);
    }

    this.refreshCatMachines();
    this.refreshCatFurniture();
  }

  private spawnCatsInCurrentArea(): void {
    for (const sprite of this.catSprites.values()) {
      sprite.destroy();
    }
    this.catSprites.clear();

    const bounds = this.areaRenderer.walkableBounds(this.currentArea);
    const areaCats = this.state.cats.filter((c) => c.area === this.currentArea);

    for (const cat of areaCats) {
      this.spawnCatSprite(cat, bounds);
    }
  }

  private getAvailableMachinesForCurrentArea(bounds: Phaser.Geom.Rectangle): AvailableMachineInfo[] {
    return this.automation.getMachinesInArea(this.currentArea).map((m) => {
      const threshold = m.level === 1 ? 50 : m.level === 2 ? 80 : 100;
      return {
        id: m.def.id,
        needType: m.def.needType,
        level: m.level,
        threshold,
        x: bounds.left + m.def.xPercent * bounds.width,
        y: bounds.top + m.def.yPercent * bounds.height,
      };
    });
  }

  private refreshCatMachines(): void {
    const bounds = this.areaRenderer.walkableBounds(this.currentArea);
    const machines = this.getAvailableMachinesForCurrentArea(bounds);
    for (const sprite of this.catSprites.values()) {
      sprite.setAvailableMachines(machines);
    }
  }

  private getAvailableFurnitureForCurrentArea(bounds: Phaser.Geom.Rectangle): AvailableFurnitureInfo[] {
    const owned = FURNITURE_CATALOG.filter(
      (f) => f.area === this.currentArea && this.state.furniture.includes(f.id),
    );
    return owned.map((f) => ({
      id: f.id,
      name: f.name,
      x: bounds.left + f.xPercent * bounds.width,
      y: bounds.top + f.yPercent * bounds.height,
    }));
  }

  private refreshCatFurniture(): void {
    const bounds = this.areaRenderer.walkableBounds(this.currentArea);
    const furniture = this.getAvailableFurnitureForCurrentArea(bounds);
    for (const sprite of this.catSprites.values()) {
      sprite.setAvailableFurniture(furniture);
    }
  }

  private spawnCatSprite(cat: Cat, bounds: Phaser.Geom.Rectangle): void {
    const partitions = this.areaRenderer.getPartitionBounds(this.state.fenceLayout || 'none', this.currentArea);
    let x = 0;
    let y = 0;

    if (typeof cat.xPercent === 'number' && typeof cat.yPercent === 'number') {
      x = bounds.left + cat.xPercent * bounds.width;
      y = bounds.top + cat.yPercent * bounds.height;
    } else {
      x = Phaser.Math.Between(bounds.left + 30, bounds.right - 30);
      y = Phaser.Math.Between(bounds.top + 30, bounds.bottom - 30);
      cat.xPercent = (x - bounds.left) / bounds.width;
      cat.yPercent = (y - bounds.top) / bounds.height;
    }

    const catSubBounds = this.areaRenderer.findPartitionForPoint(x, y, partitions);
    x = Phaser.Math.Clamp(x, catSubBounds.left + 20, catSubBounds.right - 20);
    y = Phaser.Math.Clamp(y, catSubBounds.top + 20, catSubBounds.bottom - 20);

    const sprite = new CatSprite(this, cat, x, y, catSubBounds);
    sprite.setSelectedTool(this.toolController.getSelectedTool());

    const machines = this.getAvailableMachinesForCurrentArea(bounds);
    sprite.setAvailableMachines(machines);
    const furniture = this.getAvailableFurnitureForCurrentArea(bounds);
    sprite.setAvailableFurniture(furniture);
    sprite.setOtherSpritesProvider(() => this.activeCatSpriteList);
    sprite.setToyBallProvider(() => this.toolController.getToyBall());
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
      const selectedTool = this.toolController.getSelectedTool();
      if (selectedTool) {
        this.toolController.interactWithCat(cat, sprite, selectedTool);
      } else {
        this.dragDropManager.onCatPointerDown(cat, sprite, ptr);
      }
    });

    this.catSprites.set(cat.id, sprite);
    this.refreshActiveCatSpriteList();
  }

  private refreshActiveCatSpriteList(): void {
    this.activeCatSpriteList = Array.from(this.catSprites.values());
  }

  private bindUiEvents(): void {
    EventBus.on('tool-selected', ({ tool }: { tool: string | null }) => {
      this.toolController.setSelectedTool(tool as ToolType | null);
    });

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

    EventBus.on('focus-cat', ({ catId }: { catId: string }) => {
      this.focusOnCat(catId);
    });

    EventBus.on('rename-cat', ({ catId, newName, cost }: { catId: string; newName: string; cost: number }) => {
      const cat = this.state.cats.find((c) => c.id === catId);
      if (!cat) return;

      if (this.love.spend(cost)) {
        cat.name = newName;
        const sprite = this.catSprites.get(catId);
        if (sprite) {
          sprite.refreshVisuals();
        }
        this.saveManager.save(this.state);
        this.notifyUiState();
        EventBus.emit('love-changed', { love: this.love.love });
        EventBus.emit('toast', { message: `✏️ Renamed cat to ${newName}! (-${cost} 💗)` });
      } else {
        EventBus.emit('toast', { message: `Need ${cost} 💗 to rename.` });
      }
    });

    EventBus.on('buy-furniture', ({ furnitureId }: { furnitureId: string }) => {
      this.tryBuyFurniture(furnitureId);
    });

    EventBus.on('buy-machine', ({ machineId }: { machineId: string }) => {
      const def = this.automation.getMachineDef(machineId);
      if (!def) return;
      if (this.automation.getMachineLevel(machineId) > 0) {
        EventBus.emit('toast', { message: `You already own ${def.name}!` });
        return;
      }
      if (!this.love.spend(def.baseCost)) {
        EventBus.emit('toast', { message: `Need ${def.baseCost.toLocaleString()} 💗 to purchase ${def.name}.` });
        return;
      }
      EventBus.emit('love-changed', { love: this.love.love });
      this.spawnDeliveryBox({
        type: 'machine',
        id: machineId,
        name: def.name,
        emoji: '⚙️',
        area: def.area,
        onOpen: () => {
          this.state.machines[machineId] = 1;
          for (const cat of this.state.cats) {
            if (cat.area === def.area) {
              applyAutomationThresholds(cat, this.state.machines);
            }
          }
          this.saveManager.save(this.state);
          this.drawCurrentArea();
          this.refreshCatMachines();
          this.notifyUiState();
          sound.playAdoptFanfare();
          EventBus.emit('toast', { message: `🎉 Installed ${def.name} in ${def.area.toUpperCase()}!` });
        },
      });
    });

    EventBus.on('upgrade-machine', ({ machineId }: { machineId: string }) => {
      if (this.automation.upgradeMachine(machineId)) {
        this.saveManager.save(this.state);
        this.drawCurrentArea();
        this.refreshCatMachines();
        this.notifyUiState();
      }
    });

    EventBus.on('rehome-cat', ({ catId }: { catId: string }) => {
      this.handleRehomeCat(catId);
    });

    EventBus.on('rehome-cats-batch', ({ catIds }: { catIds: string[] }) => {
      this.handleRehomeCatsBatch(catIds);
    });

    EventBus.on('instant-grow-cat', ({ catId, cost }: { catId: string; cost: number }) => {
      this.handleInstantGrowCat(catId, cost);
    });

    EventBus.on('toggle-cat-names', () => {
      const newVal = this.state.showCatNames === false ? true : false;
      this.state.showCatNames = newVal;
      CatSprite.showNameLabels = newVal;
      for (const sprite of this.catSprites.values()) {
        sprite.setNameLabelVisible(newVal);
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
      this.saveManager.save(this.state);
      this.notifyUiState();

      if (cat.area === this.currentArea) {
        this.spawnCatSprite(cat, this.areaRenderer.walkableBounds(this.currentArea));
      }
    });

    EventBus.on('spend-tokens', ({ amount }: { amount: number }) => {
      this.milestones.spendTokens(amount);
      this.saveManager.save(this.state);
      this.notifyUiState();
    });

    EventBus.on('weather-changed', ({ weather }: { weather: WeatherType }) => {
      if (weather === 'rain') {
        if (!this.hasDoneRainDanceThisStorm) {
          this.hasDoneRainDanceThisStorm = true;
          this.startRainDance();
        }
      } else {
        this.hasDoneRainDanceThisStorm = false;
        if (this.isRainDanceActive) {
          this.endRainDance(false);
        }
      }
    });

    EventBus.on('upgrade-plinko', ({ upgradeId, level }: { upgradeId: string; level: number }) => {
      if (!this.state.plinkoUpgrades) this.state.plinkoUpgrades = {};
      this.state.plinkoUpgrades[upgradeId] = level;
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
          this.toolController.interactWithCat(cat, sprite, tool);
        } else {
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

    EventBus.on('buy-cat-perfume', () => {
      if (this.love.spend(CAT_PERFUME_COST)) {
        EventBus.emit('love-changed', { love: this.love.love });
        this.spawnDeliveryBox({
          type: 'perfume',
          id: 'cat_perfume',
          name: 'Cat Perfume',
          emoji: '🌸',
          onOpen: () => {
            this.state.catPerfumeCount = (this.state.catPerfumeCount || 0) + 1;
            this.saveManager.save(this.state);
            this.notifyUiState();
            sound.playAdoptFanfare();
            EventBus.emit('toast', { message: `🌸 Added Cat Perfume to inventory! (${this.state.catPerfumeCount} in stock)` });
          },
        });
      } else {
        EventBus.emit('toast', { message: `Need ${CAT_PERFUME_COST} 💗 to buy Cat Perfume.` });
        sound.playPop();
      }
    });

    EventBus.on('buy-conga-whistle', () => {
      if (this.love.spend(CONGA_WHISTLE_COST)) {
        EventBus.emit('love-changed', { love: this.love.love });
        this.spawnDeliveryBox({
          type: 'conga_whistle',
          id: 'conga_whistle',
          name: 'Party Whistle',
          emoji: '🎶',
          onOpen: () => {
            this.state.congaWhistleCount = (this.state.congaWhistleCount || 0) + 1;
            this.saveManager.save(this.state);
            this.notifyUiState();
            sound.playAdoptFanfare();
            EventBus.emit('toast', { message: `🎶 Added Party Whistle to inventory! (${this.state.congaWhistleCount} in stock)` });
          },
        });
      } else {
        EventBus.emit('toast', { message: `Need ${CONGA_WHISTLE_COST} 💗 to buy Party Whistle.` });
        sound.playPop();
      }
    });

    EventBus.on('use-conga-whistle', () => {
      if ((this.state.congaWhistleCount || 0) <= 0) {
        EventBus.emit('toast', { message: 'No Party Whistles in inventory!' });
        sound.playPop();
        return;
      }

      const activeSprites = this.activeCatSpriteList.filter((s) => s.active && !s.isCurrentlyDragged());
      if (activeSprites.length < 2) {
        EventBus.emit('toast', { message: 'Need at least 2 cats in this area to form a Conga Line!' });
        sound.playPop();
        return;
      }

      this.state.congaWhistleCount = Math.max(0, (this.state.congaWhistleCount || 0) - 1);
      this.saveManager.save(this.state);
      this.notifyUiState();

      sound.playWhistle();
      this.startCongaParade();
    });

    // Consumable Purchases
    EventBus.on('buy-snowflake-wand', () => {
      if (this.love.spend(SNOWFLAKE_WAND_COST)) {
        EventBus.emit('love-changed', { love: this.love.love });
        this.spawnDeliveryBox({
          type: 'snowflake_wand',
          id: 'snowflake_wand',
          name: 'Snowflake Crystal',
          emoji: '❄️',
          onOpen: () => {
            this.state.snowflakeWandCount = (this.state.snowflakeWandCount || 0) + 1;
            this.saveManager.save(this.state);
            this.notifyUiState();
            sound.playAdoptFanfare();
            EventBus.emit('toast', { message: `❄️ Added Snowflake Crystal to inventory! (${this.state.snowflakeWandCount} in stock)` });
          },
        });
      }
    });

    EventBus.on('buy-heart-wand', () => {
      if (this.love.spend(HEART_WAND_COST)) {
        EventBus.emit('love-changed', { love: this.love.love });
        this.spawnDeliveryBox({
          type: 'heart_wand',
          id: 'heart_wand',
          name: 'Catnip Heart Wand',
          emoji: '💖',
          onOpen: () => {
            this.state.heartWandCount = (this.state.heartWandCount || 0) + 1;
            this.saveManager.save(this.state);
            this.notifyUiState();
            sound.playAdoptFanfare();
            EventBus.emit('toast', { message: `💖 Added Catnip Heart Wand to inventory! (${this.state.heartWandCount} in stock)` });
          },
        });
      }
    });

    EventBus.on('buy-infinity-metronome', () => {
      if (this.love.spend(INFINITY_METRONOME_COST)) {
        EventBus.emit('love-changed', { love: this.love.love });
        this.spawnDeliveryBox({
          type: 'infinity_metronome',
          id: 'infinity_metronome',
          name: 'Infinity Metronome',
          emoji: '♾️',
          onOpen: () => {
            this.state.infinityMetronomeCount = (this.state.infinityMetronomeCount || 0) + 1;
            this.saveManager.save(this.state);
            this.notifyUiState();
            sound.playAdoptFanfare();
            EventBus.emit('toast', { message: `♾️ Added Infinity Metronome to inventory! (${this.state.infinityMetronomeCount} in stock)` });
          },
        });
      }
    });

    EventBus.on('buy-solar-prism', () => {
      if (this.love.spend(SOLAR_PRISM_COST)) {
        EventBus.emit('love-changed', { love: this.love.love });
        this.spawnDeliveryBox({
          type: 'solar_prism',
          id: 'solar_prism',
          name: 'Solar Prism',
          emoji: '🌅',
          onOpen: () => {
            this.state.solarPrismCount = (this.state.solarPrismCount || 0) + 1;
            this.saveManager.save(this.state);
            this.notifyUiState();
            sound.playAdoptFanfare();
            EventBus.emit('toast', { message: `🌅 Added Solar Prism to inventory! (${this.state.solarPrismCount} in stock)` });
          },
        });
      }
    });

    EventBus.on('buy-star-compass', () => {
      if (this.love.spend(STAR_COMPASS_COST)) {
        EventBus.emit('love-changed', { love: this.love.love });
        this.spawnDeliveryBox({
          type: 'star_compass',
          id: 'star_compass',
          name: 'Star Compass',
          emoji: '🐱',
          onOpen: () => {
            this.state.starCompassCount = (this.state.starCompassCount || 0) + 1;
            this.saveManager.save(this.state);
            this.notifyUiState();
            sound.playAdoptFanfare();
            EventBus.emit('toast', { message: `🐱 Added Star Compass to inventory! (${this.state.starCompassCount} in stock)` });
          },
        });
      }
    });

    // Consumable Use Triggers
    EventBus.on('use-snowflake-wand', () => {
      if ((this.state.snowflakeWandCount || 0) <= 0) {
        EventBus.emit('toast', { message: 'No Snowflake Crystals in inventory!' });
        return;
      }
      this.state.snowflakeWandCount = Math.max(0, (this.state.snowflakeWandCount || 0) - 1);
      this.saveManager.save(this.state);
      this.notifyUiState();
      this.startSnowflakeMandalaDance(true);
    });

    EventBus.on('use-heart-wand', () => {
      if ((this.state.heartWandCount || 0) <= 0) {
        EventBus.emit('toast', { message: 'No Catnip Heart Wands in inventory!' });
        return;
      }
      this.state.heartWandCount = Math.max(0, (this.state.heartWandCount || 0) - 1);
      this.saveManager.save(this.state);
      this.notifyUiState();
      this.startHeartFormationDance();
    });

    EventBus.on('use-infinity-metronome', () => {
      if ((this.state.infinityMetronomeCount || 0) <= 0) {
        EventBus.emit('toast', { message: 'No Infinity Metronomes in inventory!' });
        return;
      }
      this.state.infinityMetronomeCount = Math.max(0, (this.state.infinityMetronomeCount || 0) - 1);
      this.saveManager.save(this.state);
      this.notifyUiState();
      this.startInfinityLoopDance();
    });

    EventBus.on('use-solar-prism', () => {
      if ((this.state.solarPrismCount || 0) <= 0) {
        EventBus.emit('toast', { message: 'No Solar Prisms in inventory!' });
        return;
      }
      this.state.solarPrismCount = Math.max(0, (this.state.solarPrismCount || 0) - 1);
      this.saveManager.save(this.state);
      this.notifyUiState();
      this.startSunsetSpiralDance(true);
    });

    EventBus.on('use-star-compass', () => {
      if ((this.state.starCompassCount || 0) <= 0) {
        EventBus.emit('toast', { message: 'No Star Compasses in inventory!' });
        return;
      }
      this.state.starCompassCount = Math.max(0, (this.state.starCompassCount || 0) - 1);
      this.saveManager.save(this.state);
      this.notifyUiState();
      this.startCatConstellationDance();
    });

    EventBus.on('apply-cat-perfume', ({ screenX, screenY, catId }: { screenX?: number; screenY?: number; catId?: string }) => {
      this.handleApplyPerfume(screenX, screenY, catId);
    });

    EventBus.on('perfume-drag-start', () => {
      const now = Date.now();
      for (const sprite of this.catSprites.values()) {
        const cat = sprite.cat;
        if (cat.stage !== 'kitten' && cat.stage !== 'adult') {
          cat.stage = 'adult';
          cat.growthProgress = 100;
        }
        const isEligible = cat.stage === 'adult' && (!cat.lastPerfumeTimestamp || now - cat.lastPerfumeTimestamp >= CAT_PERFUME_COOLDOWN_MS);
        if (isEligible) {
          sprite.setPerfumeTargetHighlight(true);
        }
      }
    });

    EventBus.on('perfume-drag-end', () => {
      for (const sprite of this.catSprites.values()) {
        sprite.setPerfumeTargetHighlight(false);
      }
    });

    EventBus.on('fence-layout-changed', ({ layout }: { layout: FenceLayout }) => {
      this.state.fenceLayout = layout;
      this.saveManager.save(this.state);
      this.drawCurrentArea();
      this.notifyUiState();
      sound.playPop();
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
      this.weatherAndLighting.resetWeatherParticles();
      this.saveManager.save(this.state);
      this.notifyUiState();
    });

    EventBus.on('export-save-requested', () => {
      this.saveManager.exportToFile(this.state);
      EventBus.emit('toast', { message: '💾 savegame.json downloaded!' });
    });

    EventBus.on('import-save-requested', async ({ file }: { file: File }) => {
      try {
        const loaded = await this.saveManager.importFromFile(file);
        if (loaded && Array.isArray(loaded.cats)) {
          this.state = loaded;
          this.saveManager.save(this.state);
          this.drawCurrentArea();
          this.spawnCatsInCurrentArea();
          this.notifyUiState();
          sound.playAdoptFanfare();
          EventBus.emit('toast', { message: '✅ Save file loaded successfully!' });
        } else {
          EventBus.emit('toast', { message: '❌ Invalid save file structure.' });
        }
      } catch (err) {
        console.error('Save import failed', err);
        EventBus.emit('toast', { message: '❌ Failed to read save file.' });
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
        EventBus.emit('toast', { message: `Need ${nextUpgrade.costCarePoints.toLocaleString()} 💗 for this upgrade.` });
      }
    });

    EventBus.on('trigger-conga-parade', () => {
      this.startCongaParade();
    });
  }

  private focusOnCat(catId: string): void {
    const sprite = this.catSprites.get(catId);
    if (!sprite) return;

    sound.playSparkle();
    sprite.showEmote('✨');

    // Happy bounce animation
    this.tweens.add({
      targets: sprite,
      y: sprite.y - 20,
      duration: 180,
      yoyo: true,
      repeat: 1,
      ease: 'Back.easeOut',
    });

    // Glowing focus beacon pulse circle
    const beacon = this.add.graphics();
    beacon.setDepth(sprite.depth + 10);
    beacon.setPosition(sprite.x, sprite.y);
    beacon.lineStyle(3, 0xf59e0b, 0.95);
    beacon.strokeCircle(0, 0, 20);

    this.tweens.add({
      targets: beacon,
      scaleX: 2.4,
      scaleY: 2.4,
      alpha: 0,
      duration: 900,
      ease: 'Cubic.easeOut',
      onComplete: () => beacon.destroy(),
    });
  }

  private switchArea(area: CatArea): void {
    if (!this.state.areas[area]?.unlocked) return;
    if (this.currentArea === area) return;
    this.currentArea = area;
    sound.playTap();

    const newAreaWalkable = this.areaRenderer.walkableBounds(area);
    this.toolController.onAreaSwitched(newAreaWalkable);
    this.drawCurrentArea();
    this.spawnCatsInCurrentArea();

    for (const box of this.activeDeliveryBoxes) {
      if (box && box.active) {
        box.x = newAreaWalkable.centerX + (Math.random() - 0.5) * (newAreaWalkable.width * 0.3);
        box.y = newAreaWalkable.centerY + (Math.random() - 0.5) * (newAreaWalkable.height * 0.2);
        box.setDepth(box.y + 25);
      }
    }

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
    const cost = getAreaCapacityUpgradeCost(areaState, info.baseCapacity);

    if (!this.love.spend(cost)) {
      EventBus.emit('toast', { message: `Need ${cost.toLocaleString()} 💗 to upgrade ${info.label} capacity.` });
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

  private spawnDeliveryBox(delivery: DeliveryData): void {
    const bounds = this.areaRenderer.walkableBounds(this.currentArea);
    const targetX = bounds.centerX + (Math.random() - 0.5) * (bounds.width * 0.45);
    const targetY = bounds.centerY + (Math.random() - 0.5) * (bounds.height * 0.35);

    const box = new DeliveryBox(this, targetX, targetY, {
      ...delivery,
      onOpen: () => {
        const idx = this.activeDeliveryBoxes.indexOf(box);
        if (idx >= 0) this.activeDeliveryBoxes.splice(idx, 1);
        delivery.onOpen();
      },
    });

    this.activeDeliveryBoxes.push(box);
    sound.playPop();
    EventBus.emit('toast', { message: '📦 Delivery arrived!' });
  }

  private tryBuyFurniture(furnitureId: string): void {
    const item = FURNITURE_CATALOG.find((f) => f.id === furnitureId);
    if (!item) return;

    if (this.state.furniture.includes(furnitureId)) {
      EventBus.emit('toast', { message: `You already placed ${item.name} in the sanctuary!` });
      return;
    }

    if (!this.love.spend(item.loveCost)) {
      EventBus.emit('toast', { message: `Need ${item.loveCost.toLocaleString()} 💗 to purchase ${item.name}.` });
      return;
    }

    EventBus.emit('love-changed', { love: this.love.love });
    this.spawnDeliveryBox({
      type: 'furniture',
      id: furnitureId,
      name: item.name,
      emoji: '🛋️',
      area: item.area,
      onOpen: () => {
        this.state.furniture.push(furnitureId);
        this.saveManager.save(this.state);
        this.drawCurrentArea();
        this.notifyUiState();
        sound.playAdoptFanfare();
        EventBus.emit('toast', { message: `🎉 Placed ${item.name} in ${item.area.toUpperCase()}!` });
      },
    });
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
    const cat = generateRareCat(rareType, { day: this.state.day, usedNames, existingCats: this.state.cats });
    cat.area = targetArea;
    this.state.cats.push(cat);

    if (targetArea === this.currentArea) {
      this.spawnCatSprite(cat, this.areaRenderer.walkableBounds(this.currentArea));
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
    applyAutomationThresholds(cat, this.state.machines);
    this.journal.log(cat, `Moved from ${AREA_INFO_MAP[prevArea].label} to ${AREA_INFO_MAP[toArea].label}.`);
    sound.playTap();
    this.saveManager.save(this.state);

    if (prevArea === this.currentArea || toArea === this.currentArea) {
      this.spawnCatsInCurrentArea();
    }

    this.notifyUiState();
  }

  private handleRehomeCat(catId: string): void {
    const catIndex = this.state.cats.findIndex((c) => c.id === catId);
    if (catIndex === -1) return;
    const cat = this.state.cats[catIndex];
    const reward = calculateRehomeLove(cat);
    this.love.add(reward.total);
    this.state.totalLoveEarned += reward.total;
    this.milestones.addTokens(reward.stars);
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
      message: `🏡 ${cat.name} found a loving forever home! (+${reward.total.toLocaleString()} 💗 Love, +${reward.stars} ⭐ Stars)`,
    });

    if (this.state.cats.length === 0) {
      const penalty = Math.floor(this.state.love / 2);
      this.state.love = Math.max(0, this.state.love - penalty);

      const bounds = this.areaRenderer.areaBounds();
      const usedNames = new Set(this.state.cats.map((c) => c.name));

      for (let i = 0; i < 2; i++) {
        const newCat = generateCat({ day: this.state.day, usedNames, existingCats: this.state.cats, stage: 'adult' });
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
      this.state.strayArrivalDueAt = Date.now() + 60 * 60 * 1000;
    }

    this.saveManager.save(this.state);
    this.notifyUiState();
  }

  private handleRehomeCatsBatch(catIds: string[]): void {
    if (!catIds.length) return;
    let totalLove = 0;
    let totalStars = 0;
    let count = 0;

    for (const catId of catIds) {
      const catIndex = this.state.cats.findIndex((c) => c.id === catId);
      if (catIndex === -1) continue;
      const cat = this.state.cats[catIndex];
      const reward = calculateRehomeLove(cat);
      totalLove += reward.total;
      totalStars += reward.stars;
      count++;

      this.state.cats.splice(catIndex, 1);
      const sprite = this.catSprites.get(catId);
      if (sprite) {
        sprite.destroy();
        this.catSprites.delete(catId);
      }
    }

    this.refreshActiveCatSpriteList();

    if (count === 0) return;

    this.love.add(totalLove);
    this.state.totalLoveEarned += totalLove;
    this.milestones.addTokens(totalStars);
    this.state.totalRehomedCats = (this.state.totalRehomedCats || 0) + count;
    this.state.totalRehomeLoveEarned = (this.state.totalRehomeLoveEarned || 0) + totalLove;

    sound.playAdoptFanfare();
    EventBus.emit('toast', {
      message: `🏡 ${count} cats found loving forever homes! (+${totalLove.toLocaleString()} 💗, +${totalStars} ⭐)`,
    });

    if (this.state.cats.length === 0) {
      const penalty = Math.floor(this.state.love / 2);
      this.state.love = Math.max(0, this.state.love - penalty);

      const bounds = this.areaRenderer.areaBounds();
      const usedNames = new Set(this.state.cats.map((c) => c.name));

      for (let i = 0; i < 2; i++) {
        const newCat = generateCat({ day: this.state.day, usedNames, existingCats: this.state.cats, stage: 'adult' });
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
        message: `🏠 The sanctuary was empty… two cats wandered in, but it cost you ${penalty.toLocaleString()} 💗 love.`,
      });
    } else if (this.state.cats.length < 2 && !this.state.strayArrivalDueAt) {
      this.state.strayArrivalDueAt = Date.now() + 60 * 60 * 1000;
    }

    this.saveManager.save(this.state);
    this.notifyUiState();
  }

  private handleInstantGrowCat(catId: string, cost: number): void {
    const cat = this.state.cats.find((c) => c.id === catId);
    if (!cat || cat.stage === 'adult') return;

    if (this.love.love < cost) {
      EventBus.emit('toast', { message: `Not enough Care Points. Need ${cost.toLocaleString()} 💗.` });
      return;
    }

    this.love.spend(cost);
    EventBus.emit('love-changed', { love: this.love.love });

    const evo = this.growth.instantGrow(cat);
    if (evo) {
      const sprite = this.catSprites.get(catId);
      if (sprite) {
        sprite.refreshVisuals();
        sprite.showEmote('✨');
      }
      sound.playSparkle();
      this.saveManager.save(this.state);
      this.notifyUiState();
    }
  }

  private handleApplyPerfume(screenX?: number, screenY?: number, catId?: string): void {
    if ((this.state.catPerfumeCount || 0) <= 0) {
      EventBus.emit('toast', { message: '🌸 Buy Cat Perfume in the Shop first!' });
      return;
    }

    let targetSprite: CatSprite | null = null;

    if (catId) {
      targetSprite = this.catSprites.get(catId) || null;
    } else if (screenX !== undefined && screenY !== undefined) {
      const canvas = this.game.canvas;
      const rect = canvas.getBoundingClientRect();
      const scaleX = this.scale.width / rect.width;
      const scaleY = this.scale.height / rect.height;
      const worldX = (screenX - rect.left) * scaleX;
      const worldY = (screenY - rect.top) * scaleY;

      let closestAdultDist = 200;
      let closestAdultSprite: CatSprite | null = null;

      for (const [, sprite] of this.catSprites) {
        if (!sprite.active) continue;
        if (sprite.cat.stage !== 'kitten' && sprite.cat.stage !== 'adult') {
          sprite.cat.stage = 'adult';
          sprite.cat.growthProgress = 100;
        }
        if (sprite.cat.stage === 'adult') {
          const dist = Math.hypot(sprite.x - worldX, sprite.y - worldY);
          if (dist < closestAdultDist) {
            closestAdultDist = dist;
            closestAdultSprite = sprite;
          }
        }
      }

      if (closestAdultSprite) {
        targetSprite = closestAdultSprite;
      } else {
        let closestAnyDist = 250;
        let closestAnySprite: CatSprite | null = null;

        for (const [, sprite] of this.catSprites) {
          if (!sprite.active) continue;
          const dist = Math.hypot(sprite.x - worldX, sprite.y - worldY);
          if (dist < closestAnyDist) {
            closestAnyDist = dist;
            closestAnySprite = sprite;
          }
        }

        if (closestAnySprite) {
          if (closestAnySprite.cat.stage !== 'kitten') {
            closestAnySprite.cat.stage = 'adult';
            closestAnySprite.cat.growthProgress = 100;
            targetSprite = closestAnySprite;
          } else {
            EventBus.emit('toast', { message: `🍼 ${closestAnySprite.cat.name} is still a kitten and too young for Cat Perfume!` });
            sound.playPop();
            return;
          }
        }
      }
    }

    if (!targetSprite) {
      EventBus.emit('toast', { message: '🌸 Drop the perfume bottle over an adult cat!' });
      sound.playPop();
      return;
    }

    const cat = targetSprite.cat;
    cat.stage = 'adult';
    cat.growthProgress = 100;

    const now = Date.now();
    const elapsed = now - (cat.lastPerfumeTimestamp || 0);
    if (cat.lastPerfumeTimestamp && elapsed < CAT_PERFUME_COOLDOWN_MS) {
      const minsLeft = Math.ceil((CAT_PERFUME_COOLDOWN_MS - elapsed) / 60000);
      EventBus.emit('toast', { message: `🌸 ${cat.name} is still smelling sweet! Try again in ${minsLeft}m.` });
      sound.playPop();
      return;
    }

    this.state.catPerfumeCount = Math.max(0, (this.state.catPerfumeCount || 1) - 1);
    cat.lastPerfumeTimestamp = now;
    this.saveManager.save(this.state);
    this.notifyUiState();

    targetSprite.activatePerfumeFrenzy(CAT_PERFUME_FRENZY_SECONDS);
    sound.playAdoptFanfare();
    this.createHeartBurst(targetSprite.x, targetSprite.y);
    EventBus.emit('toast', { message: `🌸 Applied Cat Perfume to ${cat.name}! 15s Breeding Frenzy started!` });
  }

  getAdultCatsInArea(area: CatArea): CatSprite[] {
    const list: CatSprite[] = [];
    for (const [, sprite] of this.catSprites) {
      if (sprite.active && sprite.cat.area === area) {
        if (sprite.cat.stage !== 'kitten') {
          if (sprite.cat.stage !== 'adult') {
            sprite.cat.stage = 'adult';
            sprite.cat.growthProgress = 100;
          }
          list.push(sprite);
        }
      }
    }
    return list;
  }

  triggerPerfumeBreeding(catA: Cat, catB: Cat, x: number, y: number): void {
    const key = `${catA.id}:${catB.id}`;
    const altKey = `${catB.id}:${catA.id}`;
    this.state.breedingCooldowns[key] = Date.now();
    this.state.breedingCooldowns[altKey] = Date.now();

    this.milestones.addTokens(1);
    this.saveManager.save(this.state);
    this.notifyUiState();

    const now = this.time.now;
    if (!this.lastPerfumeBondSoundTime || now - this.lastPerfumeBondSoundTime > 350) {
      this.lastPerfumeBondSoundTime = now;
      sound.playPop();
    }
    this.createHeartBurst(x, y);
    EventBus.emit('toast', { message: `🌸 ${catA.name} & ${catB.name} bonded in a perfume frenzy! (+1 Star ⭐)` });
  }

  createHeartBurst(x: number, y: number): void {
    for (let i = 0; i < 7; i++) {
      const emoji = Phaser.Math.RND.pick(['❤️', '💖', '💕', '✨', '🐾']);
      const text = this.add.text(
        x + Phaser.Math.Between(-14, 14),
        y + Phaser.Math.Between(-10, 10),
        emoji,
        { fontSize: `${Phaser.Math.Between(18, 26)}px` },
      ).setOrigin(0.5).setDepth(y + 120);

      this.tweens.add({
        targets: text,
        y: text.y - Phaser.Math.Between(35, 65),
        x: text.x + Phaser.Math.Between(-24, 24),
        alpha: { from: 1, to: 0 },
        scale: { from: 0.6, to: 1.35 },
        duration: 750,
        ease: 'Cubic.easeOut',
        onComplete: () => text.destroy(),
      });
    }
  }

  override update(time: number, delta: number): void {
    const deltaMs = time - this.lastTick;
    this.lastTick = time;
    const deltaSeconds = deltaMs / 1000;
    this.animTimer += deltaSeconds;

    const sprites = this.activeCatSpriteList;
    for (let i = 0; i < sprites.length; i++) {
      const sprite = sprites[i];
      if (sprite.active) {
        sprite.update(delta);
      }
    }

    this.toolController.update(deltaSeconds);
    this.weatherAndLighting.update(deltaSeconds, this.currentArea);

    this.weather.tick(deltaSeconds);
    const currentIsRain = this.weather.weather === 'rain';
    if (currentIsRain && !this.wasRaining) {
      if (!this.hasDoneRainDanceThisStorm) {
        this.hasDoneRainDanceThisStorm = true;
        this.startRainDance();
      }
    } else if (!currentIsRain && this.wasRaining) {
      this.hasDoneRainDanceThisStorm = false;
      if (this.isRainDanceActive) {
        this.endRainDance(false);
      }
    }
    this.wasRaining = currentIsRain;

    // Environmental Snow Trigger (Snowflake Mandala Dance)
    const currentIsSnow = this.weather.weather === 'snow';
    if (currentIsSnow && !this.wasSnowing) {
      if (!this.hasDoneSnowflakeDanceThisSnow) {
        this.hasDoneSnowflakeDanceThisSnow = true;
        this.startSnowflakeMandalaDance(false);
      }
    } else if (!currentIsSnow && this.wasSnowing) {
      this.hasDoneSnowflakeDanceThisSnow = false;
    }
    this.wasSnowing = currentIsSnow;

    // Environmental Sunset Trigger (Sunset Fibonacci Spiral)
    const currentIsSunset = this.weather.timeOfDay === 'sunset';
    if (currentIsSunset && !this.wasSunset) {
      if (!this.hasDoneSunsetDanceThisSunset) {
        this.hasDoneSunsetDanceThisSunset = true;
        this.startSunsetSpiralDance(false);
      }
    } else if (!currentIsSunset && this.wasSunset) {
      this.hasDoneSunsetDanceThisSunset = false;
    }
    this.wasSunset = currentIsSunset;

    // Rain Ritual Event Tick (duration of rain.mp3)
    if (this.isRainDanceActive) {
      this.rainDanceTimer -= deltaSeconds;
      if (this.rainDanceTimer <= 0) {
        this.endRainDance(true);
      }
    }

    // Active Dance Formation Duration Tick
    if (this.isDanceFormationActive) {
      this.danceFormationDuration -= deltaSeconds;
      if (this.danceFormationDuration <= 0) {
        this.endAnyActiveDance(true);
      }
    }

    // Conga Parade Event Tick (~every 10 minutes)
    if (this.isCongaParadeActive) {
      this.congaParadeDuration -= deltaSeconds;
      if (this.congaParadeDuration <= 0) {
        this.endCongaParade();
      }
    } else {
      this.congaParadeTimer -= deltaSeconds;
      if (this.congaParadeTimer <= 0) {
        this.startCongaParade();
      }
    }

    // Throttled Needs & Growth Processing (every 1000ms instead of every 16ms)
    this.needsTickAccumMs += deltaMs;
    if (this.needsTickAccumMs >= 1000) {
      const deltaMinutes = this.needsTickAccumMs / 60000;
      this.needsTickAccumMs = 0;

      for (let i = 0; i < this.state.cats.length; i++) {
        tickCatNeeds(this.state.cats[i], deltaMinutes, this.state.machines);
      }

      const evoEvents = this.growth.tickGrowth(this.state.cats, deltaMinutes);
      for (let i = 0; i < evoEvents.length; i++) {
        const sp = this.catSprites.get(evoEvents[i].cat.id);
        if (sp) sp.refreshVisuals();
      }

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
    }

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

      const strayResult = this.breeding.tickStraySafetyNet();
      if (strayResult) {
        if (strayResult.cat.area === this.currentArea) {
          this.spawnCatSprite(strayResult.cat, this.areaRenderer.walkableBounds(this.currentArea));
        }
        this.saveManager.save(this.state);
        this.notifyUiState();
      }

      const now = Date.now();
      const adultCountByArea: Record<string, number> = {};
      const catsMap = new Map<string, Cat>();
      for (let i = 0; i < this.state.cats.length; i++) {
        const c = this.state.cats[i];
        catsMap.set(c.id, c);
        if (c.stage === 'adult') {
          adultCountByArea[c.area] = (adultCountByArea[c.area] || 0) + 1;
        }
      }

      for (const [catId, sprite] of this.catSprites.entries()) {
        const cat = catsMap.get(catId);
        if (!cat || cat.stage !== 'adult' || (adultCountByArea[cat.area] || 0) < 2) {
          sprite.setBreedReady(false);
          continue;
        }
        let onCooldown = false;
        for (const key in this.state.breedingCooldowns) {
          if (key.includes(catId) && now - this.state.breedingCooldowns[key] < BREED_COOLDOWN_MS) {
            onCooldown = true;
            break;
          }
        }
        sprite.setBreedReady(!onCooldown);
      }
    }
  }

  private tickRelationshipsAndEvents(periodSeconds: number): void {
    const sleepingByArea: Record<string, Cat[]> = {};
    const playingByArea: Record<string, Cat[]> = {};
    const eatingByArea: Record<string, Cat[]> = {};

    for (let i = 0; i < this.state.cats.length; i++) {
      const c = this.state.cats[i];
      if (c.animationState === 'sleep') {
        (sleepingByArea[c.area] ||= []).push(c);
      } else if (c.animationState === 'play') {
        (playingByArea[c.area] ||= []).push(c);
      } else if (c.hunger > 80) {
        (eatingByArea[c.area] ||= []).push(c);
      }
    }

    for (const area in sleepingByArea) {
      const list = sleepingByArea[area];
      if (list.length >= 2) {
        const pairs = Math.min(3, Math.floor(list.length / 2));
        for (let k = 0; k < pairs; k++) {
          const idxA = Math.floor(Math.random() * list.length);
          let idxB = Math.floor(Math.random() * list.length);
          if (idxA === idxB) idxB = (idxA + 1) % list.length;
          this.relationships.nap(list[idxA], list[idxB]);
        }
      }
    }

    for (const area in playingByArea) {
      const list = playingByArea[area];
      if (list.length >= 2) {
        const pairs = Math.min(3, Math.floor(list.length / 2));
        for (let k = 0; k < pairs; k++) {
          const idxA = Math.floor(Math.random() * list.length);
          let idxB = Math.floor(Math.random() * list.length);
          if (idxA === idxB) idxB = (idxA + 1) % list.length;
          this.relationships.play(list[idxA], list[idxB]);
        }
      }
    }

    for (const area in eatingByArea) {
      const list = eatingByArea[area];
      if (list.length >= 2 && Math.random() < 0.3) {
        const idxA = Math.floor(Math.random() * list.length);
        let idxB = Math.floor(Math.random() * list.length);
        if (idxA === idxB) idxB = (idxA + 1) % list.length;
        this.relationships.eat(list[idxA], list[idxB]);
      }
    }

    this.relationships.updateAllBestFriends();

    const events = this.events_.tick(periodSeconds);
    for (let i = 0; i < events.length; i++) {
      EventBus.emit('toast', { message: events[i].message });
    }
    if (events.length > 0) {
      EventBus.emit('love-changed', { love: this.love.love });
    }
  }

  private startCongaParade(): void {
    const sprites = Array.from(this.catSprites.values()).filter((s) => s.active && !s.isCurrentlyDragged());
    if (sprites.length < 2) {
      this.congaParadeTimer = 60; // Retry in 1 min if fewer than 2 cats present
      return;
    }

    this.isCongaParadeActive = true;
    this.congaParadeDuration = 128; // 128 seconds (4x longer) of pure conga fun
    this.congaParadeTimer = 540 + Math.random() * 120; // 9-11 minutes until next parade

    sound.startCongaMusic();
    EventBus.emit('toast', { message: '🎉 Conga Parade! All cats are joining the Grand Conga Line! 🐾🎶' });

    this.spawnCelebrationConfetti();

    // Create a smooth snaking serpentine path through the area's walkable bounds
    const bounds = this.areaRenderer.walkableBounds(this.currentArea);
    const pad = 45;
    const l = bounds.left + pad;
    const r = bounds.right - pad;
    const t = bounds.top + pad;
    const b = bounds.bottom - pad;
    const mx = (l + r) / 2;
    const my = (t + b) / 2;

    const waypoints = [
      new Phaser.Math.Vector2(l, my - 25),
      new Phaser.Math.Vector2(mx - 35, t),
      new Phaser.Math.Vector2(r, my - 15),
      new Phaser.Math.Vector2(mx + 35, b),
      new Phaser.Math.Vector2(l + 30, b - 20),
      new Phaser.Math.Vector2(mx, my),
      new Phaser.Math.Vector2(r - 25, t + 25),
      new Phaser.Math.Vector2(l + 25, t + 25),
    ];

    const leader = sprites.find((s) => s.cat.stage === 'adult') || sprites[0];
    const ordered = [leader, ...sprites.filter((s) => s !== leader)];

    leader.startCongaLeader(waypoints);
    for (let i = 1; i < ordered.length; i++) {
      ordered[i].startCongaFollower(ordered[i - 1]);
    }
  }

  private endCongaParade(): void {
    if (!this.isCongaParadeActive) return;
    this.isCongaParadeActive = false;

    sound.stopCongaMusic();

    const participatingSprites = Array.from(this.catSprites.values()).filter((s) => s.active);
    const catCount = participatingSprites.length;
    const starsEarned = catCount * 10;

    for (const sprite of participatingSprites) {
      sprite.endCongaParade();
      sprite.cat.fun = 100;
      sprite.cat.happiness = Math.min(100, sprite.cat.happiness + 25);
      sprite.showEmote('⭐');
      sprite.refreshVisuals();
      this.spawnCatStarsBurst(sprite.x, sprite.y);
    }

    if (starsEarned > 0) {
      this.milestones.addTokens(starsEarned);
    }

    this.love.add(50);
    this.state.totalLoveEarned += 50;
    EventBus.emit('love-changed', { love: this.love.love });
    EventBus.emit('toast', { message: `🎊 Conga Parade complete! ${catCount} cats earned you +${starsEarned} ⭐ Stars! (+50 💗)` });
    this.spawnCelebrationConfetti();
    this.saveManager.save(this.state);
    this.notifyUiState();
  }

  private spawnCatStarsBurst(x: number, y: number): void {
    for (let i = 0; i < 3; i++) {
      const star = this.add.text(
        x + Phaser.Math.Between(-12, 12),
        y - 12 + Phaser.Math.Between(-6, 6),
        '⭐',
        { fontSize: '15px' }
      ).setOrigin(0.5).setDepth(99999);

      this.tweens.add({
        targets: star,
        y: y - 50 - Phaser.Math.Between(10, 25),
        x: star.x + Phaser.Math.Between(-20, 20),
        scaleX: 1.3,
        scaleY: 1.3,
        alpha: 0,
        duration: 850 + Phaser.Math.Between(0, 350),
        ease: 'Quad.easeOut',
        onComplete: () => star.destroy(),
      });
    }
  }

  private spawnCelebrationConfetti(): void {
    const bounds = this.areaRenderer.walkableBounds(this.currentArea);
    const colors = [0xff477e, 0xffd166, 0x06d6a0, 0x118ab2, 0x9b5de5, 0xf15bb5, 0xffffff];
    for (let i = 0; i < 30; i++) {
      const x = Phaser.Math.Between(bounds.left + 15, bounds.right - 15);
      const y = bounds.top - 15;
      const confetti = this.add.graphics();
      confetti.fillStyle(Phaser.Math.RND.pick(colors), 0.95);
      confetti.fillRoundedRect(-4, -4, 8, 8, 2);
      confetti.setPosition(x, y);
      confetti.setDepth(9999);

      this.tweens.add({
        targets: confetti,
        y: bounds.bottom - Phaser.Math.Between(10, 80),
        x: x + Phaser.Math.Between(-45, 45),
        rotation: Phaser.Math.Between(-8, 8),
        alpha: 0,
        duration: Phaser.Math.Between(1800, 2600),
        ease: 'Quad.easeIn',
        onComplete: () => confetti.destroy(),
      });
    }
  }

  private startRainDance(): void {
    const sprites = Array.from(this.catSprites.values()).filter((s) => s.active && !s.isCurrentlyDragged());
    if (sprites.length < 2) return;

    this.isRainDanceActive = true;

    // If a conga parade was in progress, stop it for the rain ritual
    if (this.isCongaParadeActive) {
      this.isCongaParadeActive = false;
      sound.stopCongaMusic();
    }

    const bounds = this.areaRenderer.walkableBounds(this.currentArea);
    const cx = bounds.centerX;
    const cy = bounds.centerY;

    // Distribute cats into at least 2 concentric rings so opposite directions are clearly visible
    const numCats = sprites.length;
    const maxRings = Math.max(2, Math.min(5, Math.ceil(Math.sqrt(numCats))));
    const maxRadius = Math.max(70, Math.min(bounds.width, bounds.height) / 2 - 35);
    const ringStep = (maxRadius - 45) / Math.max(1, maxRings - 1);

    const rings: CatSprite[][] = Array.from({ length: maxRings }, () => []);
    sprites.forEach((sprite, index) => {
      rings[index % maxRings].push(sprite);
    });

    rings.forEach((ringCats, ringIndex) => {
      if (ringCats.length === 0) return;
      const radius = 45 + ringIndex * ringStep;
      // Even ring index (0, 2, 4): Clockwise (+1); Odd ring index (1, 3): Counter-Clockwise (-1)
      const direction = ringIndex % 2 === 0 ? 1 : -1;
      const walkSpeed = 70; // Natural steady circular walk
      const omega = walkSpeed / radius;

      ringCats.forEach((catSprite, catIndex) => {
        const initialAngle = (catIndex / ringCats.length) * Math.PI * 2;
        catSprite.startRainDance(cx, cy, radius, initialAngle, direction, omega);
      });
    });

    // Play rain.mp3 as dedicated BGM (pausing ambient music) matching dance length to audio duration
    const duration = sound.startRainMusic(() => {
      if (this.isRainDanceActive) {
        this.endRainDance(true);
      }
    });
    this.rainDanceTimer = duration;

    EventBus.emit('toast', { message: '🌧️ The rain has begun! The cats perform their mystical concentric rain dance! 🌀🐾' });
  }

  private endRainDance(playDone = true): void {
    if (!this.isRainDanceActive) return;
    this.isRainDanceActive = false;
    sound.stopRainMusic(playDone);

    const participatingSprites = Array.from(this.catSprites.values()).filter((s) => s.active);
    const catCount = participatingSprites.length;
    const starsEarned = catCount * 10;

    for (const sprite of participatingSprites) {
      sprite.endRainDance();
      sprite.cat.fun = Math.min(100, sprite.cat.fun + 30);
      sprite.cat.happiness = Math.min(100, sprite.cat.happiness + 20);
      sprite.showEmote('⭐');
      sprite.refreshVisuals();
      if (playDone) {
        this.spawnCatStarsBurst(sprite.x, sprite.y);
      }
    }

    if (playDone) {
      if (starsEarned > 0) {
        this.milestones.addTokens(starsEarned);
      }
      this.love.add(25);
      this.state.totalLoveEarned += 25;
      EventBus.emit('love-changed', { love: this.love.love });
      EventBus.emit('toast', { message: `✨ The rain ritual concludes! ${catCount} cats earned you +${starsEarned} ⭐ Stars! (+25 💗)` });
      this.spawnCelebrationConfetti();
      this.saveManager.save(this.state);
      this.notifyUiState();
    }
  }

  private stopAnyConflictingRhythm(): void {
    if (this.isCongaParadeActive) {
      this.isCongaParadeActive = false;
      sound.stopCongaMusic();
    }
    if (this.isRainDanceActive) {
      this.isRainDanceActive = false;
      sound.stopRainMusic(false);
    }
    if (this.isDanceFormationActive) {
      this.endAnyActiveDance(false);
    }
    sound.stopRitualMusic(false);
  }

  private startSnowflakeMandalaDance(isConsumable = true): void {
    const sprites = Array.from(this.catSprites.values()).filter((s) => s.active && !s.isCurrentlyDragged());
    if (sprites.length < 2) return;

    this.stopAnyConflictingRhythm();
    this.isDanceFormationActive = true;
    this.activeDanceFormation = 'snowflake';

    const bounds = this.areaRenderer.walkableBounds(this.currentArea);
    const cx = bounds.centerX;
    const cy = bounds.centerY;
    const maxRadius = Math.max(70, Math.min(bounds.width, bounds.height) / 2 - 35);

    // 6 symmetrical snowflake arms
    sprites.forEach((sprite, index) => {
      const arm = index % 6;
      const armAngle = arm * (Math.PI / 3);
      const slot = Math.floor(index / 6);
      const dist = Math.min(maxRadius, 55 + slot * 35);
      sprite.startSnowflakeDance(cx, cy, armAngle, dist);
    });

    // Play snow.mp3 as dedicated BGM matching dance duration
    const duration = sound.startRitualMusic('snow.mp3', () => {
      if (this.isDanceFormationActive) {
        this.endAnyActiveDance(true);
      }
    });
    this.danceFormationDuration = duration;

    this.spawnCelebrationConfetti();
    EventBus.emit('toast', {
      message: isConsumable
        ? '❄️ The Snowflake Crystal glows! The cats perform a breathing Snowflake Mandala Dance! ❄️✨'
        : '❄️ Snow is falling! The cats form a mystical Snowflake Mandala! ❄️🐾',
    });
  }

  private startHeartFormationDance(): void {
    const sprites = Array.from(this.catSprites.values()).filter((s) => s.active && !s.isCurrentlyDragged());
    if (sprites.length < 2) return;

    this.stopAnyConflictingRhythm();
    this.isDanceFormationActive = true;
    this.activeDanceFormation = 'heart';

    const bounds = this.areaRenderer.walkableBounds(this.currentArea);
    const cx = bounds.centerX;
    const cy = bounds.centerY;

    // Distribute evenly along cardioid curve
    const n = sprites.length;
    sprites.forEach((sprite, index) => {
      const u = (index / n) * Math.PI * 2;
      sprite.startHeartFormation(cx, cy, u);
    });

    // Play love.mp3 as dedicated BGM matching dance duration
    const duration = sound.startRitualMusic('love.mp3', () => {
      if (this.isDanceFormationActive) {
        this.endAnyActiveDance(true);
      }
    });
    this.danceFormationDuration = duration;

    this.spawnCelebrationConfetti();
    EventBus.emit('toast', {
      message: '💖 The Catnip Heart Wand pulses! All cats unite in a giant pulsating Heart Formation! 🐾💕',
    });
  }

  private startInfinityLoopDance(): void {
    const sprites = Array.from(this.catSprites.values()).filter((s) => s.active && !s.isCurrentlyDragged());
    if (sprites.length < 2) return;

    this.stopAnyConflictingRhythm();
    this.isDanceFormationActive = true;
    this.activeDanceFormation = 'infinity';

    const bounds = this.areaRenderer.walkableBounds(this.currentArea);
    const cx = bounds.centerX;
    const cy = bounds.centerY;

    const n = sprites.length;
    const evenCount = Math.ceil(n / 2);
    const oddCount = Math.max(1, Math.floor(n / 2));

    sprites.forEach((sprite, index) => {
      const isOffsetStream = index % 2 === 1;
      if (!isOffsetStream) {
        // Stream A: Forward loop (speed +1.9, slight tilt -0.12 rad)
        const evenIndex = Math.floor(index / 2);
        const u0 = (evenIndex / evenCount) * Math.PI * 2;
        sprite.startInfinityLoop(cx, cy, u0, 1.9, -0.12);
      } else {
        // Stream B: Offset Counter-running loop (speed -1.9, counter tilt +0.12 rad)
        const oddIndex = Math.floor(index / 2);
        const u0 = (oddIndex / oddCount) * Math.PI * 2;
        sprite.startInfinityLoop(cx, cy, u0, -1.9, 0.12);
      }
    });

    // Play infinity.mp3 as dedicated BGM matching dance duration
    const duration = sound.startRitualMusic('infinity.mp3', () => {
      if (this.isDanceFormationActive) {
        this.endAnyActiveDance(true);
      }
    });
    this.danceFormationDuration = duration;

    EventBus.emit('toast', {
      message: '♾️ The Infinity Metronome ticks! The cats race in dual offset counter-running Figure-8 Loops! ⚡🐾',
    });
  }

  private startSunsetSpiralDance(isConsumable = true): void {
    const sprites = Array.from(this.catSprites.values()).filter((s) => s.active && !s.isCurrentlyDragged());
    if (sprites.length < 2) return;

    this.stopAnyConflictingRhythm();
    this.isDanceFormationActive = true;
    this.activeDanceFormation = 'sunset';

    const bounds = this.areaRenderer.walkableBounds(this.currentArea);
    const cx = bounds.centerX;
    const cy = bounds.centerY;
    const maxRadius = Math.max(70, Math.min(bounds.width, bounds.height) / 2 - 35);

    const n = sprites.length;
    sprites.forEach((sprite, index) => {
      const r = 40 + (index / Math.max(1, n - 1)) * (maxRadius - 40);
      const baseAngle = (index / n) * Math.PI * 2.5;
      const omega = 0.9;
      sprite.startSunsetSpiral(cx, cy, r, baseAngle, omega);
    });

    // Play sun.mp3 as dedicated BGM matching dance duration
    const duration = sound.startRitualMusic('sun.mp3', () => {
      if (this.isDanceFormationActive) {
        this.endAnyActiveDance(true);
      }
    });
    this.danceFormationDuration = duration;

    EventBus.emit('toast', {
      message: isConsumable
        ? '🌅 The Solar Prism radiates golden light! The cats weave a Fibonacci Golden Spiral! 🌅✨'
        : '🌅 The golden hour begins! The cats form a harmonious Sunset Spiral! 🌇🎶',
    });
  }

  private startCatConstellationDance(): void {
    const sprites = Array.from(this.catSprites.values()).filter((s) => s.active && !s.isCurrentlyDragged());
    if (sprites.length < 2) return;

    this.stopAnyConflictingRhythm();
    this.isDanceFormationActive = true;
    this.activeDanceFormation = 'constellation';

    const bounds = this.areaRenderer.walkableBounds(this.currentArea);
    const cx = bounds.centerX;
    const cy = bounds.centerY;

    // Scale giant cat face to span 82% of the walkable room
    const scale = Math.min((bounds.width * 0.82) / 115, (bounds.height * 0.82) / 115);

    // Landmark positions corresponding to the pointed-ear & curved-cheek cat head silhouette:
    const baseLandmarks = [
      { x: -48, y: -44, emote: '👂' }, // Left Ear Tip
      { x: 48, y: -44, emote: '👂' },  // Right Ear Tip
      { x: -20, y: 7, emote: '👀' },   // Left Eye
      { x: 20, y: 7, emote: '👀' },    // Right Eye
      { x: 0, y: 55, emote: '🐾' },    // Bottom Chin Center
      { x: -55, y: 8, emote: '✨' },   // Left Cheek Apex
      { x: 55, y: 8, emote: '✨' },    // Right Cheek Apex
      { x: -28, y: -30, emote: '⭐' }, // Left Ear Inner Slope
      { x: 28, y: -30, emote: '⭐' },  // Right Ear Inner Slope
      { x: 0, y: -33, emote: '👑' },   // Forehead Crown Center
      { x: -50, y: -18, emote: '🌟' }, // Left Ear Outer Wall
      { x: 50, y: -18, emote: '🌟' },  // Right Ear Outer Wall
      { x: -38, y: 35, emote: '🐱' },  // Left Lower Jaw
      { x: 38, y: 35, emote: '🐱' },   // Right Lower Jaw
      { x: 0, y: 22, emote: '💖' },    // Nose Tip & Muzzle
      { x: -21, y: 49, emote: '✨' },  // Bottom Left Chin Curve
      { x: 21, y: 49, emote: '✨' },   // Bottom Right Chin Curve
    ];

    sprites.forEach((sprite, index) => {
      const landmark = baseLandmarks[index % baseLandmarks.length];
      const targetX = cx + landmark.x * scale;
      const targetY = cy + landmark.y * scale;
      sprite.startConstellationFormation(targetX, targetY, landmark.emote);
    });

    // Play cat.mp3 as dedicated BGM matching dance duration
    const duration = sound.startRitualMusic('cat.mp3', () => {
      if (this.isDanceFormationActive) {
        this.endAnyActiveDance(true);
      }
    });
    this.danceFormationDuration = duration;

    this.spawnCelebrationConfetti();
    EventBus.emit('toast', {
      message: '🐱 The Star Compass points skyward! The cats outline a Giant Cat Constellation! 🌟🔮🐾',
    });
  }

  private endAnyActiveDance(playDone = true): void {
    if (!this.isDanceFormationActive) return;
    const danceName =
      this.activeDanceFormation === 'snowflake' ? 'Snowflake Mandala' :
      this.activeDanceFormation === 'heart' ? 'Heart Formation' :
      this.activeDanceFormation === 'infinity' ? 'Infinity Loop' :
      this.activeDanceFormation === 'sunset' ? 'Sunset Spiral' :
      this.activeDanceFormation === 'constellation' ? 'Cat Constellation' : 'Dance Ritual';

    this.isDanceFormationActive = false;
    this.activeDanceFormation = 'none';
    sound.stopRitualMusic(playDone);

    const participatingSprites = Array.from(this.catSprites.values()).filter((s) => s.active);
    const catCount = participatingSprites.length;
    const starsEarned = catCount * 10;

    for (const sprite of participatingSprites) {
      sprite.endActiveDance();
      sprite.cat.fun = Math.min(100, sprite.cat.fun + 35);
      sprite.cat.happiness = Math.min(100, sprite.cat.happiness + 25);
      sprite.showEmote('⭐');
      sprite.refreshVisuals();
      if (playDone) {
        this.spawnCatStarsBurst(sprite.x, sprite.y);
      }
    }

    if (playDone) {
      if (starsEarned > 0) {
        this.milestones.addTokens(starsEarned);
      }
      this.love.add(35);
      this.state.totalLoveEarned += 35;
      EventBus.emit('love-changed', { love: this.love.love });
      EventBus.emit('toast', { message: `✨ The ${danceName} concludes! ${catCount} cats earned you +${starsEarned} ⭐ Stars! (+35 💗)` });
      this.spawnCelebrationConfetti();
      this.saveManager.save(this.state);
      this.notifyUiState();
    }
  }

  getActiveDanceFormation(): string {
    return this.activeDanceFormation;
  }
}
