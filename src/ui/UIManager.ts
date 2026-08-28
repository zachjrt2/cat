import type { Cat, CatArea, FenceLayout, GameState, Milestone, SanctuaryArea, TimeOfDay, ToolType, WeatherType } from '../data/types';
import { EventBus } from './EventBus';
import { sound } from '../systems/SoundManager';
import { CAT_SKINS, CAT_MARKINGS } from '../data/catAssets';
import { TRAITS } from '../data/traits';
import { MUTATION_CATALOG } from '../data/mutations';
import { SVG_ICONS } from './icons';
import { AREA_INFO_MAP, AUTOMATION_CATALOG, FURNITURE_CATALOG, OFFLINE_STAR_UPGRADES, calculateRehomeLove, getAreaCapacityUpgradeCost } from '../data/constants';
import { PlinkoModal } from './PlinkoModal';
import { CatGlossaryModal } from './CatGlossaryModal';

const TOOLS: { id: ToolType; svg: string; label: string }[] = [
  { id: 'food', svg: SVG_ICONS.food, label: 'Food' },
  { id: 'pet', svg: SVG_ICONS.pet, label: 'Pet' },
  { id: 'toy', svg: SVG_ICONS.toy, label: 'Toy' },
  { id: 'wash', svg: SVG_ICONS.wash, label: 'Wash' },
];

const AREA_KEYS: CatArea[] = ['yard', 'shelter', 'sunroom', 'cafe'];

export class UIManager {
  private root: HTMLElement;
  private loveEl!: HTMLElement;
  private tokensEl!: HTMLElement;
  private timeWeatherBtn!: HTMLButtonElement;
  private rosterBtn!: HTMLButtonElement;
  private perfumeBtn!: HTMLButtonElement;
  private toastStack!: HTMLElement;
  private areaNavEl!: HTMLElement;

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
  private catPerfumeCount = 0;
  private currentFenceLayout: FenceLayout = 'none';

