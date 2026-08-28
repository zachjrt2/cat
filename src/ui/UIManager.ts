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
  private perfumeBtn!: HTMLButtonElement;

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
    this.buildPerfumeButton();
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

  private buildPerfumeButton(): void {
    const btn = document.createElement('button');
    btn.className = 'perfume-hud-btn';
    btn.id = 'perfume-hud-btn';
    btn.style.display = this.catPerfumeCount > 0 ? 'flex' : 'none';
    btn.innerHTML = `
      <span class="perfume-btn-icon">${SVG_ICONS.perfume}</span>
      <span class="perfume-count-badge" id="perfume-count-badge">x${this.catPerfumeCount}</span>
    `;
    btn.title = 'Drag & drop onto an adult cat for a 10s Breeding Frenzy!';

    let isDragging = false;
    let ghostEl: HTMLElement | null = null;

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging || !ghostEl) return;
      ghostEl.style.left = `${e.clientX - 24}px`;
      ghostEl.style.top = `${e.clientY - 24}px`;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isDragging) return;
      isDragging = false;
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      if (ghostEl) {
        ghostEl.remove();
        ghostEl = null;
      }
      EventBus.emit('perfume-drag-end', {});
      EventBus.emit('apply-cat-perfume', { screenX: e.clientX, screenY: e.clientY });
    };

    btn.addEventListener('pointerdown', (e: PointerEvent) => {
      if (this.catPerfumeCount <= 0) return;
      sound.playTap();
      isDragging = true;
      EventBus.emit('perfume-drag-start', {});

      ghostEl = document.createElement('div');
      ghostEl.className = 'perfume-drag-ghost';
      ghostEl.innerHTML = SVG_ICONS.perfume;
      ghostEl.style.left = `${e.clientX - 24}px`;
      ghostEl.style.top = `${e.clientY - 24}px`;
      document.body.appendChild(ghostEl);

      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    });

    this.root.appendChild(btn);
    this.perfumeBtn = btn;
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
        this.currentFenceLayout = payload.fenceLayout ?? 'none';
        this.plinkoUpgrades = payload.plinkoUpgrades ?? {};

        this.headerHud.updateTokens(this.currentTokens);
        this.headerHud.updateAreas(this.areasState, this.currentArea, this.catsList);

        if (this.perfumeBtn) {
          this.perfumeBtn.style.display = this.catPerfumeCount > 0 ? 'flex' : 'none';
          const badge = this.perfumeBtn.querySelector('#perfume-count-badge');
          if (badge) badge.textContent = `x${this.catPerfumeCount}`;
        }
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
          <span><b>+${summary.loveEarned.toLocaleString()}</b> Care Points</span>
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
