import Phaser from 'phaser';
import type { Cat, CatArea, FenceLayout, GameState, RareCatType, ToolType } from '../data/types';
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
import { CatSprite, type AvailableMachineInfo } from '../entities/CatSprite';
import { AUTOSAVE_INTERVAL_MS, AREA_INFO_MAP, FURNITURE_CATALOG, RARE_SUMMONS, OFFLINE_STAR_UPGRADES, calculateRehomeLove, getAreaCapacityUpgradeCost, CAT_PERFUME_COST, CAT_PERFUME_COOLDOWN_MS, CAT_PERFUME_FRENZY_SECONDS } from '../data/constants';
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
  private lastTick = 0;
  private lastPerfumeBondSoundTime = 0;
  private relationshipTickAccum = 0;
  private onlineProgressionAccumMs = 0;
  private animTimer = 0;

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
      const selectedTool = this.toolController.getSelectedTool();
      if (selectedTool) {
        this.toolController.interactWithCat(cat, sprite, selectedTool);
      } else {
        this.dragDropManager.onCatPointerDown(cat, sprite, ptr);
      }
    });

    this.catSprites.set(cat.id, sprite);
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
        EventBus.emit('toast', { message: `Not enough Care Points! Need ${cost} 💗.` });
      }
    });

    EventBus.on('buy-furniture', ({ furnitureId }: { furnitureId: string }) => {
      this.tryBuyFurniture(furnitureId);
    });

    EventBus.on('buy-machine', ({ machineId }: { machineId: string }) => {
      if (this.automation.buyMachine(machineId)) {
        this.saveManager.save(this.state);
        this.drawCurrentArea();
        this.refreshCatMachines();
        this.notifyUiState();
      }
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
        this.state.catPerfumeCount = (this.state.catPerfumeCount || 0) + 1;
        this.saveManager.save(this.state);
        this.notifyUiState();
        sound.playPop();
        EventBus.emit('toast', { message: `Purchased Cat Perfume! (${this.state.catPerfumeCount} in stock)` });
      } else {
        EventBus.emit('toast', { message: `Need ${CAT_PERFUME_COST} 💗 Care Points to buy Cat Perfume.` });
        sound.playPop();
      }
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
        EventBus.emit('toast', { message: `Need ${nextUpgrade.costCarePoints.toLocaleString()} Care Points for this upgrade.` });
      }
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
    const deltaMinutes = deltaMs / 60000;
    const deltaSeconds = deltaMs / 1000;
    this.animTimer += deltaSeconds;

    for (const sprite of this.catSprites.values()) {
      if (sprite.active) {
        sprite.update(delta);
      }
    }

    this.toolController.update(deltaSeconds);
    this.weatherAndLighting.update(deltaSeconds, this.currentArea);

    for (const cat of this.state.cats) {
      tickCatNeeds(cat, deltaMinutes, this.state.machines);
    }

    const evoEvents = this.growth.tickGrowth(this.state.cats, deltaMinutes);
    for (const evo of evoEvents) {
      const sp = this.catSprites.get(evo.cat.id);
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
      for (const [catId, sprite] of this.catSprites.entries()) {
        const cat = this.state.cats.find((c) => c.id === catId);
        if (!cat || cat.stage !== 'adult') { sprite.setBreedReady(false); continue; }
        const hasPartner = this.state.cats.some(
          (c) => c.id !== catId && c.stage === 'adult' && c.area === cat.area,
        );
        if (!hasPartner) { sprite.setBreedReady(false); continue; }
        const onCooldown = Object.entries(this.state.breedingCooldowns).some(([key, ts]) => {
          return key.includes(catId) && now - ts < BREED_COOLDOWN_MS;
        });
        sprite.setBreedReady(!onCooldown);
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

    const playing = this.state.cats.filter((c) => c.animationState === 'play');
    for (let i = 0; i < playing.length; i++) {
      for (let j = i + 1; j < playing.length; j++) {
        if (playing[i].area === playing[j].area) {
          this.relationships.play(playing[i], playing[j]);
        }
      }
    }

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
