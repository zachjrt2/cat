import type { Cat, CatArea, GameState, Milestone, SanctuaryArea, TimeOfDay, ToolType, WeatherType } from '../data/types';
import { EventBus } from './EventBus';
import { sound } from '../systems/SoundManager';
import { CAT_SKINS, CAT_MARKINGS } from '../data/catAssets';
import { TRAITS } from '../data/traits';
import { SVG_ICONS } from './icons';
import { AREA_INFO_MAP, AUTOMATION_CATALOG, FURNITURE_CATALOG, OFFLINE_STAR_UPGRADES, calculateRehomeLove } from '../data/constants';
import { PlinkoModal } from './PlinkoModal';

const TOOLS: { id: ToolType; svg: string; label: string }[] = [
  { id: 'food', svg: SVG_ICONS.food, label: 'Food' },
  { id: 'pet', svg: SVG_ICONS.pet, label: 'Pet' },
  { id: 'brush', svg: SVG_ICONS.brush, label: 'Brush' },
  { id: 'toy', svg: SVG_ICONS.toy, label: 'Toy' },
  { id: 'wash', svg: SVG_ICONS.wash, label: 'Wash' },
];

const AREA_KEYS: CatArea[] = ['yard', 'shelter', 'sunroom', 'cafe'];

export class UIManager {
  private root: HTMLElement;
  private loveEl!: HTMLElement;
  private tokensEl!: HTMLElement;
  private timeWeatherBtn!: HTMLButtonElement;
  private soundBtn!: HTMLButtonElement;
  private rosterBtn!: HTMLButtonElement;
  private areaNavEl!: HTMLElement;
  private toastStack!: HTMLElement;

  private selectedTool: ToolType | null = null;
  private currentLove = 0;
  private currentTokens = 0;
  private currentCatCount = 0;
  private currentTimeOfDay: TimeOfDay = 'day';
  private currentWeather: WeatherType = 'sunny';
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

  constructor(container: HTMLElement) {
    this.root = container;
    this.buildTopHeader();
    this.buildToolbar();
    this.buildRosterButton();
    this.buildToastStack();
    this.bindBusEvents();
  }

  private buildTopHeader(): void {
    const header = document.createElement('header');
    header.className = 'top-header';
    this.root.appendChild(header);

    this.buildHud(header);
    this.buildAreaNav(header);
  }

  private buildHud(parent: HTMLElement): void {
    const hud = document.createElement('div');
    hud.className = 'hud';
    hud.innerHTML = `
      <div class="hud-stats-group">
        <div class="hud-love" title="Care Points (CP)">
          <span class="hud-icon heart-icon">${SVG_ICONS.heart}</span>
          <span id="love-value">0</span>
        </div>
        <div class="hud-tokens" id="tokens-pill" title="Stars (for Plinko!)">
          <span class="hud-icon star-icon">${SVG_ICONS.star}</span>
          <span id="tokens-value">0</span>
        </div>
      </div>

      <div class="hud-center-group">
        <button class="hud-weather-btn" id="time-weather-btn" title="Click to cycle Time / Weather">
          <span class="hud-weather-icons" id="time-weather-icon">${SVG_ICONS.day}</span>
          <span id="time-weather-text">Day</span>
        </button>
      </div>

      <div class="hud-actions">
        <button class="icon-btn plinko-btn" id="plinko-btn" title="⭐ Cat Plinko (Wager Stars to Discover Cats!)">
          ${SVG_ICONS.sparkle}
        </button>
        <button class="icon-btn shop-btn" id="shop-btn" title="Sanctuary Shop & Upgrades">
          ${SVG_ICONS.shop}
        </button>
        <button class="icon-btn" id="sound-toggle-btn" title="Sound Settings">
          ${sound.isSfxEnabled() || sound.isMusicEnabled() ? SVG_ICONS.soundOn : SVG_ICONS.soundOff}
        </button>
        <button class="icon-btn" id="save-menu-btn" title="Sanctuary Options">
          ${SVG_ICONS.menu}
        </button>
      </div>
    `;
    parent.appendChild(hud);
    this.loveEl = hud.querySelector('#love-value')!;
    this.tokensEl = hud.querySelector('#tokens-value')!;
    this.timeWeatherBtn = hud.querySelector('#time-weather-btn')!;
    this.soundBtn = hud.querySelector('#sound-toggle-btn')!;

    hud.querySelector('#plinko-btn')!.addEventListener('click', () => {
      sound.playTap();
      this.openPlinkoModal();
    });

    // Start background music on first user gesture
    const startMusicOnce = () => {
      sound.startMusic();
      document.removeEventListener('pointerdown', startMusicOnce);
    };
    document.addEventListener('pointerdown', startMusicOnce, { once: true });

    this.timeWeatherBtn.addEventListener('click', () => {
      sound.playTap();
      EventBus.emit('toggle-time', {});
    });

    hud.querySelector('#shop-btn')!.addEventListener('click', () => {
      sound.playTap();
      this.openShopModal();
    });

    this.soundBtn.addEventListener('click', () => {
      sound.playTap();
      this.openSoundPanel();
    });

    hud.querySelector('#save-menu-btn')!.addEventListener('click', () => this.openSaveMenu());
  }

  private buildAreaNav(parent: HTMLElement): void {
    const nav = document.createElement('div');
    nav.className = 'area-nav';
    parent.appendChild(nav);
    this.areaNavEl = nav;
    this.renderAreaNav();
  }

  private renderAreaNav(): void {
    this.areaNavEl.innerHTML = '';
    for (const key of AREA_KEYS) {
      const info = AREA_INFO_MAP[key];
      const areaState = this.areasState[key];
      const count = this.catsList.filter((c) => c.area === key).length;
      const areaSvg = SVG_ICONS[key] || SVG_ICONS.yard;

      const btn = document.createElement('button');
      btn.className = `area-nav-btn ${this.currentArea === key ? 'active' : ''} ${!areaState?.unlocked ? 'locked' : ''}`;

      if (areaState?.unlocked) {
        btn.innerHTML = `<span class="area-svg-icon">${areaSvg}</span><span>${info.label}</span><span class="area-count">${count}/${areaState.capacity}</span>`;
        btn.addEventListener('click', () => {
          EventBus.emit('switch-area', { area: key });
        });
      } else {
        btn.innerHTML = `<span class="area-svg-icon">${areaSvg}</span><span>${info.label}</span><span class="lock-badge">${SVG_ICONS.lock}</span>`;
        btn.addEventListener('click', () => {
          sound.playTap();
          this.openShopModal('areas');
        });
      }

      this.areaNavEl.appendChild(btn);
    }
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
    EventBus.emit('tool-selected', { tool: this.selectedTool });
  }

  /**
   * Info & Roster button replacing the old adopt button
   */
  private buildRosterButton(): void {
    const btn = document.createElement('button');
    btn.className = 'adopt-btn roster-btn';
    btn.id = 'roster-btn';
    btn.innerHTML = `<span class="roster-btn-icon">${SVG_ICONS.info}</span><span class="roster-btn-label">Cat Info</span>`;
    btn.title = 'View Sanctuary Cats Roster & Details';
    btn.addEventListener('click', () => {
      sound.playTap();
      if (this.catsList.length > 0) {
        this.openJournalByIndex(0);
      } else {
        this.showToast('No cats in sanctuary yet.');
      }
    });

    this.root.appendChild(btn);
    this.rosterBtn = btn;
  }

  private activeToasts: { el: HTMLElement; timerId: number }[] = [];

  private buildToastStack(): void {
    const stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.className = 'toast-stack';
    this.root.appendChild(stack);
    this.toastStack = stack;
  }

