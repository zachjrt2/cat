import type { Cat, CatArea, FenceLayout, GameState, Milestone, SanctuaryArea, TimeOfDay, ToolType, WeatherType } from '../data/types';
import { EventBus } from './EventBus';
import { sound } from '../systems/SoundManager';
import { SVG_ICONS } from './icons';
import { calculateRehomeLove } from '../data/constants';
import { ToastManager } from './components/ToastManager';
import { HeaderHud } from './components/HeaderHud';
import { SaveOptionsModal } from './modals/SaveOptionsModal';
import { ShopModal } from './modals/ShopModal';
import { RosterModal } from './modals/RosterModal';
import { CatInfoModal } from './modals/CatInfoModal';
import { PlinkoModal } from './PlinkoModal';
import { MinigamesModal } from './modals/MinigamesModal';

const TOOLS: { id: ToolType; svg: string; label: string }[] = [
  { id: 'food', svg: SVG_ICONS.food, label: 'Food' },
  { id: 'pet', svg: SVG_ICONS.pet, label: 'Pet' },
  { id: 'toy', svg: SVG_ICONS.toy, label: 'Toy' },
  { id: 'wash', svg: SVG_ICONS.wash, label: 'Wash' },
];

export class UIManager {
  private root: HTMLElement;
  private toastManager: ToastManager;
  private headerHud: HeaderHud;

  private rosterBtn!: HTMLButtonElement;
  private bagBtn!: HTMLButtonElement;
  private bagPanel!: HTMLElement;
  private isBagOpen = false;

  private selectedTool: ToolType | null = null;
  private currentLove = 0;
  private currentTokens = 0;
  private currentCatCount = 0;
  private currentTimeOfDay: TimeOfDay = 'day';
  private currentWeather: WeatherType = 'sunny';
  private previousTimeOfDay: TimeOfDay | null = null;
  private previousWeather: WeatherType | null = null;
  private currentArea: CatArea = 'yard';
  private areasState: Record<CatArea, SanctuaryArea> = {
    yard: { id: 'yard', unlocked: true, unlockThreshold: 0, capacity: 5 },
    shelter: { id: 'shelter', unlocked: false, unlockThreshold: 3, capacity: 15 },
    sunroom: { id: 'sunroom', unlocked: false, unlockThreshold: 8, capacity: 25 },
    cafe: { id: 'cafe', unlocked: false, unlockThreshold: 15, capacity: 40 },
  };
  private catsList: Cat[] = [];
  private ownedFurniture: string[] = [];
  private machinesState: Record<string, number> = {};
  private milestonesList: Milestone[] = [];
  private offlineStarLevel = 1;
  private catPerfumeCount = 0;
  private congaWhistleCount = 0;
  private rainTotemCount = 0;
  private snowflakeWandCount = 0;
  private heartWandCount = 0;
  private infinityMetronomeCount = 0;
  private solarPrismCount = 0;
  private starCompassCount = 0;
  private currentFenceLayout: FenceLayout = 'none';
  private plinkoUpgrades: Record<string, number> = {};
  private conquestState: import('../data/types').ConquestState = {
    clearedRegions: [],
    pendingLove: 0,
    pendingStars: 0,
    totalInvasionsLaunched: 0,
    totalBattlesWon: 0,
    totalBattlesLost: 0,
  };

  constructor(container: HTMLElement) {
    this.root = container;
    this.toastManager = new ToastManager(this.root);
    this.headerHud = new HeaderHud(this.root, {
      onOpenMinigames: () => this.openMinigamesModal(),
      onOpenPlinko: () => this.openPlinkoModal(),
      onOpenShop: (tab) => this.openShopModal(tab),
      onOpenSaveMenu: () => SaveOptionsModal.open(this.root),
    });

    this.buildToolbar();
    this.buildRosterButton();
    this.buildConsumablesBag();
    this.bindBusEvents();
  }

  private buildToolbar(): void {
    const bar = document.createElement('div');
    bar.className = 'toolbar';
    for (const tool of TOOLS) {
      const btn = document.createElement('button');
      btn.className = 'tool-btn';
      btn.dataset.tool = tool.id;
      btn.innerHTML = `<span class="tool-icon">${tool.svg}</span><span>${tool.label}</span>`;
      btn.addEventListener('click', () => this.selectTool(tool.id, btn));
      bar.appendChild(btn);
    }

    this.root.appendChild(bar);
  }