  constructor(container: HTMLElement) {
    this.root = container;
    this.buildTopHeader();
    this.buildToolbar();
    this.buildRosterButton();
    this.buildPerfumeButton();
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
        <button class="icon-btn" id="fullscreen-btn" title="Toggle Fullscreen">
          ${SVG_ICONS.fullscreen}
        </button>
        <button class="icon-btn plinko-btn" id="plinko-btn" title="⭐ Cat Plinko (Wager Stars to Discover Cats!)">
          ${SVG_ICONS.sparkle}
        </button>
        <button class="icon-btn shop-btn" id="shop-btn" title="Sanctuary Shop & Upgrades">
          ${SVG_ICONS.shop}
        </button>
        <button class="icon-btn" id="save-menu-btn" title="Sanctuary Options & Audio Settings">
          ${SVG_ICONS.menu}
        </button>
      </div>
    `;
    parent.appendChild(hud);
    this.loveEl = hud.querySelector('#love-value')!;
    this.tokensEl = hud.querySelector('#tokens-value')!;
    this.timeWeatherBtn = hud.querySelector('#time-weather-btn')!;

    const fullscreenBtn = hud.querySelector('#fullscreen-btn') as HTMLButtonElement;
    const updateFullscreenIcon = () => {
      const isFull = Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
      fullscreenBtn.innerHTML = isFull ? SVG_ICONS.exitFullscreen : SVG_ICONS.fullscreen;
      fullscreenBtn.title = isFull ? 'Exit Fullscreen' : 'Enter Fullscreen';
    };

    const toggleFullscreen = async () => {
      sound.playTap();
      try {
        if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
          if (document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen();
          } else if ((document.documentElement as any).webkitRequestFullscreen) {
            await (document.documentElement as any).webkitRequestFullscreen();
          }
        } else {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if ((document as any).webkitExitFullscreen) {
            await (document as any).webkitExitFullscreen();
          }
        }
      } catch (err) {
        console.warn('Fullscreen request:', err);
      }
      updateFullscreenIcon();
    };

    fullscreenBtn.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', updateFullscreenIcon);
    document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);

    // Show 1-tap mobile fullscreen prompt banner if on mobile touch device
    this.showMobileFullscreenPrompt(toggleFullscreen);

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

    hud.querySelector('#save-menu-btn')!.addEventListener('click', () => this.openSaveMenu());
  }

  private showMobileFullscreenPrompt(onEnterFullscreen: () => void): void {
    const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window || (navigator as any).maxTouchPoints > 0;
    const isAlreadyFullscreen = Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
    if (!isMobile || isAlreadyFullscreen) return;

    const banner = document.createElement('div');
    banner.className = 'mobile-fullscreen-banner';
    banner.innerHTML = `
      <span>📱 Tap here to play Fullscreen!</span>
      <button class="banner-close-btn" title="Dismiss">✕</button>
    `;

    banner.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('banner-close-btn')) {
        e.stopPropagation();
        banner.remove();
        return;
      }
      onEnterFullscreen();
      banner.remove();
    });

    document.body.appendChild(banner);

    // Auto dismiss after 10 seconds or on first touch elsewhere
    setTimeout(() => {
      if (document.body.contains(banner)) banner.remove();
    }, 10000);
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
          if (this.currentArea === key) return;
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
    document.body.classList.toggle('tool-pet-active', this.selectedTool === 'pet');
    EventBus.emit('tool-selected', { tool: this.selectedTool });
  }

  /**
   * Info & Roster button replacing the old adopt button
   */
  private buildRosterButton(): void {
    const btn = document.createElement('button');
    btn.className = 'adopt-btn roster-btn';
    btn.id = 'roster-btn';
    btn.innerHTML = `<span class="roster-btn-icon">${SVG_ICONS.info}</span>`;
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

  /**
   * Cat Perfume floating button in the bottom left, mirroring the Cat Info button
   */
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
        fenceLayout?: FenceLayout;
      }) => {
        this.areasState = payload.areas;
        this.currentArea = payload.currentArea;
        this.catsList = payload.cats;
        this.ownedFurniture = payload.furniture ?? [];
        this.machinesState = payload.machines ?? {};
        this.milestonesList = payload.milestones ?? [];
        this.currentTokens = payload.tokens ?? 0;
        this.offlineStarLevel = payload.offlineStarLevel ?? 1;
        this.catPerfumeCount = (payload as any).catPerfumeCount ?? 0;
        this.currentFenceLayout = payload.fenceLayout ?? 'none';
        this.tokensEl.textContent = this.currentTokens.toString();
        this.renderAreaNav();

        if (this.perfumeBtn) {
          this.perfumeBtn.style.display = this.catPerfumeCount > 0 ? 'flex' : 'none';
          const badge = this.perfumeBtn.querySelector('#perfume-count-badge');
          if (badge) badge.textContent = `x${this.catPerfumeCount}`;
        }
      },
    );

    EventBus.on('toast', ({ message }: { message: string }) => this.showToast(message));

    EventBus.on('cat-info', ({ cat }: { cat: Cat }) => this.openJournal(cat));

    EventBus.on('prompt-rehome-modal', ({ cat }: { cat: Cat }) => {
      const reward = calculateRehomeLove(cat);
      this.openRehomeConfirmModal(cat, reward, () => {});
    });

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
    let cancelAvatarAnimation: (() => void) | null = null;
    const backdrop = this.createBackdrop();
    const modal = document.createElement('div');
    modal.className = 'modal journal-modal carousel-modal';

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        sound.playTap();
        cancelAvatarAnimation?.();
        backdrop.remove();
      }
    });

    let isNavigating = false;
    const navigateToCat = (newIndex: number, direction: 'next' | 'prev') => {
      if (isNavigating) return;
      isNavigating = true;
      sound.playTap();
      cancelAvatarAnimation?.();
      cancelAvatarAnimation = null;
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

      const mutDef = cat.mutation ? MUTATION_CATALOG[cat.mutation] : null;
      const mutationBadge = mutDef
        ? `
          <div class="mutation-badge-card" style="background:${mutDef.tagBg};color:${mutDef.tagColor};border:1.5px solid ${mutDef.borderHex};border-radius:10px;padding:6px 10px;margin-top:6px;text-align:left;">
            <div style="font-size:12px;font-weight:900;letter-spacing:0.3px;margin-bottom:2px;">${escapeHtml(mutDef.badgeLabel)}</div>
            <div style="font-size:11px;opacity:0.9;margin-bottom:3px;line-height:1.3;">${escapeHtml(mutDef.description)}</div>
            <div style="font-size:11px;font-weight:700;line-height:1.3;"><b>Perk:</b> ${escapeHtml(mutDef.perk)}</div>
          </div>
        `
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
          <div class="journal-avatar-wrapper clickable-avatar" id="open-cat-glossary-btn" title="Click to view Cat Types & Mutations Glossary 📖">
            <canvas id="journal-cat-canvas" width="64" height="64" class="journal-avatar-canvas"></canvas>
            <div class="avatar-glossary-badge" title="Open Cat Types Glossary">
              <span class="svg-inline">${SVG_ICONS.book}</span>
              <span>Glossary</span>
            </div>
          </div>
          <div class="journal-title-box">
            <div class="name-edit-row" id="name-display-row">
              <h2 id="cat-name-display">${escapeHtml(cat.name)}</h2>
              <button class="rename-cat-btn" id="rename-cat-btn" title="Rename Cat (200 Care Points 💗)">
                <span class="svg-inline">${SVG_ICONS.edit}</span> Rename (200 💗)
              </button>
            </div>
            <div class="rename-inline-box" id="rename-inline-box" style="display: none;">
              <input type="text" id="rename-input" class="rename-input" maxlength="24" value="${escapeHtml(cat.name)}" placeholder="Enter new name..." />
              <div class="rename-btn-group">
                <button class="rename-confirm-btn" id="rename-confirm-btn">Save (200 💗)</button>
                <button class="rename-cancel-btn" id="rename-cancel-btn">Cancel</button>
              </div>
            </div>
            <div class="coat-tag clickable-coat-tag" id="open-coat-tag-glossary-btn" title="Click to view all markings for ${escapeHtml(skinName)} in Glossary">
              <span>${escapeHtml(skinName)} · ${stageLabel}</span>
              <span class="coat-tag-book-icon">${SVG_ICONS.book}</span>
            </div>
            ${rareBadge}
            ${mutationBadge}
          </div>
        </div>

        ${growthHtml}

        <div class="area-reassign-box">
          <div class="area-reassign-left">
            <label for="cat-area-select"><b>Area:</b></label>
            <select id="cat-area-select" class="area-select-dropdown">
              ${areaOptions}
            </select>
          </div>
          <button class="sort-all-cats-btn" id="sort-all-cats-btn" title="Sort & Reassign All Cats">
            <span class="svg-inline">${SVG_ICONS.paw}</span> Sort All
          </button>
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
            <span class="need-label"><span class="svg-inline">${SVG_ICONS.toy}</span> Fun</span>
            <div class="progress-track"><div class="progress-fill fill-fun" style="width: ${cat.fun}%"></div></div>
            <span class="need-pct-fun">${Math.round(cat.fun)}%</span>
          </div>
          <div class="need-bar-item">
            <span class="need-label"><span class="svg-inline">${SVG_ICONS.wash}</span> Cleanliness</span>
            <div class="progress-track"><div class="progress-fill fill-clean" style="width: ${cat.cleanliness}%"></div></div>
            <span class="need-pct-clean">${Math.round(cat.cleanliness)}%</span>
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

        <!-- Compact Loving Forever Home Row -->
        <div class="rehome-compact-row">
          <div class="rehome-compact-info">
            <span class="svg-inline">${SVG_ICONS.lovingHome}</span>
            <span class="rehome-compact-text">Find a Loving Forever Home</span>
          </div>
          <button class="rehome-compact-btn" id="rehome-cat-btn" title="Adopt out ${escapeHtml(cat.name)} for +${rehomeVal.total.toLocaleString()} Care Points">
            <span>+${rehomeVal.total.toLocaleString()} 💗</span>
          </button>
        </div>

        <button class="modal-action-btn glossary-action-btn" id="open-glossary-action-btn">
          <span class="svg-inline">${SVG_ICONS.book}</span> Cat Coats & Markings Glossary
        </button>

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

      modal.querySelector('#open-cat-glossary-btn')?.addEventListener('click', () => {
        sound.playTap();
        new CatGlossaryModal(this.root, { cats: this.catsList } as any).open('all', cat.color);
      });

      modal.querySelector('#open-coat-tag-glossary-btn')?.addEventListener('click', () => {
        sound.playTap();
        new CatGlossaryModal(this.root, { cats: this.catsList } as any).open('all', cat.color);
      });

      modal.querySelector('#open-glossary-action-btn')?.addEventListener('click', () => {
        sound.playTap();
        new CatGlossaryModal(this.root, { cats: this.catsList } as any).open('all', cat.color);
      });

      modal.querySelector('#instant-grow-btn')?.addEventListener('click', () => {
        sound.playTap();
        EventBus.emit('instant-grow-cat', { catId: cat.id, cost: growCost });
        setTimeout(() => renderCurrentCat(), 200);
      });

      // Rename Cat Action (200 Care Points)
      const renameBtn = modal.querySelector('#rename-cat-btn') as HTMLButtonElement | null;
      const renameBox = modal.querySelector('#rename-inline-box') as HTMLElement | null;
      const nameRow = modal.querySelector('#name-display-row') as HTMLElement | null;
      const renameInput = modal.querySelector('#rename-input') as HTMLInputElement | null;
      const confirmBtn = modal.querySelector('#rename-confirm-btn') as HTMLButtonElement | null;
      const cancelBtn = modal.querySelector('#rename-cancel-btn') as HTMLButtonElement | null;

      if (renameBtn && renameBox && nameRow && renameInput && confirmBtn && cancelBtn) {
        renameBtn.addEventListener('click', () => {
          sound.playTap();
          nameRow.style.display = 'none';
          renameBox.style.display = 'flex';
          renameInput.value = cat.name;
          renameInput.focus();
          renameInput.select();
        });

        cancelBtn.addEventListener('click', () => {
          sound.playTap();
          renameBox.style.display = 'none';
          nameRow.style.display = 'flex';
        });

        const performRename = () => {
          const newName = renameInput.value.trim();
          if (!newName || newName === cat.name) {
            renameBox.style.display = 'none';
            nameRow.style.display = 'flex';
            return;
          }

          if (this.currentLove < 200) {
            sound.playTap();
            this.showToast('Not enough Care Points. Need 200 💗 to rename.');
            return;
          }

          sound.playSparkle();
          sound.playCoin();
          EventBus.emit('rename-cat', { catId: cat.id, newName, cost: 200 });
          cat.name = newName;
          const nameDisplay = modal.querySelector('#cat-name-display');
          if (nameDisplay) nameDisplay.textContent = newName;
          renameBox.style.display = 'none';
          nameRow.style.display = 'flex';
        };

        confirmBtn.addEventListener('click', performRename);
        renameInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            performRename();
          } else if (e.key === 'Escape') {
            renameBox.style.display = 'none';
            nameRow.style.display = 'flex';
          }
        });
      }

      const selectEl = modal.querySelector('#cat-area-select') as HTMLSelectElement;
      selectEl.addEventListener('change', () => {
        const newArea = selectEl.value as CatArea;
        if (newArea !== cat.area) {
          EventBus.emit('move-cat', { catId: cat.id, toArea: newArea });
        }
      });

      modal.querySelector('#sort-all-cats-btn')?.addEventListener('click', () => {
        sound.playTap();
        backdrop.remove();
        this.openCatSortingModal();
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
          cancelAvatarAnimation?.();
          backdrop.remove();
        });
      });

      modal.querySelector('#export-card-btn')!.addEventListener('click', () => {
        sound.playTap();
        EventBus.emit('export-cat-card', { catId: cat.id });
      });

      modal.querySelector('#journal-close-btn')!.addEventListener('click', () => {
        sound.playTap();
        cancelAvatarAnimation?.();
        backdrop.remove();
      });

      cancelAvatarAnimation?.();
      cancelAvatarAnimation = this.startCatAvatarAnimation(modal.querySelector('#journal-cat-canvas') as HTMLCanvasElement, cat);
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
        <h2>Find ${escapeHtml(cat.name)}'s Forever Home?</h2>
      </div>

      <p class="rehome-confirm-body">
        Would you like to find a loving forever home for <b>${escapeHtml(cat.name)}</b> (${cap(cat.stage)}${rarityBadge})?
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
          Yes, Find Forever Home (+${reward.total.toLocaleString()} 💗)
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

  private openShopModal(defaultTab: 'areas' | 'machines' | 'furniture' | 'milestones' | 'upgrades' = 'areas'): void {
    const backdrop = this.createBackdrop();
    const modal = document.createElement('div');
    modal.className = 'modal shop-modal';

    const renderTabs = (activeTab: 'areas' | 'machines' | 'furniture' | 'milestones' | 'upgrades', preserveScroll = true) => {
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
        </div>

        <div class="shop-content">
          ${activeTab === 'areas'
          ? this.renderShopAreasContent()
          : activeTab === 'machines'
            ? this.renderShopMachinesContent()
            : activeTab === 'furniture'
              ? this.renderShopFurnitureContent()
              : activeTab === 'milestones'
                ? this.renderShopMilestonesContent()
                : this.renderShopUpgradesContent()
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

      // Bind Buy Cat Perfume button
      modal.querySelectorAll('.buy-perfume-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          EventBus.emit('buy-cat-perfume', {});
          setTimeout(() => renderTabs('upgrades', true), 200);
        });
      });

      // Bind Fence Layout Selector buttons
      modal.querySelectorAll('.fence-option-card').forEach((card) => {
        card.addEventListener('click', () => {
          const layout = (card as HTMLElement).dataset.fenceLayout as FenceLayout;
          if (layout) {
            this.currentFenceLayout = layout;
            EventBus.emit('fence-layout-changed', { layout });
            EventBus.emit('toast', {
              message: `🏡 Sanctuary Fence Layout updated to ${layout === 'none' ? 'Open' : layout === 'horizontal' ? 'Horizontal Split' : layout === 'vertical' ? 'Vertical Split' : '4-Quadrant Cross'}!`,
            });
            setTimeout(() => renderTabs('upgrades', true), 100);
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

      const capacityCost = getAreaCapacityUpgradeCost(areaState, meta.baseCapacity);
      const canUpgrade = this.currentLove >= capacityCost;

      return `
        <div class="shop-card unlocked-card">
          <div class="shop-card-info">
            <h3><span class="svg-inline">${SVG_ICONS[k] || SVG_ICONS.yard}</span> ${meta.label} <span class="unlocked-badge">Active</span></h3>
            <p>${meta.description}</p>
            <div class="shop-card-meta">Current Capacity: <b>${count} / ${areaState.capacity} cats</b></div>
          </div>
          <button class="shop-action-btn upgrade-cap-btn" data-area="${k}" ${!canUpgrade ? 'disabled' : ''}>
            +5 Space (${capacityCost.toLocaleString()} 💗)
          </button>
        </div>
      `;
    }).join('');
  }

  private renderShopMachinesContent(): string {
    return `
      <div class="machines-intro">
        Install automated stations for each area. Cats sense when their need is below the station's tier threshold (<b>50% at Tier 1</b>, <b>80% at Tier 2</b>, <b>100% at Tier 3</b>) and seek them out!
      </div>
      <div class="machines-catalog-grid">
        ${AUTOMATION_CATALOG.map((m) => {
      const areaUnlocked = this.areasState[m.area]?.unlocked;
      const currentLevel = this.machinesState[m.id] || 0;
      const areaMeta = AREA_INFO_MAP[m.area];

      let statusBadge = '';
      let actionBtn = '';
      let tierCapText = 'Installs Tier 1 (Cares up to 50%)';

      if (!areaUnlocked) {
        statusBadge = `<span class="lock-badge">Locked Area</span>`;
        actionBtn = `<button class="shop-action-btn" disabled>Unlock ${areaMeta.label}</button>`;
      } else if (currentLevel === 0) {
        const canAfford = this.currentLove >= m.baseCost;
        statusBadge = `<span class="machine-unowned-badge">Not Installed</span>`;
        actionBtn = `
              <button class="shop-action-btn buy-machine-btn" data-machine-id="${m.id}" ${!canAfford ? 'disabled' : ''}>
                Install Tier 1 (${m.baseCost.toLocaleString()} 💗)
              </button>
            `;
      } else if (currentLevel < 3) {
        const upgradeCost = currentLevel === 1 ? m.upgradeCostLvl2 : m.upgradeCostLvl3;
        const nextCap = currentLevel === 1 ? '80%' : '100%';
        tierCapText = `Current: Tier ${currentLevel} (Cares up to ${currentLevel === 1 ? '50%' : '80%'}) · Next: up to ${nextCap}`;
        const canAfford = this.currentLove >= upgradeCost;
        statusBadge = `<span class="unlocked-badge">Tier ${currentLevel} (up to ${currentLevel === 1 ? '50%' : '80%'})</span>`;
        actionBtn = `
              <button class="shop-action-btn upgrade-machine-btn" data-machine-id="${m.id}" ${!canAfford ? 'disabled' : ''}>
                Upgrade to Tier ${currentLevel + 1} (${upgradeCost.toLocaleString()} 💗)
              </button>
            `;
      } else {
        tierCapText = 'Current: Tier 3 Max (Cares up to 100%)';
        statusBadge = `<span class="unlocked-badge tier-max-badge">Tier 3 Max (100%)</span>`;
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
                  Location: <b>${areaMeta.label}</b> · Need: <b>${cap(m.needType)}</b> · <span class="bonus-tag">${tierCapText}</span>
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
          ${isMax
        ? `<div class="shop-card-meta"><span class="unlocked-badge">Maximum Level Reached (5 Stars/hr)</span></div>`
        : `<div class="shop-card-meta">Next Level: <b>${nextDef.ratePerHour} Stars/hr</b> · Cost: <b>${nextDef.costCarePoints.toLocaleString()} CP 💗</b></div>`
      }
        </div>
        ${!isMax && nextDef
        ? `<button class="shop-action-btn upgrade-offline-stars-btn" ${this.currentLove < nextDef.costCarePoints ? 'disabled' : ''}>
                Upgrade Rate (${nextDef.costCarePoints.toLocaleString()} 💗)
               </button>`
        : ''
      }
      </div>

      <!-- Consumable: Cat Perfume -->
      <div class="shop-card" style="margin-top:14px;border-left: 4px solid #ec4899;">
        <div class="shop-card-info">
          <div class="machine-title-row">
            <h3><span class="svg-inline">${SVG_ICONS.perfume}</span> Cat Perfume (Consumable)</h3>
            <span class="unlocked-badge" style="background:#fce7f3;color:#be185d;font-weight:bold;">Stock: <b>${this.catPerfumeCount}</b></span>
          </div>
          <p>Drag & drop onto an adult cat for a <b>10-second Breeding Frenzy</b>! The cat seeks out and mates with every available adult in the area for ⭐ Stars! (10m cooldown per cat)</p>
          <div class="shop-card-meta">
            Cost: <b>200 CP 💗</b> · Consumable Item
          </div>
        </div>
        <div class="machine-action-wrap">
          <button class="shop-action-btn buy-perfume-btn" ${this.currentLove < 200 ? 'disabled' : ''}>
            Buy Perfume (200 💗)
          </button>
        </div>
      </div>

      <!-- Sanctuary Fences & Sorting Dividers -->
      <div class="shop-card" style="margin-top:14px;border-left: 4px solid #f59e0b;display:block;">
        <div class="shop-card-info" style="margin-bottom:10px;">
          <div class="machine-title-row">
            <h3>🏡 Sanctuary Sorting Fences</h3>
            <span class="unlocked-badge" style="background:#fef3c7;color:#92400e;font-weight:bold;">Free Layout Toggle</span>
          </div>
          <p>Split your sanctuary into separate pens to sort kittens, breeding pairs, or favorites. Drag cats across fences to sort them anytime!</p>
        </div>

        <div class="fence-layout-selector">
          <button type="button" class="fence-option-card ${this.currentFenceLayout === 'none' ? 'active' : ''}" data-fence-layout="none">
            <div class="fence-diagram fence-diag-none"></div>
            <span class="fence-card-title">None</span>
            <span class="fence-card-sub">Open Room</span>
          </button>

          <button type="button" class="fence-option-card ${this.currentFenceLayout === 'horizontal' ? 'active' : ''}" data-fence-layout="horizontal">
            <div class="fence-diagram fence-diag-h"></div>
            <span class="fence-card-title">Horizontal</span>
            <span class="fence-card-sub">Top / Bottom</span>
          </button>

          <button type="button" class="fence-option-card ${this.currentFenceLayout === 'vertical' ? 'active' : ''}" data-fence-layout="vertical">
            <div class="fence-diagram fence-diag-v"></div>
            <span class="fence-card-title">Vertical</span>
            <span class="fence-card-sub">Left / Right</span>
          </button>

          <button type="button" class="fence-option-card ${this.currentFenceLayout === 'both' ? 'active' : ''}" data-fence-layout="both">
            <div class="fence-diagram fence-diag-both"></div>
            <span class="fence-card-title">Cross</span>
            <span class="fence-card-sub">4 Quadrants</span>
          </button>
        </div>
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

  private static avatarImageCache: Map<string, HTMLImageElement> = new Map();

  private startCatAvatarAnimation(canvas: HTMLCanvasElement | null, cat: Cat): () => void {
    if (!canvas) return () => { };
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => { };

    ctx.imageSmoothingEnabled = false;

    const skinDef = CAT_SKINS.find((s) => s.id === cat.color);
    if (!skinDef) return () => { };

    let stopped = false;
    let animReq: number | null = null;

    const getImage = (src: string, cb: (img: HTMLImageElement) => void) => {
      if (UIManager.avatarImageCache.has(src)) {
        const img = UIManager.avatarImageCache.get(src)!;
        if (img.complete && img.naturalWidth > 0) {
          cb(img);
        } else {
          img.addEventListener('load', () => cb(img), { once: true });
        }
      } else {
        const img = new Image();
        img.src = src;
        UIManager.avatarImageCache.set(src, img);
        img.addEventListener('load', () => cb(img), { once: true });
      }
    };

    const baseSrc = `assets/cats/${skinDef.file}`;
    const markSrc = cat.marking ? `assets/cats/Markings/${encodeURIComponent(cat.marking)}` : null;

    let baseImg: HTMLImageElement | null = null;
    let markImg: HTMLImageElement | null = null;

    getImage(baseSrc, (img) => { baseImg = img; });
    if (markSrc) {
      getImage(markSrc, (img) => { markImg = img; });
    }

    // Direction 0 = Facing front/camera (row 1 & 2)
    // Playlist: 2x Sit Idle -> 1x Look Around -> 2x Sit Idle -> 1x Play Batting Paw -> 1x Stretch/Lay
    interface AnimFrame { col: number; row: number; dur: number }

    const sitFrames: AnimFrame[] = [
      { col: 0, row: 1, dur: 280 },
      { col: 1, row: 1, dur: 280 },
      { col: 2, row: 1, dur: 280 },
      { col: 3, row: 1, dur: 320 },
      { col: 2, row: 1, dur: 280 },
      { col: 1, row: 1, dur: 280 },
    ];

    const lookFrames: AnimFrame[] = [
      { col: 4, row: 1, dur: 200 },
      { col: 5, row: 1, dur: 200 },
      { col: 6, row: 1, dur: 200 },
      { col: 7, row: 1, dur: 360 },
      { col: 6, row: 1, dur: 200 },
      { col: 5, row: 1, dur: 200 },
    ];

    const playFrames: AnimFrame[] = [
      { col: 16, row: 2, dur: 150 },
      { col: 17, row: 2, dur: 150 },
      { col: 18, row: 2, dur: 150 },
      { col: 19, row: 2, dur: 240 },
      { col: 18, row: 2, dur: 150 },
      { col: 17, row: 2, dur: 150 },
    ];

    const layFrames: AnimFrame[] = [
      { col: 8, row: 1, dur: 240 },
      { col: 9, row: 1, dur: 240 },
      { col: 10, row: 1, dur: 260 },
      { col: 11, row: 1, dur: 380 },
      { col: 10, row: 1, dur: 240 },
      { col: 9, row: 1, dur: 240 },
    ];

    const playlist: AnimFrame[] = [
      ...sitFrames,
      ...sitFrames,
      ...lookFrames,
      ...sitFrames,
      ...playFrames,
      ...sitFrames,
      ...layFrames,
    ];

    let currentFrameIdx = 0;
    let lastFrameTime = performance.now();

    const draw = (now: number) => {
      if (stopped) return;

      const currentFrame = playlist[currentFrameIdx];
      if (now - lastFrameTime >= currentFrame.dur) {
        currentFrameIdx = (currentFrameIdx + 1) % playlist.length;
        lastFrameTime = now;
      }

      const frame = playlist[currentFrameIdx];
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (baseImg && baseImg.complete && baseImg.naturalWidth > 0) {
        ctx.save();
        if (cat.mutation === 'inverted') {
          ctx.filter = 'invert(1)';
        } else if (cat.mutation === 'gilded') {
          ctx.filter = 'sepia(0.9) saturate(3) hue-rotate(5deg)';
        } else if (cat.mutation === 'frosted') {
          ctx.filter = 'hue-rotate(180deg) saturate(1.8) brightness(1.1)';
        } else if (cat.mutation === 'flaming') {
          ctx.filter = 'hue-rotate(335deg) saturate(2.4) brightness(1.15)';
        } else if (cat.mutation === 'chromatic') {
          ctx.filter = `hue-rotate(${(now / 18) % 360}deg) saturate(2.2)`;
        }

        const sx = frame.col * 32;
        const sy = frame.row * 32;
        ctx.drawImage(baseImg, sx, sy, 32, 32, 0, 0, canvas.width, canvas.height);

        if (markImg && markImg.complete && markImg.naturalWidth > 0) {
          ctx.drawImage(markImg, sx, sy, 32, 32, 0, 0, canvas.width, canvas.height);
        }

        ctx.restore();
      }

      animReq = requestAnimationFrame(draw);
    };

    animReq = requestAnimationFrame(draw);

    return () => {
      stopped = true;
      if (animReq !== null) {
        cancelAnimationFrame(animReq);
        animReq = null;
      }
    };
  }

  private openCatSortingModal(): void {
    const backdrop = this.createBackdrop();
    const modal = document.createElement('div');
    modal.className = 'modal roster-modal';

    const renderRoster = () => {
      modal.innerHTML = `
        <div class="shop-header">
          <h2>🐾 Sort & Manage Cats</h2>
          <span class="shop-tokens-balance">${this.catsList.length} Cats</span>
        </div>
        <div class="subtitle" style="margin-bottom:12px;">Assign cats to different areas to balance capacity and companionship.</div>
        <div class="shop-content" style="max-height: 55vh; overflow-y: auto; padding-right: 4px;">
          ${this.renderShopSortContent()}
        </div>
        <button class="modal-close" id="roster-close-btn" style="margin-top:16px;">Done</button>
      `;

      modal.querySelectorAll('.roster-move-select').forEach((sel) => {
        sel.addEventListener('change', (e) => {
          const target = e.target as HTMLSelectElement;
          const catId = target.dataset.catId;
          const toArea = target.value as CatArea;
          if (catId && toArea) {
            sound.playTap();
            EventBus.emit('move-cat', { catId, toArea });
            const cat = this.catsList.find((c) => c.id === catId);
            if (cat) {
              cat.area = toArea;
              const row = target.closest('.roster-cat-row');
              const subEl = row?.querySelector('.roster-sub');
              const skin = CAT_SKINS.find((s) => s.id === cat.color);
              const currentMeta = AREA_INFO_MAP[toArea];
              if (subEl && currentMeta) {
                subEl.textContent = `${skin?.label || cat.color} · in ${currentMeta.label}`;
              }
            }
          }
        });
      });

      modal.querySelector('#roster-close-btn')?.addEventListener('click', () => {
        sound.playTap();
        backdrop.remove();
      });
    };

    renderRoster();
    backdrop.appendChild(modal);
    this.root.appendChild(backdrop);
  }

  private openSaveMenu(): void {
    const backdrop = this.createBackdrop();
    const modal = document.createElement('div');
    modal.className = 'modal options-modal';
    modal.innerHTML = `
      <h2>⚙️ Sanctuary Options & Sound</h2>
      <div class="subtitle">Thanks to <a href="https://pop-shop-packs.itch.io/" target="_blank" rel="noopener noreferrer">Pop shop</a> packs for the cats that inspired this game.</div>

      <!-- Sound Settings Section -->
      <div class="options-section">
        <h3>🔊 Audio Settings</h3>
        <div class="sound-controls-group">
          <div class="sound-control-row">
            <label class="sound-toggle-label">
              <input type="checkbox" id="sfx-toggle" ${sound.isSfxEnabled() ? 'checked' : ''}>
              <b>Sound Effects (SFX)</b>
            </label>
            <div class="sound-slider-wrap">
              <span>🔇</span>
              <input type="range" id="sfx-volume" min="0" max="100" value="${Math.round(sound.getSfxVolume() * 100)}" class="options-slider">
              <span>🔊</span>
              <span id="sfx-vol-label" class="vol-label">${Math.round(sound.getSfxVolume() * 100)}%</span>
            </div>
          </div>

          <div class="sound-control-row">
            <label class="sound-toggle-label">
              <input type="checkbox" id="music-toggle" ${sound.isMusicEnabled() ? 'checked' : ''}>
              <b>Background Music</b>
            </label>
            <div class="sound-slider-wrap">
              <span>🔇</span>
              <input type="range" id="music-volume" min="0" max="100" value="${Math.round(sound.getMusicVolume() * 100)}" class="options-slider">
              <span>🔊</span>
              <span id="music-vol-label" class="vol-label">${Math.round(sound.getMusicVolume() * 100)}%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Save & Backup Section -->
      <div class="options-section" style="margin-top: 14px;">
        <h3>💾 Save File & Backup</h3>
        <p style="font-size:12px;color:var(--brown-light);margin:2px 0 10px;">Progress automatically autosaves to your browser every 30 seconds.</p>
        <div class="options-btn-grid">
          <button class="modal-action-btn" id="export-btn">
            Download savegame.json
          </button>
          <label class="modal-action-btn import-btn-label">
            Import savegame.json
            <input type="file" accept="application/json" id="import-input" style="display:none;" />
          </label>
        </div>
      </div>

      <button class="modal-close" id="close-menu" style="margin-top:18px;">Done</button>
    `;

    const sfxToggle = modal.querySelector('#sfx-toggle') as HTMLInputElement;
    const sfxSlider = modal.querySelector('#sfx-volume') as HTMLInputElement;
    const sfxLabel = modal.querySelector('#sfx-vol-label') as HTMLElement;
    const musicToggle = modal.querySelector('#music-toggle') as HTMLInputElement;
    const musicSlider = modal.querySelector('#music-volume') as HTMLInputElement;
    const musicLabel = modal.querySelector('#music-vol-label') as HTMLElement;

    sfxToggle.addEventListener('change', () => {
      sound.setSfxEnabled(sfxToggle.checked);
    });
    sfxSlider.addEventListener('input', () => {
      const v = parseInt(sfxSlider.value) / 100;
      sound.setSfxVolume(v);
      sfxLabel.textContent = `${sfxSlider.value}%`;
    });

    musicToggle.addEventListener('change', () => {
      sound.setMusicEnabled(musicToggle.checked);
    });
    musicSlider.addEventListener('input', () => {
      const v = parseInt(musicSlider.value) / 100;
      sound.setMusicVolume(v);
      musicLabel.textContent = `${musicSlider.value}%`;
    });

    modal.querySelector('#export-btn')!.addEventListener('click', () => {
      sound.playTap();
      EventBus.emit('export-save-requested', {});
    });
    modal.querySelector('#import-input')!.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        sound.playTap();
        EventBus.emit('import-save-requested', { file });
        backdrop.remove();
      }
    });
    modal.querySelector('#close-menu')!.addEventListener('click', () => {
      sound.playTap();
      backdrop.remove();
    });

    backdrop.appendChild(modal);
    this.root.appendChild(backdrop);
  }

  private openPlinkoModal(): void {
    // Check if there is room for cats in any unlocked sanctuary area
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
      ${summary.headlines.length > 0
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