  showToast(message: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = message;

    const item = {
      el,
      timerId: 0,
    };

    // Click to dismiss
    el.addEventListener('click', () => {
      sound.playTap();
      this.dismissToast(item);
    });

    // Auto-expire after 3.8s
    item.timerId = window.setTimeout(() => {
      this.dismissToast(item);
    }, 3800);

    // Newest one is added to the bottom of the deck
    this.activeToasts.push(item);
    this.toastStack.appendChild(el);

    this.updateToastDeck();
  }

  private dismissToast(item: { el: HTMLElement; timerId: number }): void {
    const idx = this.activeToasts.indexOf(item);
    if (idx === -1) return;

    window.clearTimeout(item.timerId);
    this.activeToasts.splice(idx, 1);

    // Animate the expired card up & out
    item.el.style.opacity = '0';
    item.el.style.transform = 'translate(0px, -22px) scale(0.92)';
    item.el.style.pointerEvents = 'none';

    setTimeout(() => {
      item.el.remove();
    }, 300);

    // Underlying cards immediately move up into position
    this.updateToastDeck();
  }

  private updateToastDeck(): void {
    const maxVisible = 4;

    this.activeToasts.forEach((item, index) => {
      // index 0 is the top card currently in front
      // subsequent cards are offset down (+Y) and a tiny bit to the right (+X)
      const offsetX = index * 4; // Tiny bit to the right
      const offsetY = index * 8; // Down
      const scale = Math.max(0.88, 1 - index * 0.03);
      const opacity = index >= maxVisible ? 0 : Math.max(0.68, 1 - index * 0.12);
      const zIndex = 100 - index;

      item.el.style.zIndex = String(zIndex);
      item.el.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
      item.el.style.opacity = String(opacity);
      item.el.style.filter = index === 0 ? 'none' : `brightness(${Math.max(0.82, 1 - index * 0.07)})`;
      item.el.style.pointerEvents = index === 0 ? 'auto' : 'none';
    });
  }

  private bindBusEvents(): void {
    EventBus.on('love-changed', ({ love }: { love: number }) => {
      const prev = this.currentLove;
      this.currentLove = Math.floor(love);
      this.loveEl.textContent = this.currentLove.toLocaleString();
      // Play coin sound when earning love
      if (this.currentLove > prev) sound.playCoin();
    });

    EventBus.on('tokens-changed', ({ tokens }: { tokens: number }) => {
      this.currentTokens = tokens;
      this.tokensEl.textContent = this.currentTokens.toString();
    });

    EventBus.on('cats-changed', ({ count }: { count: number }) => {
      this.currentCatCount = count;
      if (this.rosterBtn) {
        this.rosterBtn.title = `View Sanctuary Cats (${this.currentCatCount} cats)`;
      }
    });

    EventBus.on('time-changed', ({ timeOfDay }: { timeOfDay: TimeOfDay }) => {
      this.currentTimeOfDay = timeOfDay;
      this.updateWeatherButtonText();
    });

    EventBus.on('weather-changed', ({ weather }: { weather: WeatherType }) => {
      this.currentWeather = weather;
      this.updateWeatherButtonText();
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
      }) => {
        this.areasState = payload.areas;
        this.currentArea = payload.currentArea;
        this.catsList = payload.cats;
        this.ownedFurniture = payload.furniture ?? [];
        this.machinesState = payload.machines ?? {};
        this.milestonesList = payload.milestones ?? [];
        this.currentTokens = payload.tokens ?? 0;
        this.offlineStarLevel = payload.offlineStarLevel ?? 1;
        this.tokensEl.textContent = this.currentTokens.toString();
        this.renderAreaNav();
      },
    );

    EventBus.on('toast', ({ message }: { message: string }) => this.showToast(message));

    EventBus.on('cat-info', ({ cat }: { cat: Cat }) => this.openJournal(cat));

