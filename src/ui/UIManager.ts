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
  private snowflakeWandCount = 0;
  private heartWandCount = 0;
  private infinityMetronomeCount = 0;
  private solarPrismCount = 0;
  private starCompassCount = 0;
  private currentFenceLayout: FenceLayout = 'none';
  private plinkoUpgrades: Record<string, number> = {};

  constructor(container: HTMLElement) {
    this.root = container;
    this.toastManager = new ToastManager(this.root);
    this.headerHud = new HeaderHud(this.root, {
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
      <div class="bag-panel-header">
        <span class="bag-panel-title"><span class="svg-inline">${SVG_ICONS.bag}</span> Items & Dances</span>
        <button type="button" class="bag-panel-close-btn" id="bag-close-btn">&times;</button>
      </div>
      <div class="bag-items-list">
        <!-- 1. Cat Perfume -->
        <div class="bag-item-row ${this.catPerfumeCount > 0 ? 'has-stock' : 'empty-stock'}" data-item="perfume" title="Apply to an adult cat for a 15s Breeding Frenzy!">
          <div class="bag-item-icon-wrap" style="background:#fce7f3;color:#be185d;">${SVG_ICONS.perfume}</div>
          <div class="bag-item-details">
            <span class="bag-item-name">Cat Perfume</span>
            <span class="bag-item-sub">Breeding Frenzy (+⭐)</span>
          </div>
          <button type="button" class="bag-action-pill ${this.catPerfumeCount > 0 ? 'use-pill' : 'buy-pill'}">
            ${this.catPerfumeCount > 0 ? `Use (x${this.catPerfumeCount})` : '+ Shop'}
          </button>
        </div>

        <!-- 2. Party Whistle -->
        <div class="bag-item-row ${this.congaWhistleCount > 0 ? 'has-stock' : 'empty-stock'}" data-item="whistle" title="Blow the whistle to lead all cats in a Grand Conga Line!">
          <div class="bag-item-icon-wrap" style="background:#ede9fe;color:#6d28d9;">${SVG_ICONS.whistle}</div>
          <div class="bag-item-details">
            <span class="bag-item-name">Party Whistle</span>
            <span class="bag-item-sub">Grand Conga Sprint</span>
          </div>
          <button type="button" class="bag-action-pill ${this.congaWhistleCount > 0 ? 'use-pill' : 'buy-pill'}">
            ${this.congaWhistleCount > 0 ? `Use (x${this.congaWhistleCount})` : '+ Shop'}
          </button>
        </div>

        <!-- 3. Snowflake Crystal -->
        <div class="bag-item-row ${this.snowflakeWandCount > 0 ? 'has-stock' : 'empty-stock'}" data-item="snowflake" title="Summon cats into a 6-pointed Snowflake Mandala Dance!">
          <div class="bag-item-icon-wrap" style="background:#e0f2fe;color:#0369a1;">${SVG_ICONS.snowflakeWand}</div>
          <div class="bag-item-details">
            <span class="bag-item-name">Snowflake Crystal</span>
            <span class="bag-item-sub">Mandala Dance ❄️</span>
          </div>
          <button type="button" class="bag-action-pill ${this.snowflakeWandCount > 0 ? 'use-pill' : 'buy-pill'}">
            ${this.snowflakeWandCount > 0 ? `Use (x${this.snowflakeWandCount})` : '+ Shop'}
          </button>
        </div>

        <!-- 4. Catnip Heart Wand -->
        <div class="bag-item-row ${this.heartWandCount > 0 ? 'has-stock' : 'empty-stock'}" data-item="heart" title="Assemble all cats into a giant pulsating Heart Formation!">
          <div class="bag-item-icon-wrap" style="background:#ffe4e6;color:#be123c;">${SVG_ICONS.heartWand}</div>
          <div class="bag-item-details">
            <span class="bag-item-name">Heart Wand</span>
            <span class="bag-item-sub">Pulsing Heart Dance 💖</span>
          </div>
          <button type="button" class="bag-action-pill ${this.heartWandCount > 0 ? 'use-pill' : 'buy-pill'}">
            ${this.heartWandCount > 0 ? `Use (x${this.heartWandCount})` : '+ Shop'}
          </button>
        </div>

        <!-- 5. Infinity Metronome -->
        <div class="bag-item-row ${this.infinityMetronomeCount > 0 ? 'has-stock' : 'empty-stock'}" data-item="infinity" title="Start a high-speed interlocking Figure-8 Infinity Loop!">
          <div class="bag-item-icon-wrap" style="background:#d1fae5;color:#047857;">${SVG_ICONS.infinityMetronome}</div>
          <div class="bag-item-details">
            <span class="bag-item-name">Infinity Metronome</span>
            <span class="bag-item-sub">Figure-8 Sprint ♾️</span>
          </div>
          <button type="button" class="bag-action-pill ${this.infinityMetronomeCount > 0 ? 'use-pill' : 'buy-pill'}">
            ${this.infinityMetronomeCount > 0 ? `Use (x${this.infinityMetronomeCount})` : '+ Shop'}
          </button>
        </div>

        <!-- 6. Solar Prism -->
        <div class="bag-item-row ${this.solarPrismCount > 0 ? 'has-stock' : 'empty-stock'}" data-item="solar" title="Weave an outward-expanding Fibonacci Golden Spiral!">
          <div class="bag-item-icon-wrap" style="background:#fef3c7;color:#b45309;">${SVG_ICONS.solarPrism}</div>
          <div class="bag-item-details">
            <span class="bag-item-name">Solar Prism</span>
            <span class="bag-item-sub">Golden Sunset Spiral 🌅</span>
          </div>
          <button type="button" class="bag-action-pill ${this.solarPrismCount > 0 ? 'use-pill' : 'buy-pill'}">
            ${this.solarPrismCount > 0 ? `Use (x${this.solarPrismCount})` : '+ Shop'}
          </button>
        </div>

        <!-- 7. Star Compass -->
        <div class="bag-item-row ${this.starCompassCount > 0 ? 'has-stock' : 'empty-stock'}" data-item="compass" title="Outline a Giant Cat Constellation on the sanctuary floor!">
          <div class="bag-item-icon-wrap" style="background:#f3e8ff;color:#7e22ce;">${SVG_ICONS.starCompass}</div>
          <div class="bag-item-details">
            <span class="bag-item-name">Star Compass</span>
            <span class="bag-item-sub">Cat Constellation 🐱✨</span>
          </div>
          <button type="button" class="bag-action-pill ${this.starCompassCount > 0 ? 'use-pill' : 'buy-pill'}">
            ${this.starCompassCount > 0 ? `Use (x${this.starCompassCount})` : '+ Shop'}
          </button>
        </div>
      </div>
    `;

    this.bagPanel.querySelector('#bag-close-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sound.playTap();
      this.isBagOpen = false;
      this.updateBagPanel();
    });

    this.bagPanel.querySelectorAll('.bag-item-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const itemType = (row as HTMLElement).dataset.item;
        sound.playTap();

        if (itemType === 'perfume') {
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
        snowflakeWandCount?: number;
        heartWandCount?: number;
        infinityMetronomeCount?: number;
        solarPrismCount?: number;
        starCompassCount?: number;
        plinkoUpgrades?: Record<string, number>;
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
        this.snowflakeWandCount = payload.snowflakeWandCount ?? 0;
        this.heartWandCount = payload.heartWandCount ?? 0;
        this.infinityMetronomeCount = payload.infinityMetronomeCount ?? 0;
        this.solarPrismCount = payload.solarPrismCount ?? 0;
        this.starCompassCount = payload.starCompassCount ?? 0;
        this.currentFenceLayout = payload.fenceLayout ?? 'none';
        this.plinkoUpgrades = payload.plinkoUpgrades ?? {};

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