  private selectTool(tool: ToolType, btn: HTMLElement): void {
    const alreadySelected = this.selectedTool === tool;
    this.root.querySelectorAll('.tool-btn').forEach((el) => el.classList.remove('selected'));
    this.selectedTool = alreadySelected ? null : tool;
    if (!alreadySelected) btn.classList.add('selected');
    document.body.classList.toggle('tool-wash-active', this.selectedTool === 'wash');
    document.body.classList.toggle('tool-pet-active', this.selectedTool === 'pet');
    EventBus.emit('tool-selected', { tool: this.selectedTool });
  }

  private buildRosterButton(): void {
    const btn = document.createElement('button');
    btn.className = 'adopt-btn roster-btn';
    btn.id = 'roster-btn';
    btn.innerHTML = `<span class="roster-btn-icon">${SVG_ICONS.info}</span>`;
    btn.title = 'View Sanctuary Cats Roster & Details';
    btn.addEventListener('click', () => {
      sound.playTap();
      if (this.catsList.length > 0) {
        RosterModal.open(this.root, this.catsList, this.areasState, undefined, this.currentLove);
      } else {
        this.showToast('No cats in sanctuary yet.');
      }
    });

    this.root.appendChild(btn);
    this.rosterBtn = btn;
  }

  private buildConsumablesBag(): void {
    const wrap = document.createElement('div');
    wrap.className = 'bag-hud-wrap';
    wrap.id = 'bag-hud-wrap';

    const panel = document.createElement('div');
    panel.className = 'bag-consumables-panel';
    panel.id = 'bag-consumables-panel';

    const btn = document.createElement('button');
    btn.className = 'bag-hud-btn';
    btn.id = 'bag-hud-btn';
    btn.title = 'Open Items & Rituals Bag';
    btn.innerHTML = `
      <span class="bag-btn-icon">${SVG_ICONS.bag}</span>
      <span class="bag-count-badge" id="bag-total-count-badge">x0</span>
    `;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      sound.playTap();
      this.isBagOpen = !this.isBagOpen;
      this.updateBagPanel();
    });

    document.addEventListener('click', (e) => {
      if (this.isBagOpen && !wrap.contains(e.target as Node)) {
        this.isBagOpen = false;
        this.updateBagPanel();
      }
    });

    wrap.appendChild(panel);
    wrap.appendChild(btn);
    this.root.appendChild(wrap);

    this.bagBtn = btn;
    this.bagPanel = panel;
    this.updateBagPanel();
  }

  private updateBagPanel(): void {
    if (!this.bagBtn || !this.bagPanel) return;

    const totalCount =
      this.catPerfumeCount +
      this.congaWhistleCount +
      this.rainTotemCount +
      this.snowflakeWandCount +
      this.heartWandCount +
      this.infinityMetronomeCount +
      this.solarPrismCount +
      this.starCompassCount;

    const badge = this.bagBtn.querySelector('#bag-total-count-badge');
    if (badge) {
      badge.textContent = `x${totalCount}`;
      (badge as HTMLElement).style.display = totalCount > 0 ? 'block' : 'none';
    }

    this.bagBtn.classList.toggle('bag-open', this.isBagOpen);
    this.bagPanel.classList.toggle('open', this.isBagOpen);

    if (!this.isBagOpen) return;

    this.bagPanel.innerHTML = `
      <div class="bag-minimal-tray">
        <!-- 1. Cat Perfume -->
        <button type="button" class="bag-mini-tile ${this.catPerfumeCount > 0 ? 'in-stock' : 'out-of-stock'}" data-item="perfume" title="Cat Perfume (${this.catPerfumeCount} in stock) - Click to use or drag onto cat for 15s Breeding Frenzy!">
          <div class="bag-mini-icon" style="color:#db2777;">${SVG_ICONS.perfume}</div>
          <span class="bag-mini-count">${this.catPerfumeCount > 0 ? `x${this.catPerfumeCount}` : '+'}</span>
        </button>

        <!-- 2. Party Whistle -->
        <button type="button" class="bag-mini-tile ${this.congaWhistleCount > 0 ? 'in-stock' : 'out-of-stock'}" data-item="whistle" title="Party Whistle (${this.congaWhistleCount} in stock) - Grand Conga Line">
          <div class="bag-mini-icon" style="color:#7c3aed;">${SVG_ICONS.whistle}</div>
          <span class="bag-mini-count">${this.congaWhistleCount > 0 ? `x${this.congaWhistleCount}` : '+'}</span>
        </button>

        <!-- 3. Rainmaker Bell -->
        <button type="button" class="bag-mini-tile ${this.rainTotemCount > 0 ? 'in-stock' : 'out-of-stock'}" data-item="rain" title="Rainmaker Bell (${this.rainTotemCount} in stock) - Concentric Rain Dance">
          <div class="bag-mini-icon" style="color:#0284c7;">${SVG_ICONS.rainTotem}</div>
          <span class="bag-mini-count">${this.rainTotemCount > 0 ? `x${this.rainTotemCount}` : '+'}</span>
        </button>

        <!-- 4. Snowflake Crystal -->
        <button type="button" class="bag-mini-tile ${this.snowflakeWandCount > 0 ? 'in-stock' : 'out-of-stock'}" data-item="snowflake" title="Snowflake Crystal (${this.snowflakeWandCount} in stock) - Mandala Dance">
          <div class="bag-mini-icon" style="color:#0ea5e9;">${SVG_ICONS.snowflakeWand}</div>
          <span class="bag-mini-count">${this.snowflakeWandCount > 0 ? `x${this.snowflakeWandCount}` : '+'}</span>
        </button>

        <!-- 4. Catnip Heart Wand -->
        <button type="button" class="bag-mini-tile ${this.heartWandCount > 0 ? 'in-stock' : 'out-of-stock'}" data-item="heart" title="Heart Wand (${this.heartWandCount} in stock) - Pulsing Heart Dance">
          <div class="bag-mini-icon" style="color:#e11d48;">${SVG_ICONS.heartWand}</div>
          <span class="bag-mini-count">${this.heartWandCount > 0 ? `x${this.heartWandCount}` : '+'}</span>
        </button>

        <!-- 5. Infinity Metronome -->
        <button type="button" class="bag-mini-tile ${this.infinityMetronomeCount > 0 ? 'in-stock' : 'out-of-stock'}" data-item="infinity" title="Infinity Metronome (${this.infinityMetronomeCount} in stock) - Dual Infinity Sprint">
          <div class="bag-mini-icon" style="color:#059669;">${SVG_ICONS.infinityMetronome}</div>
          <span class="bag-mini-count">${this.infinityMetronomeCount > 0 ? `x${this.infinityMetronomeCount}` : '+'}</span>
        </button>

        <!-- 6. Solar Prism -->
        <button type="button" class="bag-mini-tile ${this.solarPrismCount > 0 ? 'in-stock' : 'out-of-stock'}" data-item="solar" title="Solar Prism (${this.solarPrismCount} in stock) - Tightening Fibonacci Spiral">
          <div class="bag-mini-icon" style="color:#d97706;">${SVG_ICONS.solarPrism}</div>
          <span class="bag-mini-count">${this.solarPrismCount > 0 ? `x${this.solarPrismCount}` : '+'}</span>
        </button>

        <!-- 7. Star Compass -->
        <button type="button" class="bag-mini-tile ${this.starCompassCount > 0 ? 'in-stock' : 'out-of-stock'}" data-item="compass" title="Star Compass (${this.starCompassCount} in stock) - Giant Cat Constellation">
          <div class="bag-mini-icon" style="color:#9333ea;">${SVG_ICONS.starCompass}</div>
          <span class="bag-mini-count">${this.starCompassCount > 0 ? `x${this.starCompassCount}` : '+'}</span>
        </button>
      </div>
    `;

    let wasPerfumeDragged = false;
    const perfumeTile = this.bagPanel.querySelector('.bag-mini-tile[data-item="perfume"]') as HTMLElement | null;
    if (perfumeTile && this.catPerfumeCount > 0) {
      let isDragging = false;
      let startX = 0;
      let startY = 0;
      let ghostEl: HTMLElement | null = null;

      const onPointerMove = (e: PointerEvent) => {
        if (!isDragging) {
          const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
          if (dist > 6) {
            isDragging = true;
            wasPerfumeDragged = true;
            this.isBagOpen = false;
            this.updateBagPanel();
            EventBus.emit('perfume-drag-start', {});

            ghostEl = document.createElement('div');
            ghostEl.className = 'perfume-drag-ghost';
            ghostEl.innerHTML = SVG_ICONS.perfume;
            ghostEl.style.left = `${e.clientX - 24}px`;
            ghostEl.style.top = `${e.clientY - 24}px`;
            document.body.appendChild(ghostEl);
          }
        }
        if (isDragging && ghostEl) {
          ghostEl.style.left = `${e.clientX - 24}px`;
          ghostEl.style.top = `${e.clientY - 24}px`;
        }
      };

      const onPointerUp = (e: PointerEvent) => {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        if (isDragging) {
          isDragging = false;
          if (ghostEl) {
            ghostEl.remove();
            ghostEl = null;
          }
          EventBus.emit('perfume-drag-end', {});
          EventBus.emit('apply-cat-perfume', { screenX: e.clientX, screenY: e.clientY });
        }
      };

      perfumeTile.addEventListener('pointerdown', (e: PointerEvent) => {
        if (this.catPerfumeCount <= 0) return;
        wasPerfumeDragged = false;
        startX = e.clientX;
        startY = e.clientY;
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
      });
    }

    this.bagPanel.querySelectorAll('.bag-mini-tile').forEach((tile) => {
      tile.addEventListener('click', (e) => {
        e.stopPropagation();
        const itemType = (tile as HTMLElement).dataset.item;
        sound.playTap();

        if (itemType === 'perfume') {
          if (wasPerfumeDragged) {
            wasPerfumeDragged = false;
            return;
          }
          if (this.catPerfumeCount > 0) {
            EventBus.emit('apply-cat-perfume', {});
            this.isBagOpen = false;
            this.updateBagPanel();
          } else {
            this.openShopModal('upgrades');
          }
        } else if (itemType === 'whistle') {
          if (this.congaWhistleCount > 0) {
            EventBus.emit('use-conga-whistle', {});
            this.isBagOpen = false;
            this.updateBagPanel();
          } else {
            this.openShopModal('upgrades');
          }
        } else if (itemType === 'rain') {
          if (this.rainTotemCount > 0) {
            EventBus.emit('use-rain-totem', {});
            this.isBagOpen = false;
            this.updateBagPanel();
          } else {
            this.openShopModal('upgrades');
          }
        } else if (itemType === 'snowflake') {
          if (this.snowflakeWandCount > 0) {
            EventBus.emit('use-snowflake-wand', {});
            this.isBagOpen = false;
            this.updateBagPanel();
          } else {
            this.openShopModal('upgrades');
          }
        } else if (itemType === 'heart') {
          if (this.heartWandCount > 0) {
            EventBus.emit('use-heart-wand', {});
            this.isBagOpen = false;
            this.updateBagPanel();
          } else {
            this.openShopModal('upgrades');
          }
        } else if (itemType === 'infinity') {
          if (this.infinityMetronomeCount > 0) {
            EventBus.emit('use-infinity-metronome', {});
            this.isBagOpen = false;
            this.updateBagPanel();
          } else {
            this.openShopModal('upgrades');
          }
        } else if (itemType === 'solar') {
          if (this.solarPrismCount > 0) {
            EventBus.emit('use-solar-prism', {});
            this.isBagOpen = false;
            this.updateBagPanel();
          } else {
            this.openShopModal('upgrades');
          }
        } else if (itemType === 'compass') {
          if (this.starCompassCount > 0) {
            EventBus.emit('use-star-compass', {});
            this.isBagOpen = false;
            this.updateBagPanel();
          } else {
            this.openShopModal('upgrades');
          }
        }
      });
    });
  }

  showToast(message: string): void {
    this.toastManager.showToast(message);
  }

  private bindBusEvents(): void {
    EventBus.on('love-changed', ({ love }: { love: number }) => {
      const prev = this.currentLove;
      this.currentLove = Math.floor(love);
      this.headerHud.updateLove(this.currentLove);
      if (this.currentLove > prev) sound.playCoin();
    });

    EventBus.on('tokens-changed', ({ tokens }: { tokens: number }) => {
      this.currentTokens = tokens;
      this.headerHud.updateTokens(this.currentTokens);
    });

    EventBus.on('cats-changed', ({ count }: { count: number }) => {
      this.currentCatCount = count;
      if (this.rosterBtn) {
        this.rosterBtn.title = `View Sanctuary Cats (${this.currentCatCount} cats)`;
      }
    });

    EventBus.on('time-changed', ({ timeOfDay }: { timeOfDay: TimeOfDay }) => {
      if (this.previousTimeOfDay && this.previousTimeOfDay !== timeOfDay) {
        const timeMessages: Record<TimeOfDay, string> = {
          morning: '🌅 The morning sun rises with a warm golden glow across the sanctuary.',
          day: '☀️ Midday sun shines bright and warm over the cats.',
          sunset: '🌇 Sunset arrives — soft twilight amber settles over the sanctuary.',
          night: '🌙 Night falls — peaceful stars twinkle above the sleeping cats.',
        };
        EventBus.emit('toast', { message: timeMessages[timeOfDay] || `🕒 Time shifted to ${timeOfDay}.` });
      }
      this.currentTimeOfDay = timeOfDay;
      this.previousTimeOfDay = timeOfDay;
    });

    EventBus.on('weather-changed', ({ weather }: { weather: WeatherType }) => {
      if (this.previousWeather && this.previousWeather !== weather) {
        const weatherMessages: Record<WeatherType, string> = {
          sunny: '☀️ The skies cleared up into a bright, warm sunny day!',
          rain: '🌧️ Gentle raindrops begin falling — cozy patter fills the air.',
          snow: '❄️ Magical snowflakes begin drifting softly through the air.',
        };
        EventBus.emit('toast', { message: weatherMessages[weather] || `🌦️ Weather changed to ${weather}.` });
      }
      this.currentWeather = weather;
      this.previousWeather = weather;
    });

    EventBus.on(
      'sanctuary-state',
      (payload: {
        areas: Record<CatArea, SanctuaryArea>;
        currentArea: CatArea;
        cats: Cat[];
        furniture: string[];
        machines?: Record<string, number>;
        milestones: Milestone[];
        tokens: number;
        offlineStarLevel?: number;
        fenceLayout?: FenceLayout;
        catPerfumeCount?: number;
        congaWhistleCount?: number;
        rainTotemCount?: number;
        snowflakeWandCount?: number;
        heartWandCount?: number;
        infinityMetronomeCount?: number;
        solarPrismCount?: number;
        starCompassCount?: number;
        plinkoUpgrades?: Record<string, number>;
        conquestState?: import('../data/types').ConquestState;
        pyramidRecord?: import('../data/types').PyramidRecord;
      }) => {


        this.areasState = payload.areas;
        this.currentArea = payload.currentArea;
        this.catsList = payload.cats;
        this.ownedFurniture = payload.furniture ?? [];
        this.machinesState = payload.machines ?? {};
        this.milestonesList = payload.milestones ?? [];
        this.currentTokens = payload.tokens ?? 0;
        this.offlineStarLevel = payload.offlineStarLevel ?? 1;
        this.catPerfumeCount = payload.catPerfumeCount ?? 0;
        this.congaWhistleCount = payload.congaWhistleCount ?? 0;
        this.rainTotemCount = payload.rainTotemCount ?? 0;
        this.snowflakeWandCount = payload.snowflakeWandCount ?? 0;
        this.heartWandCount = payload.heartWandCount ?? 0;
        this.infinityMetronomeCount = payload.infinityMetronomeCount ?? 0;
        this.solarPrismCount = payload.solarPrismCount ?? 0;
        this.starCompassCount = payload.starCompassCount ?? 0;
        this.currentFenceLayout = payload.fenceLayout ?? 'none';
        this.plinkoUpgrades = payload.plinkoUpgrades ?? {};
        if (payload.conquestState) this.conquestState = payload.conquestState;
        if (payload.pyramidRecord) this.pyramidRecord = payload.pyramidRecord;

        this.headerHud.updateTokens(this.currentTokens);
        this.headerHud.updateAreas(this.areasState, this.currentArea, this.catsList);
        this.updateBagPanel();
      },
    );

    EventBus.on('toast', ({ message }: { message: string }) => this.showToast(message));

    EventBus.on('cat-info', ({ cat }: { cat: Cat }) => {
      CatInfoModal.open(this.root, this.catsList, this.areasState, cat.id, this.currentLove);
    });

    EventBus.on('prompt-rehome-modal', ({ cat }: { cat: Cat }) => {
      const reward = calculateRehomeLove(cat);
      CatInfoModal.openRehomeConfirmModal(this.root, cat, reward, () => {});
    });

    EventBus.on('offline-summary', (summary: { minutesAway: number; loveEarned: number; starsEarned?: number; headlines: string[] }) => {
      this.showOfflineSummary(summary);
    });

    EventBus.on('launch-conquest', ({ regionIndex }: { regionIndex: number }) => {
      EventBus.emit('open-conquest', { regionIndex, cats: this.catsList, conquestState: this.conquestState });
    });
  }

  private pyramidRecord?: import('../data/types').PyramidRecord;

  private openMinigamesModal(defaultTab: 'conquest' | 'pyramid' | 'derby' | 'avalanche' = 'conquest'): void {
    MinigamesModal.open(
      this.root,
      {
        love: this.currentLove,
        tokens: this.currentTokens,
        cats: this.catsList,
        conquestState: this.conquestState,
        pyramidRecord: this.pyramidRecord,
      },
      defaultTab,
    );
  }


  private openShopModal(defaultTab: 'areas' | 'machines' | 'furniture' | 'milestones' | 'upgrades' = 'areas'): void {
    ShopModal.open(
      this.root,
      {
        love: this.currentLove,
        tokens: this.currentTokens,
        catCount: this.currentCatCount,
        areas: this.areasState,
        cats: this.catsList,
        furniture: this.ownedFurniture,
        machines: this.machinesState,
        milestones: this.milestonesList,
        offlineStarLevel: this.offlineStarLevel,
        catPerfumeCount: this.catPerfumeCount,
        congaWhistleCount: this.congaWhistleCount,
        rainTotemCount: this.rainTotemCount,
        snowflakeWandCount: this.snowflakeWandCount,
        heartWandCount: this.heartWandCount,
        infinityMetronomeCount: this.infinityMetronomeCount,
        solarPrismCount: this.solarPrismCount,
        starCompassCount: this.starCompassCount,
        fenceLayout: this.currentFenceLayout,
      },
      defaultTab,
    );
  }


  private openPlinkoModal(): void {
    const totalCapacity = Object.entries(this.areasState).reduce((acc, [, area]) => {
      return area.unlocked ? acc + area.capacity : acc;
    }, 0);
    const totalCats = this.catsList.length;

    if (totalCats >= totalCapacity) {
      this.showToast('🏠 Sanctuary is full! Expand or unlock an area first to play Plinko.');
      sound.playTap();
      return;
    }

    const gameState: GameState = {
      love: this.currentLove,
      adoptionTokens: this.currentTokens,
      cats: this.catsList,
      areas: this.areasState,
      furniture: this.ownedFurniture,
      machines: this.machinesState,
      breedingCooldowns: {},
      milestoneClaimedIds: [],
      offlineStarLevel: this.offlineStarLevel,
      catPerfumeCount: this.catPerfumeCount,
      fenceLayout: this.currentFenceLayout,
      plinkoUpgrades: this.plinkoUpgrades,
      totalPetsGiven: 0,
      totalLoveEarned: 0,
      totalRehomedCats: 0,
      totalRehomeLoveEarned: 0,
      timeOfDay: this.currentTimeOfDay,
      weather: this.currentWeather,
      day: 1,
      lastSavedAt: Date.now(),
      createdAt: Date.now(),
    };
    new PlinkoModal(this.root, gameState, this.currentArea).open();
  }

  private showOfflineSummary(summary: { minutesAway: number; loveEarned: number; starsEarned?: number; headlines: string[] }): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        sound.playTap();
        backdrop.remove();
      }
    });

    const modal = document.createElement('div');
    modal.className = 'modal offline-summary-modal';

    const starsHtml = (summary.starsEarned || 0) > 0
      ? `<div class="offline-stat-pill stars-pill">
          <span class="svg-inline">${SVG_ICONS.star}</span>
          <span><b>+${summary.starsEarned}</b> Stars for Plinko</span>
         </div>`
      : '';

    modal.innerHTML = `
      <h2>🏡 Welcome Back!</h2>
      <div class="subtitle" style="margin-bottom:10px;">You were away for ~<b>${summary.minutesAway}</b> minutes.</div>
      <div class="offline-rewards-row">
        <div class="offline-stat-pill cp-pill">
          <span class="svg-inline">${SVG_ICONS.heart}</span>
          <span><b>+${summary.loveEarned.toLocaleString()}</b></span>
        </div>
        ${starsHtml}
      </div>
      ${summary.headlines.length > 0
        ? `<div class="offline-headlines-box">
              <b>While you were away:</b>
              <ul>${summary.headlines.map((h) => `<li>${h}</li>`).join('')}</ul>
            </div>`
        : ''
      }
      <button class="modal-close" id="close-offline-btn" style="margin-top:16px;">Cozy On!</button>
    `;

    modal.querySelector('#close-offline-btn')?.addEventListener('click', () => {
      sound.playTap();
      backdrop.remove();
    });

    backdrop.appendChild(modal);
    this.root.appendChild(backdrop);
  }
}