    EventBus.on('offline-summary', (summary: { minutesAway: number; loveEarned: number; starsEarned?: number; headlines: string[] }) => {
      this.showOfflineSummary(summary);
    });
  }

  private updateWeatherButtonText(): void {
    const timeLabels: Record<TimeOfDay, string> = {
      morning: 'Morning',
      day: 'Day',
      sunset: 'Sunset',
      night: 'Night',
    };
    const timeSvg = SVG_ICONS[this.currentTimeOfDay] || SVG_ICONS.day;
    const weatherSvg = SVG_ICONS[this.currentWeather] ? SVG_ICONS[this.currentWeather] : '';

    this.timeWeatherBtn.querySelector('#time-weather-icon')!.innerHTML = `${weatherSvg || timeSvg}`;
    this.timeWeatherBtn.querySelector('#time-weather-text')!.textContent = `${timeLabels[this.currentTimeOfDay]}`;
  }

  private openJournal(cat: Cat): void {
    const idx = this.catsList.findIndex((c) => c.id === cat.id);
    this.openJournalByIndex(idx >= 0 ? idx : 0);
  }

  private openJournalByIndex(initialIndex: number): void {
    if (this.catsList.length === 0) return;

    let currentIndex = Phaser.Math.Clamp(initialIndex, 0, this.catsList.length - 1);
    const backdrop = this.createBackdrop();
    const modal = document.createElement('div');
    modal.className = 'modal journal-modal carousel-modal';

    let isNavigating = false;
    const navigateToCat = (newIndex: number, direction: 'next' | 'prev') => {
      if (isNavigating) return;
      isNavigating = true;
      sound.playTap();
      modal.style.transition = 'transform 0.16s ease-out, opacity 0.16s ease-out';
      modal.style.transform = direction === 'next' ? 'translateX(-80px) rotate(-3deg)' : 'translateX(80px) rotate(3deg)';
      modal.style.opacity = '0';

      setTimeout(() => {
        currentIndex = newIndex;
        renderCurrentCat();
        modal.style.transition = 'none';
        modal.style.transform = direction === 'next' ? 'translateX(80px) rotate(3deg)' : 'translateX(-80px) rotate(-3deg)';
        modal.style.opacity = '0';
        requestAnimationFrame(() => {
          modal.style.transition = 'transform 0.22s cubic-bezier(0.34, 1.35, 0.64, 1), opacity 0.22s ease-out';
          modal.style.transform = 'translateX(0px) rotate(0deg)';
          modal.style.opacity = '1';
          setTimeout(() => {
            isNavigating = false;
          }, 220);
        });
      }, 160);
    };

    const renderCurrentCat = () => {
      const cat = this.catsList[currentIndex];
      if (!cat) return;

      const activeAreas = this.areasState;
      const skinDef = CAT_SKINS.find((s) => s.id === cat.color);
      const skinName = skinDef?.label ?? cat.color;
      const markingDef = CAT_MARKINGS.find((m) => m.id === cat.pattern);
      const markingName = markingDef ? markingDef.label : 'None';

      const majorDesc = TRAITS[cat.majorTrait]?.description ?? '';
      const minorDesc = TRAITS[cat.minorTrait]?.description ?? '';

      const bestFriend = cat.journal.bestFriendId ? 'Has a Best Friend' : 'Looking for Friends';

      const rareBadge = cat.isRare
        ? `<span class="badge rare-badge"><span class="svg-inline">${SVG_ICONS.sparkle}</span> ${skinDef?.description || 'Rare Collector Cat'}</span>`
        : '';

      const areaOptions = AREA_KEYS.map((k) => {
        const meta = AREA_INFO_MAP[k];
        const isUnlocked = activeAreas[k]?.unlocked;
        const selected = cat.area === k ? 'selected' : '';
        const disabled = !isUnlocked ? 'disabled' : '';
        const lockLabel = !isUnlocked ? ' (Locked)' : '';
        return `<option value="${k}" ${selected} ${disabled}>${meta.label}${lockLabel}</option>`;
      }).join('');

      const stageLabel =
        cat.stage === 'kitten'
          ? 'Kitten'
          : cat.stage === 'teen'
            ? 'Teen'
            : 'Adult';

      const nextStageText =
        cat.stage === 'kitten'
          ? 'Growing into Teen'
          : cat.stage === 'teen'
            ? 'Growing into Adult'
            : 'Fully Grown Adult';

      const growthPaused = cat.happiness < 30;
      const growthNearFull = cat.growthProgress >= 85;
      const growthPct = Math.round(cat.growthProgress);

      const totalCare = this.catsList.reduce((sum, c) => sum + (c.hunger + c.cleanliness + c.affection + c.fun) / 4, 0);
      const avgCare = this.catsList.length > 0 ? totalCare / this.catsList.length : 100;
      const growthMultiplier = Math.max(1, avgCare / 10);

      const growCost = cat.stage === 'kitten'
        ? Math.max(10, Math.round(100 * (1 - cat.growthProgress / 100)))
        : Math.max(30, Math.round(300 * (1 - cat.growthProgress / 100)));

      const growthHtml =
        cat.stage === 'adult'
          ? `<div class="growth-box"><span class="stage-tag-badge adult-badge">Fully Grown Adult</span></div>`
          : `
            <div class="growth-box growth-box-featured">
              <div class="growth-label-row">
                <span class="stage-tag-badge">${stageLabel}</span>
                <span class="growth-next-text">${nextStageText}</span>
                <span class="growth-speed-badge">⚡ ${growthMultiplier.toFixed(1)}x Speed</span>
              </div>
              <div class="growth-track-wrap">
                <div class="progress-track growth-track">
                  <div class="progress-fill fill-growth${growthNearFull ? ' fill-growth-near' : ''}" style="width: ${cat.growthProgress}%"></div>
                </div>
                <span class="growth-pct${growthNearFull ? ' growth-pct-near' : ''}">${growthPct}%</span>
              </div>
              ${growthPaused
                ? `<div class="growth-status growth-paused">Growth paused — keep needs met to continue growing!</div>`
                : growthNearFull
                  ? `<div class="growth-status growth-ready">Almost ready! Keep sanctuary care high (${Math.round(avgCare)}% avg) for faster growth.</div>`
                  : `<div class="growth-status growth-tip">High sanctuary care gives up to 10x growth speed! (Current: ${growthMultiplier.toFixed(1)}x)</div>`
              }
              <button class="instant-grow-btn" id="instant-grow-btn" ${this.currentLove < growCost ? 'disabled' : ''}>
                <span class="svg-inline">${SVG_ICONS.sparkle}</span>
                <span>Grow to ${cat.stage === 'kitten' ? 'Teen' : 'Adult'} (${growCost.toLocaleString()} CP 💗)</span>
              </button>
            </div>
          `;

      const rehomeVal = calculateRehomeLove(cat);

      modal.innerHTML = `
        <!-- Carousel Header Bar -->
        <div class="carousel-header-bar">
          <button class="carousel-nav-btn prev-cat-btn" id="prev-cat-btn" title="Previous Cat (Left Arrow)" ${this.catsList.length <= 1 ? 'disabled' : ''}>
            ${SVG_ICONS.arrowLeft}
          </button>
          <div class="carousel-cat-counter">
            <span class="counter-text">Cat <b>${currentIndex + 1}</b> of <b>${this.catsList.length}</b></span>
          </div>
          <button class="carousel-nav-btn next-cat-btn" id="next-cat-btn" title="Next Cat (Right Arrow)" ${this.catsList.length <= 1 ? 'disabled' : ''}>
            ${SVG_ICONS.arrowRight}
          </button>
        </div>

        <div class="journal-header">
          <div class="journal-avatar-wrapper">
            <canvas id="journal-cat-canvas" width="64" height="64" class="journal-avatar-canvas"></canvas>
          </div>
          <div class="journal-title-box">
            <h2>${escapeHtml(cat.name)}</h2>
            <div class="coat-tag">${escapeHtml(skinName)} · ${stageLabel}</div>
            ${rareBadge}
          </div>
        </div>

        ${growthHtml}

        <div class="area-reassign-box">
          <label for="cat-area-select"><b>Current Area:</b></label>
          <select id="cat-area-select" class="area-select-dropdown">
            ${areaOptions}
          </select>
        </div>

        <div class="traits-container">
          <div class="trait-chip">
            <b><span class="svg-inline">${SVG_ICONS.sparkle}</span> ${cap(cat.majorTrait)}:</b> <span>${escapeHtml(majorDesc)}</span>
          </div>
          <div class="trait-chip">
            <b><span class="svg-inline">${SVG_ICONS.sparkle}</span> ${cap(cat.minorTrait)}:</b> <span>${escapeHtml(minorDesc)}</span>
          </div>
        </div>

        <!-- Quick-Care Action Bar -->
        <div class="quick-care-section">
          <div class="quick-care-header">
            <span>Direct Care Actions</span>
          </div>
          <div class="quick-care-grid">
            <button class="quick-care-btn quick-food" data-tool="food" title="Feed ${escapeHtml(cat.name)}">
              <span class="qc-icon">${SVG_ICONS.food}</span><span>Feed</span>
            </button>
            <button class="quick-care-btn quick-pet" data-tool="pet" title="Pet ${escapeHtml(cat.name)}">
              <span class="qc-icon">${SVG_ICONS.pet}</span><span>Pet</span>
            </button>
            <button class="quick-care-btn quick-brush" data-tool="brush" title="Brush ${escapeHtml(cat.name)}">
              <span class="qc-icon">${SVG_ICONS.brush}</span><span>Brush</span>
            </button>
            <button class="quick-care-btn quick-toy" data-tool="toy" title="Play with ${escapeHtml(cat.name)}">
              <span class="qc-icon">${SVG_ICONS.toy}</span><span>Toy</span>
            </button>
            <button class="quick-care-btn quick-wash" data-tool="wash" title="Wash ${escapeHtml(cat.name)}">
              <span class="qc-icon">${SVG_ICONS.wash}</span><span>Wash</span>
            </button>
          </div>
        </div>

        <div class="needs-section">
          <div class="need-bar-item">
            <span class="need-label"><span class="svg-inline">${SVG_ICONS.food}</span> Hunger</span>
            <div class="progress-track"><div class="progress-fill fill-hunger" style="width: ${cat.hunger}%"></div></div>
            <span class="need-pct-hunger">${Math.round(cat.hunger)}%</span>
          </div>
          <div class="need-bar-item">
            <span class="need-label"><span class="svg-inline">${SVG_ICONS.pet}</span> Affection</span>
            <div class="progress-track"><div class="progress-fill fill-affection" style="width: ${cat.affection}%"></div></div>
            <span class="need-pct-affection">${Math.round(cat.affection)}%</span>
          </div>
          <div class="need-bar-item">
            <span class="need-label"><span class="svg-inline">${SVG_ICONS.brush}</span> Cleanliness</span>
            <div class="progress-track"><div class="progress-fill fill-clean" style="width: ${cat.cleanliness}%"></div></div>
            <span class="need-pct-clean">${Math.round(cat.cleanliness)}%</span>
          </div>
          <div class="need-bar-item">
            <span class="need-label"><span class="svg-inline">${SVG_ICONS.toy}</span> Fun</span>
            <div class="progress-track"><div class="progress-fill fill-fun" style="width: ${cat.fun}%"></div></div>
            <span class="need-pct-fun">${Math.round(cat.fun)}%</span>
          </div>
          <div class="need-bar-item">
            <span class="need-label"><span class="svg-inline">${SVG_ICONS.energy}</span> Energy</span>
            <div class="progress-track"><div class="progress-fill fill-energy" style="width: ${cat.energy}%"></div></div>
            <span>${Math.round(cat.energy)}%</span>
          </div>
        </div>

        <div class="journal-stats">
          <div class="journal-stat"><span class="svg-inline">${SVG_ICONS.food}</span> Favorite Food<br/><b>${escapeHtml(cat.favoriteFood)}</b></div>
          <div class="journal-stat"><span class="svg-inline">${SVG_ICONS.toy}</span> Favorite Toy<br/><b>${escapeHtml(cat.favoriteToy)}</b></div>
          <div class="journal-stat"><span class="svg-inline">${SVG_ICONS.paw}</span> Markings<br/><b>${escapeHtml(markingName)}</b></div>
          <div class="journal-stat"><span class="svg-inline">${SVG_ICONS.pet}</span> Pets Received<br/><b>${cat.journal.totalPetsReceived}</b></div>
        </div>

        <div class="subtitle-status">${bestFriend} · Happiness ${Math.round(cat.happiness)}%</div>

        <div class="journal-history-label">Sanctuary Diary</div>
        <ul class="journal-entries">
          ${[...cat.journal.entries].reverse().slice(0, 8).map((e) => `<li><b>Day ${e.day}:</b> ${escapeHtml(e.message)}</li>`).join('')}
        </ul>

        <!-- Loving Home Rehome Card -->
        <div class="rehome-card">
          <div class="rehome-card-header">
            <span class="svg-inline">${SVG_ICONS.lovingHome}</span>
            <b>Find a Loving Forever Home</b>
          </div>
          <p class="rehome-desc">Send ${escapeHtml(cat.name)} to a caring adoptive home to receive generous Care Points for sanctuary expansion.</p>
          <div class="rehome-reward-pill">
            <span class="rehome-reward-amount">+${rehomeVal.total.toLocaleString()} 💗 Love</span>
          </div>
          <button class="rehome-action-btn" id="rehome-cat-btn">
            <span class="svg-inline">${SVG_ICONS.lovingHome}</span>
            <span>Rehome ${escapeHtml(cat.name)}</span>
          </button>
        </div>

        <button class="modal-action-btn export-card-btn" id="export-card-btn">
          <span class="svg-inline">${SVG_ICONS.camera}</span> Save Adoption Card (.PNG)
        </button>

        <button class="modal-close" id="journal-close-btn">Close</button>
      `;

      // Carousel Navigation Event Listeners
      modal.querySelector('#prev-cat-btn')?.addEventListener('click', () => {
        const nextIdx = (currentIndex - 1 + this.catsList.length) % this.catsList.length;
        navigateToCat(nextIdx, 'prev');
      });

      modal.querySelector('#next-cat-btn')?.addEventListener('click', () => {
        const nextIdx = (currentIndex + 1) % this.catsList.length;
        navigateToCat(nextIdx, 'next');
      });

      modal.querySelector('#instant-grow-btn')?.addEventListener('click', () => {
        sound.playTap();
        EventBus.emit('instant-grow-cat', { catId: cat.id, cost: growCost });
        setTimeout(() => renderCurrentCat(), 200);
      });

      const selectEl = modal.querySelector('#cat-area-select') as HTMLSelectElement;
      selectEl.addEventListener('change', () => {
        const newArea = selectEl.value as CatArea;
        if (newArea !== cat.area) {
          EventBus.emit('move-cat', { catId: cat.id, toArea: newArea });
        }
      });

      modal.querySelectorAll('.quick-care-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tool = (btn as HTMLElement).dataset.tool as ToolType;
          if (!tool) return;
          sound.playTap();
          EventBus.emit('direct-care-cat', { catId: cat.id, tool });

          setTimeout(() => {
            const hungerBar = modal.querySelector('.fill-hunger') as HTMLElement;
            const cleanBar = modal.querySelector('.fill-clean') as HTMLElement;
            const affBar = modal.querySelector('.fill-affection') as HTMLElement;
            const funBar = modal.querySelector('.fill-fun') as HTMLElement;

            const hungerPct = modal.querySelector('.need-pct-hunger') as HTMLElement;
            const cleanPct = modal.querySelector('.need-pct-clean') as HTMLElement;
            const affPct = modal.querySelector('.need-pct-affection') as HTMLElement;
            const funPct = modal.querySelector('.need-pct-fun') as HTMLElement;

            if (hungerBar && hungerPct) {
              hungerBar.style.width = `${cat.hunger}%`;
              hungerPct.textContent = `${Math.round(cat.hunger)}%`;
            }
            if (cleanBar && cleanPct) {
              cleanBar.style.width = `${cat.cleanliness}%`;
              cleanPct.textContent = `${Math.round(cat.cleanliness)}%`;
            }
            if (affBar && affPct) {
              affBar.style.width = `${cat.affection}%`;
              affPct.textContent = `${Math.round(cat.affection)}%`;
            }
            if (funBar && funPct) {
              funBar.style.width = `${cat.fun}%`;
              funPct.textContent = `${Math.round(cat.fun)}%`;
            }
          }, 50);

          btn.classList.add('pulse-pop');
          setTimeout(() => btn.classList.remove('pulse-pop'), 300);
        });
      });

      modal.querySelector('#rehome-cat-btn')?.addEventListener('click', () => {
        sound.playTap();
        this.openRehomeConfirmModal(cat, rehomeVal, () => {
          backdrop.remove();
        });
      });

      modal.querySelector('#export-card-btn')!.addEventListener('click', () => {
        sound.playTap();
        EventBus.emit('export-cat-card', { catId: cat.id });
      });

      modal.querySelector('#journal-close-btn')!.addEventListener('click', () => {
        sound.playTap();
        backdrop.remove();
      });

      this.drawCatAvatar(modal.querySelector('#journal-cat-canvas') as HTMLCanvasElement, cat);
    };

    // Robust Touch & Drag Gesture System with Deadzone & Ease-in Progression
    const DEADZONE_PX = 20;
    const SWIPE_TRIGGER_PX = 85;
    let touchStartX = 0;
    let touchStartY = 0;
    let currentDx = 0;
    let gestureLock: 'horizontal' | 'vertical' | null = null;
    let isTouching = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      currentDx = 0;
      gestureLock = null;
      isTouching = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isTouching || e.touches.length !== 1) return;
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const dx = x - touchStartX;
      const dy = y - touchStartY;

      if (gestureLock === null) {
        if (Math.hypot(dx, dy) > 12) {
          // Strictly require dominant horizontal movement (> 2.0x vertical) and past initial motion
          if (Math.abs(dx) > Math.abs(dy) * 2.0 && Math.abs(dx) > DEADZONE_PX) {
            gestureLock = 'horizontal';
          } else {
            // Allow native vertical scrolling of modal
            gestureLock = 'vertical';
          }
        }
      }

      if (gestureLock === 'horizontal') {
        currentDx = dx;
        const absDx = Math.abs(dx);

        if (absDx <= DEADZONE_PX) {
          modal.style.transition = 'none';
          modal.style.transform = 'translateX(0px) rotate(0deg)';
          modal.style.opacity = '1';
        } else {
          // Ease-in drag curve: starts very subtly past deadzone, becoming progressively more pronounced
          const excess = absDx - DEADZONE_PX;
          const progress = Math.min(1.6, excess / 80);
          const easeInFactor = Math.pow(progress, 1.5);
          const dir = Math.sign(dx);

          const dragX = dir * easeInFactor * 65;
          const dragRotate = dir * easeInFactor * 3.5;
          const dragAlpha = Math.max(0.55, 1 - easeInFactor * 0.28);

          modal.style.transition = 'none';
          modal.style.transform = `translateX(${dragX}px) rotate(${dragRotate}deg)`;
          modal.style.opacity = String(dragAlpha);
        }

        if (e.cancelable) e.preventDefault();
      }
    };

    const onTouchEnd = () => {
      if (!isTouching) return;
      isTouching = false;

      if (gestureLock === 'horizontal') {
        if (currentDx <= -SWIPE_TRIGGER_PX && this.catsList.length > 1) {
          const nextIdx = (currentIndex + 1) % this.catsList.length;
          modal.style.transition = 'transform 0.18s ease-out, opacity 0.18s ease-out';
          modal.style.transform = 'translateX(-120%) rotate(-6deg)';
          modal.style.opacity = '0';
          sound.playTap();
          setTimeout(() => {
            currentIndex = nextIdx;
            renderCurrentCat();
            modal.style.transition = 'none';
            modal.style.transform = 'translateX(60px) rotate(3deg)';
            modal.style.opacity = '0';
            requestAnimationFrame(() => {
              modal.style.transition = 'transform 0.24s cubic-bezier(0.34, 1.35, 0.64, 1), opacity 0.22s ease-out';
              modal.style.transform = 'translateX(0px) rotate(0deg)';
              modal.style.opacity = '1';
            });
          }, 180);
        } else if (currentDx >= SWIPE_TRIGGER_PX && this.catsList.length > 1) {
          const prevIdx = (currentIndex - 1 + this.catsList.length) % this.catsList.length;
          modal.style.transition = 'transform 0.18s ease-out, opacity 0.18s ease-out';
          modal.style.transform = 'translateX(120%) rotate(6deg)';
          modal.style.opacity = '0';
          sound.playTap();
          setTimeout(() => {
            currentIndex = prevIdx;
            renderCurrentCat();
            modal.style.transition = 'none';
            modal.style.transform = 'translateX(-60px) rotate(-3deg)';
            modal.style.opacity = '0';
            requestAnimationFrame(() => {
              modal.style.transition = 'transform 0.24s cubic-bezier(0.34, 1.35, 0.64, 1), opacity 0.22s ease-out';
              modal.style.transform = 'translateX(0px) rotate(0deg)';
              modal.style.opacity = '1';
            });
          }, 180);
        } else {
          modal.style.transition = 'transform 0.25s cubic-bezier(0.34, 1.4, 0.64, 1), opacity 0.2s ease';
          modal.style.transform = 'translateX(0px) rotate(0deg)';
          modal.style.opacity = '1';
        }
      }

      gestureLock = null;
      currentDx = 0;
    };

    modal.addEventListener('touchstart', onTouchStart, { passive: true });
    modal.addEventListener('touchmove', onTouchMove, { passive: false });
    modal.addEventListener('touchend', onTouchEnd, { passive: true });
    modal.addEventListener('touchcancel', onTouchEnd, { passive: true });

    // Keyboard Left/Right Navigation
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        const prevIdx = (currentIndex - 1 + this.catsList.length) % this.catsList.length;
        navigateToCat(prevIdx, 'prev');
      } else if (e.key === 'ArrowRight') {
        const nextIdx = (currentIndex + 1) % this.catsList.length;
        navigateToCat(nextIdx, 'next');
      } else if (e.key === 'Escape') {
        backdrop.remove();
        window.removeEventListener('keydown', keyHandler);
      }
    };
    window.addEventListener('keydown', keyHandler);

    renderCurrentCat();
    backdrop.appendChild(modal);
    this.root.appendChild(backdrop);
  }

  private openRehomeConfirmModal(
    cat: Cat,
    reward: { total: number; base: number; ageBonus: number; happinessBonus: number; rarityMultiplier: number },
    onComplete: () => void,
  ): void {
    const backdrop = this.createBackdrop();
    const modal = document.createElement('div');
    modal.className = 'modal rehome-confirm-modal';

    const rarityBadge = cat.isRare ? ` · <span class="rehome-highlight">${reward.rarityMultiplier}x Rarity Boost</span>` : '';

    modal.innerHTML = `
      <div class="rehome-confirm-header">
        <span class="rehome-confirm-icon">${SVG_ICONS.lovingHome}</span>
        <h2>Rehome ${escapeHtml(cat.name)}?</h2>
      </div>

      <p class="rehome-confirm-body">
        A loving forever family would cherish adopting <b>${escapeHtml(cat.name)}</b> (${cap(cat.stage)}${rarityBadge}).
      </p>


      <div class="rehome-breakdown-card">
        <div class="rehome-breakdown-row"><span>Base Care Points:</span> <b>+${reward.base} 💗</b></div>
        <div class="rehome-breakdown-row"><span>Sanctuary Care Bonus:</span> <b>+${reward.ageBonus} 💗</b></div>
        <div class="rehome-breakdown-row"><span>Happiness Bonus:</span> <b>+${reward.happinessBonus} 💗</b></div>
        ${cat.isRare ? `<div class="rehome-breakdown-row"><span>Rarity Multiplier:</span> <b>${reward.rarityMultiplier}x</b></div>` : ''}
        <div class="rehome-breakdown-total">
          <span>Total Care Points Granted:</span>
          <b>+${reward.total.toLocaleString()} 💗 Love</b>
        </div>
      </div>

      <div class="rehome-dialog-actions">
        <button class="rehome-confirm-btn" id="confirm-rehome-btn">
          Yes, Find Loving Home (+${reward.total.toLocaleString()} 💗)
        </button>
        <button class="rehome-cancel-btn" id="cancel-rehome-btn">
          Keep in Sanctuary
        </button>
      </div>
    `;

    modal.querySelector('#confirm-rehome-btn')?.addEventListener('click', () => {
      EventBus.emit('rehome-cat', { catId: cat.id });
      backdrop.remove();
      onComplete();
    });

    modal.querySelector('#cancel-rehome-btn')?.addEventListener('click', () => {
      sound.playTap();
      backdrop.remove();
    });

    backdrop.appendChild(modal);
    this.root.appendChild(backdrop);
  }

  private openShopModal(defaultTab: 'areas' | 'machines' | 'furniture' | 'milestones' | 'upgrades' | 'plinko' | 'sort' = 'areas'): void {
    const backdrop = this.createBackdrop();
    const modal = document.createElement('div');
    modal.className = 'modal shop-modal';

    const renderTabs = (activeTab: 'areas' | 'machines' | 'furniture' | 'milestones' | 'upgrades' | 'plinko' | 'sort', preserveScroll = true) => {
      const savedModalScroll = preserveScroll ? modal.scrollTop : 0;
      const contentEl = modal.querySelector('.shop-content');
      const savedContentScroll = preserveScroll && contentEl ? contentEl.scrollTop : 0;

      modal.innerHTML = `
        <div class="shop-header">
          <h2>Sanctuary Emporium</h2>
          <div class="shop-balances">
            <span class="shop-love-balance" title="Care Points (CP)"><span class="svg-inline">${SVG_ICONS.heart}</span> <b>${this.currentLove.toLocaleString()} CP</b></span>
            <span class="shop-tokens-balance" title="Stars (Plinko currency)"><span class="svg-inline">${SVG_ICONS.star}</span> <b>${this.currentTokens} ⭐</b></span>
          </div>
        </div>

        <div class="shop-tabs">
          <button class="shop-tab-btn ${activeTab === 'areas' ? 'active' : ''}" id="tab-areas-btn"><span class="svg-inline">${SVG_ICONS.yard}</span> Areas</button>
          <button class="shop-tab-btn ${activeTab === 'machines' ? 'active' : ''}" id="tab-machines-btn"><span class="svg-inline">${SVG_ICONS.machine}</span> Automation</button>
          <button class="shop-tab-btn ${activeTab === 'furniture' ? 'active' : ''}" id="tab-furniture-btn"><span class="svg-inline">${SVG_ICONS.shop}</span> Decor</button>
          <button class="shop-tab-btn ${activeTab === 'milestones' ? 'active' : ''}" id="tab-milestones-btn"><span class="svg-inline">${SVG_ICONS.star}</span> Goals</button>
          <button class="shop-tab-btn ${activeTab === 'upgrades' ? 'active' : ''}" id="tab-upgrades-btn"><span class="svg-inline">${SVG_ICONS.sparkle}</span> Upgrades</button>
          <button class="shop-tab-btn ${activeTab === 'plinko' ? 'active' : ''}" id="tab-plinko-btn"><span class="svg-inline">${SVG_ICONS.star}</span> Plinko</button>
          <button class="shop-tab-btn ${activeTab === 'sort' ? 'active' : ''}" id="tab-sort-btn"><span class="svg-inline">${SVG_ICONS.paw}</span> Sort</button>
        </div>

        <div class="shop-content">
          ${
            activeTab === 'areas'
              ? this.renderShopAreasContent()
              : activeTab === 'machines'
                ? this.renderShopMachinesContent()
                : activeTab === 'furniture'
                  ? this.renderShopFurnitureContent()
                  : activeTab === 'milestones'
                    ? this.renderShopMilestonesContent()
                    : activeTab === 'upgrades'
                      ? this.renderShopUpgradesContent()
                      : activeTab === 'plinko'
                        ? this.renderShopPlinkoContent()
                        : this.renderShopSortContent()
          }
        </div>

        <button class="modal-close" id="shop-close-btn">Done</button>
      `;

      if (preserveScroll) {
        modal.scrollTop = savedModalScroll;
        const newContentEl = modal.querySelector('.shop-content');
        if (newContentEl && savedContentScroll > 0) {
          newContentEl.scrollTop = savedContentScroll;
        }
      }

      modal.querySelector('#tab-areas-btn')?.addEventListener('click', () => {
        sound.playTap();
        renderTabs('areas', false);
      });
      modal.querySelector('#tab-machines-btn')?.addEventListener('click', () => {
        sound.playTap();
        renderTabs('machines', false);
      });
      modal.querySelector('#tab-furniture-btn')?.addEventListener('click', () => {
        sound.playTap();
        renderTabs('furniture', false);
      });
      modal.querySelector('#tab-milestones-btn')?.addEventListener('click', () => {
        sound.playTap();
        renderTabs('milestones', false);
      });
      modal.querySelector('#tab-upgrades-btn')?.addEventListener('click', () => {
        sound.playTap();
        renderTabs('upgrades', false);
      });
      modal.querySelector('#tab-plinko-btn')?.addEventListener('click', () => {
        sound.playTap();
        renderTabs('plinko', false);
      });
      modal.querySelector('#tab-sort-btn')?.addEventListener('click', () => {
        sound.playTap();
        renderTabs('sort', false);
      });

      modal.querySelector('#shop-close-btn')?.addEventListener('click', () => {
        sound.playTap();
        backdrop.remove();
      });

      // Bind Area Unlock buttons
      modal.querySelectorAll('.unlock-area-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const areaKey = (btn as HTMLElement).dataset.area as CatArea;
          EventBus.emit('unlock-area', { area: areaKey });
          setTimeout(() => renderTabs('areas', true), 200);
        });
      });

      // Bind Capacity Upgrade buttons
      modal.querySelectorAll('.upgrade-cap-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const areaKey = (btn as HTMLElement).dataset.area as CatArea;
          EventBus.emit('upgrade-capacity', { area: areaKey });
          setTimeout(() => renderTabs('areas', true), 200);
        });
      });

      // Bind Automation Machine Buy & Upgrade buttons
      modal.querySelectorAll('.buy-machine-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const machineId = (btn as HTMLElement).dataset.machineId;
          if (machineId) {
            EventBus.emit('buy-machine', { machineId });
            setTimeout(() => renderTabs('machines', true), 200);
          }
        });
      });

      modal.querySelectorAll('.upgrade-machine-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const machineId = (btn as HTMLElement).dataset.machineId;
          if (machineId) {
            EventBus.emit('upgrade-machine', { machineId });
            setTimeout(() => renderTabs('machines', true), 200);
          }
        });
      });

      // Bind Furniture Purchase buttons
      modal.querySelectorAll('.buy-furniture-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const furnitureId = (btn as HTMLElement).dataset.furnitureId;
          if (furnitureId) {
            EventBus.emit('buy-furniture', { furnitureId });
            setTimeout(() => renderTabs('furniture', true), 200);
          }
        });
      });

      // Bind Milestone Claim buttons
      modal.querySelectorAll('.claim-milestone-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const milestoneId = (btn as HTMLElement).dataset.milestoneId;
          if (milestoneId) {
            EventBus.emit('claim-milestone', { milestoneId });
            setTimeout(() => renderTabs('milestones', true), 200);
          }
        });
      });

      // Bind Upgrade Offline Stars button
      modal.querySelector('.upgrade-offline-stars-btn')?.addEventListener('click', () => {
        EventBus.emit('upgrade-offline-stars', {});
        setTimeout(() => renderTabs('upgrades', true), 200);
      });

      // Bind Launch Plinko Button
      modal.querySelector('.launch-plinko-btn')?.addEventListener('click', () => {
        sound.playTap();
        backdrop.remove();
        this.openPlinkoModal();
      });

      // Bind Cat Move Dropdowns
      modal.querySelectorAll('.roster-move-select').forEach((sel) => {
        sel.addEventListener('change', (e) => {
          const target = e.target as HTMLSelectElement;
          const catId = target.dataset.catId;
          const toArea = target.value as CatArea;
          if (catId && toArea) {
            EventBus.emit('move-cat', { catId, toArea });
            const cat = this.catsList.find((c) => c.id === catId);
            if (cat) cat.area = toArea;
            renderTabs('sort', true);
          }
        });
      });
    };

    renderTabs(defaultTab, false);
    backdrop.appendChild(modal);
    this.root.appendChild(backdrop);
  }

  private renderShopAreasContent(): string {
    return AREA_KEYS.map((k) => {
      const meta = AREA_INFO_MAP[k];
      const areaState = this.areasState[k];
      const count = this.catsList.filter((c) => c.area === k).length;
      const isUnlocked = areaState?.unlocked;

      if (!isUnlocked) {
        const canAfford = this.currentLove >= meta.unlockCostLove;
        const meetsThreshold = this.currentCatCount >= meta.unlockThresholdCats;
        const disabled = !canAfford || !meetsThreshold;
        const reason = !meetsThreshold ? `(Requires ${meta.unlockThresholdCats} cats adopted)` : '';

        return `
          <div class="shop-card locked-card">
            <div class="shop-card-info">
              <h3><span class="svg-inline">${SVG_ICONS[k] || SVG_ICONS.yard}</span> ${meta.label} <span class="lock-badge">Locked</span></h3>
              <p>${meta.description}</p>
              <div class="shop-card-meta">Capacity: <b>${meta.baseCapacity} cats</b> ${reason}</div>
            </div>
            <button class="shop-action-btn unlock-area-btn" data-area="${k}" ${disabled ? 'disabled' : ''}>
              Unlock (${meta.unlockCostLove} 💗)
            </button>
          </div>
        `;
      }

      const canUpgrade = this.currentLove >= meta.capacityUpgradeCost;

      return `
        <div class="shop-card unlocked-card">
          <div class="shop-card-info">
            <h3><span class="svg-inline">${SVG_ICONS[k] || SVG_ICONS.yard}</span> ${meta.label} <span class="unlocked-badge">Active</span></h3>
            <p>${meta.description}</p>
            <div class="shop-card-meta">Current Capacity: <b>${count} / ${areaState.capacity} cats</b></div>
          </div>
          <button class="shop-action-btn upgrade-cap-btn" data-area="${k}" ${!canUpgrade ? 'disabled' : ''}>
            +5 Space (${meta.capacityUpgradeCost} 💗)
          </button>
        </div>
      `;
    }).join('');
  }

  private renderShopMachinesContent(): string {
    return `
      <div class="machines-intro">
        Install automated stations for each area. Cats will walk to them to replenish needs and generate bonus Love!
      </div>
      <div class="machines-catalog-grid">
        ${AUTOMATION_CATALOG.map((m) => {
          const areaUnlocked = this.areasState[m.area]?.unlocked;
          const currentLevel = this.machinesState[m.id] || 0;
          const areaMeta = AREA_INFO_MAP[m.area];

          let statusBadge = '';
          let actionBtn = '';

          if (!areaUnlocked) {
            statusBadge = `<span class="lock-badge">Locked Area</span>`;
            actionBtn = `<button class="shop-action-btn" disabled>Unlock ${areaMeta.label}</button>`;
          } else if (currentLevel === 0) {
            const canAfford = this.currentLove >= m.baseCost;
            statusBadge = `<span class="machine-unowned-badge">Not Installed</span>`;
            actionBtn = `
              <button class="shop-action-btn buy-machine-btn" data-machine-id="${m.id}" ${!canAfford ? 'disabled' : ''}>
                Install Tier 1 (${m.baseCost} 💗)
              </button>
            `;
          } else if (currentLevel < 3) {
            const upgradeCost = currentLevel === 1 ? m.upgradeCostLvl2 : m.upgradeCostLvl3;
            const canAfford = this.currentLove >= upgradeCost;
            statusBadge = `<span class="unlocked-badge">Tier ${currentLevel} Installed</span>`;
            actionBtn = `
              <button class="shop-action-btn upgrade-machine-btn" data-machine-id="${m.id}" ${!canAfford ? 'disabled' : ''}>
                Upgrade to Tier ${currentLevel + 1} (${upgradeCost} 💗)
              </button>
            `;
          } else {
            statusBadge = `<span class="unlocked-badge tier-max-badge">Tier 3 (Max)</span>`;
            actionBtn = `<span class="claimed-badge">✓ Maxed Out</span>`;
          }

          const needSvg = SVG_ICONS[m.needType] || SVG_ICONS.food;

          return `
            <div class="shop-card machine-card ${currentLevel > 0 ? 'machine-active-card' : ''}">
              <div class="shop-card-info">
                <div class="machine-title-row">
                  <h3><span class="svg-inline">${needSvg}</span> ${m.name}</h3>
                  ${statusBadge}
                </div>
                <p>${m.description}</p>
                <div class="shop-card-meta">
                  Location: <b>${areaMeta.label}</b> · Need: <b>${cap(m.needType)}</b>
                </div>
              </div>
              <div class="machine-action-wrap">
                ${actionBtn}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  private renderShopFurnitureContent(): string {
    return FURNITURE_CATALOG.map((item) => {
      const isOwned = this.ownedFurniture.includes(item.id);
      const canAfford = this.currentLove >= item.loveCost;
      const areaMeta = AREA_INFO_MAP[item.area];

      if (isOwned) {
        return `
          <div class="shop-card unlocked-card">
            <div class="shop-card-info">
              <h3>${item.name} <span class="unlocked-badge">Placed</span></h3>
              <p>${item.description}</p>
              <div class="shop-card-meta">Location: <b>${areaMeta.label}</b> · <span class="bonus-tag">${item.bonusText}</span></div>
            </div>
          </div>
        `;
      }

      return `
        <div class="shop-card">
          <div class="shop-card-info">
            <h3>${item.name}</h3>
            <p>${item.description}</p>
            <div class="shop-card-meta">Location: <b>${areaMeta.label}</b> · <span class="bonus-tag">${item.bonusText}</span></div>
          </div>
          <button class="shop-action-btn buy-furniture-btn" data-furniture-id="${item.id}" ${!canAfford ? 'disabled' : ''}>
            Place Decor (${item.loveCost} 💗)
          </button>
        </div>
      `;
    }).join('');
  }

  private renderShopMilestonesContent(): string {
    return `
      <div class="milestones-intro">Complete sanctuary goals to earn Stars ⭐ for Cat Plinko!</div>
      <div class="milestones-list">
        ${this.milestonesList.map((m) => {
          const isComplete = m.current >= m.target;
          const isClaimed = m.claimed;
          const pct = Math.min(100, Math.round((m.current / m.target) * 100));

          let actionBtn = '';
          if (isClaimed) {
            actionBtn = `<span class="claimed-badge">✓ Claimed</span>`;
          } else if (isComplete) {
            actionBtn = `<button class="claim-milestone-btn" data-milestone-id="${m.id}">Claim +${m.rewardTokens} ⭐</button>`;
          } else {
            actionBtn = `<span class="milestone-reward-pill">+${m.rewardTokens} ⭐</span>`;
          }

          return `
            <div class="milestone-card ${isClaimed ? 'claimed-card' : ''}">
              <div class="milestone-info">
                <div class="milestone-title-row">
                  <b>${escapeHtml(m.title)}</b>
                  ${actionBtn}
                </div>
                <div class="milestone-desc">${escapeHtml(m.description)}</div>
                <div class="milestone-progress-bar">
                  <div class="milestone-progress-fill" style="width: ${pct}%"></div>
                </div>
                <div class="milestone-numbers">${m.current} / ${m.target}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  private renderShopUpgradesContent(): string {
    const currentLvl = this.offlineStarLevel || 1;
    const isMax = currentLvl >= 5;
    const nextDef = OFFLINE_STAR_UPGRADES[currentLvl];

    return `
      <div class="milestones-intro">Spend Care Points (CP) to upgrade passive Star generation while offline:</div>
      <div class="shop-card ${isMax ? 'unlocked-card' : ''}" style="margin-top:10px;">
        <div class="shop-card-info">
          <h3>⭐ Passive Star Generation (Level ${currentLvl} / 5)</h3>
          <p>Generates <b>${currentLvl} Star${currentLvl > 1 ? 's' : ''} per hour</b> while offline (no accumulation limit).</p>
          ${
            isMax
              ? `<div class="shop-card-meta"><span class="unlocked-badge">Maximum Level Reached (5 Stars/hr)</span></div>`
              : `<div class="shop-card-meta">Next Level: <b>${nextDef.ratePerHour} Stars/hr</b> · Cost: <b>${nextDef.costCarePoints.toLocaleString()} CP 💗</b></div>`
          }
        </div>
        ${
          !isMax && nextDef
            ? `<button class="shop-action-btn upgrade-offline-stars-btn" ${this.currentLove < nextDef.costCarePoints ? 'disabled' : ''}>
                Upgrade Rate (${nextDef.costCarePoints.toLocaleString()} 💗)
               </button>`
            : ''
        }
      </div>
    `;
  }

  private renderShopPlinkoContent(): string {
    return `
      <div class="shop-card" style="margin-top:10px;text-align:center;padding:24px 16px;">
        <div style="font-size:36px;margin-bottom:8px;">⭐ 🐾 🎰</div>
        <h3 style="font-size:18px;margin-bottom:6px;">Cat Plinko Machine</h3>
        <p style="font-size:13px;color:var(--text-dark);max-width:320px;margin:0 auto 16px;">
          Wager Stars earned from breeding and sanctuary goals to drop balls down the cosmic pegboard and discover sweet new cats!
        </p>
        <button class="shop-action-btn launch-plinko-btn" style="padding:12px 24px;font-size:15px;margin:0 auto;display:inline-flex;align-items:center;gap:8px;">
          <span class="svg-inline">${SVG_ICONS.sparkle}</span> Launch Plinko Machine
        </button>
      </div>
    `;
  }

  private renderShopSortContent(): string {
    if (this.catsList.length === 0) {
      return `<div class="empty-roster">No cats in sanctuary yet!</div>`;
    }

    return `
      <div class="roster-intro">Assign cats to different areas to balance space and friendships:</div>
      <div class="roster-list">
        ${this.catsList.map((cat) => {
          const skin = CAT_SKINS.find((s) => s.id === cat.color);
          const currentMeta = AREA_INFO_MAP[cat.area];

          const options = AREA_KEYS.map((k) => {
            const meta = AREA_INFO_MAP[k];
            const isUnlocked = this.areasState[k]?.unlocked;
            const isSelected = cat.area === k ? 'selected' : '';
            const isDisabled = !isUnlocked ? 'disabled' : '';
            return `<option value="${k}" ${isSelected} ${isDisabled}>${meta.label}${!isUnlocked ? ' (Locked)' : ''}</option>`;
          }).join('');

          const stageBadge =
            cat.stage === 'kitten'
              ? '<span class="stage-tag-badge">Kitten</span>'
              : cat.stage === 'teen'
                ? '<span class="stage-tag-badge">Teen</span>'
                : '<span class="stage-tag-badge adult-badge">Adult</span>';

          return `
            <div class="roster-cat-row">
              <div class="roster-cat-info">
                <div class="roster-title-row">
                  <span class="roster-name"><b>${escapeHtml(cat.name)}</b> ${cat.isRare ? '<span class="svg-inline">' + SVG_ICONS.sparkle + '</span>' : ''}</span>
                  ${stageBadge}
                </div>
                <span class="roster-sub">${skin?.label || cat.color} · in ${currentMeta.label}</span>
              </div>
              <div class="roster-move-wrap">
                <select class="roster-move-select" data-cat-id="${cat.id}">
                  ${options}
                </select>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  private drawCatAvatar(canvas: HTMLCanvasElement | null, cat: Cat): void {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const skinDef = CAT_SKINS.find((s) => s.id === cat.color);
    if (!skinDef) return;

    const baseImg = new Image();
    baseImg.src = `assets/cats/${skinDef.file}`;

    baseImg.onload = () => {
      const sx = 0;
      const sy = 1 * 32;
      ctx.drawImage(baseImg, sx, sy, 32, 32, 0, 0, 64, 64);

      if (cat.marking) {
        const markImg = new Image();
        markImg.src = `assets/cats/Markings/${cat.marking}`;
        markImg.onload = () => {
          ctx.drawImage(markImg, sx, sy, 32, 32, 0, 0, 64, 64);
        };
      }
    };
  }

  private openSoundPanel(): void {
    const backdrop = this.createBackdrop();
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <h2>🔊 Sound Settings</h2>
      <div style="display:flex;flex-direction:column;gap:18px;margin-top:12px;">
        <div style="display:flex;flex-direction:column;gap:6px;">
          <label style="font-weight:600;color:var(--text-dark);display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="sfx-toggle" ${sound.isSfxEnabled() ? 'checked' : ''}>
            Sound Effects
          </label>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:12px;color:#888;">🔇</span>
            <input type="range" id="sfx-volume" min="0" max="100" value="${Math.round(sound.getSfxVolume() * 100)}"
              style="flex:1;accent-color:#ff758f;">
            <span style="font-size:12px;color:#888;">🔊</span>
            <span id="sfx-vol-label" style="min-width:32px;font-size:13px;color:var(--text-dark);">${Math.round(sound.getSfxVolume() * 100)}%</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <label style="font-weight:600;color:var(--text-dark);display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="music-toggle" ${sound.isMusicEnabled() ? 'checked' : ''}>
            Background Music
          </label>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:12px;color:#888;">🔇</span>
            <input type="range" id="music-volume" min="0" max="100" value="${Math.round(sound.getMusicVolume() * 100)}"
              style="flex:1;accent-color:#a78bfa;">
            <span style="font-size:12px;color:#888;">🔊</span>
            <span id="music-vol-label" style="min-width:32px;font-size:13px;color:var(--text-dark);">${Math.round(sound.getMusicVolume() * 100)}%</span>
          </div>
        </div>
      </div>
      <button class="modal-close" id="close-sound-panel" style="margin-top:20px;">Done</button>
    `;

    const sfxToggle = modal.querySelector('#sfx-toggle') as HTMLInputElement;
    const sfxSlider = modal.querySelector('#sfx-volume') as HTMLInputElement;
    const sfxLabel = modal.querySelector('#sfx-vol-label') as HTMLElement;
    const musicToggle = modal.querySelector('#music-toggle') as HTMLInputElement;
    const musicSlider = modal.querySelector('#music-volume') as HTMLInputElement;
    const musicLabel = modal.querySelector('#music-vol-label') as HTMLElement;

    sfxToggle.addEventListener('change', () => {
      sound.setSfxEnabled(sfxToggle.checked);
      this.soundBtn.innerHTML = (sound.isSfxEnabled() || sound.isMusicEnabled()) ? SVG_ICONS.soundOn : SVG_ICONS.soundOff;
    });
    sfxSlider.addEventListener('input', () => {
      const v = parseInt(sfxSlider.value) / 100;
      sound.setSfxVolume(v);
      sfxLabel.textContent = `${sfxSlider.value}%`;
    });

    musicToggle.addEventListener('change', () => {
      sound.setMusicEnabled(musicToggle.checked);
      this.soundBtn.innerHTML = (sound.isSfxEnabled() || sound.isMusicEnabled()) ? SVG_ICONS.soundOn : SVG_ICONS.soundOff;
    });
    musicSlider.addEventListener('input', () => {
      const v = parseInt(musicSlider.value) / 100;
      sound.setMusicVolume(v);
      musicLabel.textContent = `${musicSlider.value}%`;
    });

    modal.querySelector('#close-sound-panel')!.addEventListener('click', () => {
      sound.playTap();
      backdrop.remove();
    });

    backdrop.appendChild(modal);
    this.root.appendChild(backdrop);
  }

  private openSaveMenu(): void {
    const backdrop = this.createBackdrop();
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <h2>Sanctuary Options</h2>
      <div class="subtitle">Progress autosaves every 30 seconds to this browser.</div>
      <button class="modal-action-btn" id="export-btn">Export savegame.json</button>
      <label class="modal-action-btn" style="display:block;text-align:center;margin-top:8px;cursor:pointer;">
        Import savegame.json
        <input type="file" accept="application/json" id="import-input" style="display:none;" />
      </label>
      <button class="modal-close" id="close-menu" style="background:#a59a8f;">Close</button>
    `;
    modal.querySelector('#export-btn')!.addEventListener('click', () => {
      sound.playTap();
      EventBus.emit('export-save-requested', {});
    });
    modal.querySelector('#import-input')!.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) EventBus.emit('import-save-requested', { file });
    });
    modal.querySelector('#close-menu')!.addEventListener('click', () => {
      sound.playTap();
      backdrop.remove();
    });
    backdrop.appendChild(modal);
    this.root.appendChild(backdrop);
  }

  private openPlinkoModal(): void {
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
    new PlinkoModal(this.root, gameState).open();
  }

  private showOfflineSummary(summary: { minutesAway: number; loveEarned: number; starsEarned?: number; headlines: string[] }): void {
    const backdrop = this.createBackdrop();
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
      ${
        summary.headlines.length > 0
          ? `<div class="offline-headlines-box">
              <b>While you were away:</b>
              <ul>${summary.headlines.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>
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

  private createBackdrop(): HTMLElement {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        sound.playTap();
        backdrop.remove();
      }
    });
    return backdrop;
  }
}

function cap(s?: string): string {
  if (!s || typeof s !== 'string') return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(s?: string): string {
  if (!s || typeof s !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

