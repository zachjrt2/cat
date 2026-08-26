import type { Cat, CatArea, Milestone, RareCatType, SanctuaryArea, TimeOfDay, ToolType, WeatherType } from '../data/types';
import { EventBus } from './EventBus';
import { sound } from '../systems/SoundManager';
import { CAT_SKINS, CAT_MARKINGS } from '../data/catAssets';
import { TRAITS } from '../data/traits';
import { SVG_ICONS } from './icons';
import { AREA_INFO_MAP, FURNITURE_CATALOG, RARE_SUMMONS } from '../data/constants';

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
  private adoptBtn!: HTMLButtonElement;
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
  private milestonesList: Milestone[] = [];

  constructor(container: HTMLElement) {
    this.root = container;
    this.buildTopHeader();
    this.buildToolbar();
    this.buildAdoptButton();
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
        <div class="hud-love" title="Total Love">
          <span class="hud-icon heart-icon">${SVG_ICONS.heart}</span>
          <span id="love-value">0</span>
        </div>
        <div class="hud-tokens" id="tokens-pill" title="Adoption Tokens">
          <span class="token-star">⭐</span>
          <span id="tokens-value">0</span>
        </div>
      </div>

      <div class="hud-center-group">
        <button class="hud-weather-btn" id="time-weather-btn" title="Click to cycle Time / Weather">
          <span id="time-weather-text">☀️ Sunny</span>
        </button>
      </div>

      <div class="hud-actions">
        <button class="icon-btn shop-btn" id="shop-btn" title="Sanctuary Shop & Milestones">
          ${SVG_ICONS.shop}
        </button>
        <button class="icon-btn" id="sound-toggle-btn" title="Toggle Sound">
          ${sound.isSoundEnabled() ? SVG_ICONS.soundOn : SVG_ICONS.soundOff}
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

    this.timeWeatherBtn.addEventListener('click', () => {
      sound.playTap();
      EventBus.emit('toggle-time', {});
    });

    hud.querySelector('#shop-btn')!.addEventListener('click', () => {
      sound.playTap();
      this.openShopModal();
    });

    this.soundBtn.addEventListener('click', () => {
      const enabled = sound.toggleSound();
      this.soundBtn.innerHTML = enabled ? SVG_ICONS.soundOn : SVG_ICONS.soundOff;
      this.showToast(enabled ? 'Sound enabled 🔊' : 'Sound muted 🔇');
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

      const btn = document.createElement('button');
      btn.className = `area-nav-btn ${this.currentArea === key ? 'active' : ''} ${!areaState?.unlocked ? 'locked' : ''}`;

      if (areaState?.unlocked) {
        btn.innerHTML = `<span class="area-emoji">${info.emoji}</span><span>${info.label}</span><span class="area-count">${count}/${areaState.capacity}</span>`;
        btn.addEventListener('click', () => {
          EventBus.emit('switch-area', { area: key });
        });
      } else {
        btn.innerHTML = `<span class="area-emoji">${info.emoji}</span><span>${info.label}</span><span class="lock-badge">🔒</span>`;
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

    // Care All in Area Quick Action
    const careAllBtn = document.createElement('button');
    careAllBtn.className = 'tool-btn care-all-btn';
    careAllBtn.title = 'Nourish & care for all cats in this area at once!';
    careAllBtn.innerHTML = `<span class="tool-icon">🌟</span><span>Care All</span>`;
    careAllBtn.addEventListener('click', () => {
      sound.playTap();
      careAllBtn.classList.add('pulse-pop');
      setTimeout(() => careAllBtn.classList.remove('pulse-pop'), 300);
      EventBus.emit('care-all-in-area', {});
    });
    bar.appendChild(careAllBtn);

    this.root.appendChild(bar);
  }

  private selectTool(tool: ToolType, btn: HTMLElement): void {
    const alreadySelected = this.selectedTool === tool;
    this.root.querySelectorAll('.tool-btn').forEach((el) => el.classList.remove('selected'));
    this.selectedTool = alreadySelected ? null : tool;
    if (!alreadySelected) btn.classList.add('selected');
    EventBus.emit('tool-selected', { tool: this.selectedTool });
  }

  private buildAdoptButton(): void {
    const btn = document.createElement('button');
    btn.className = 'adopt-btn';
    btn.innerHTML = `<span class="adopt-paw-icon">${SVG_ICONS.paw}</span><span>Adopt</span>`;
    btn.addEventListener('click', () => {
      sound.playTap();
      EventBus.emit('adopt-requested', {});
    });
    this.root.appendChild(btn);
    this.adoptBtn = btn;
  }

  private buildToastStack(): void {
    const stack = document.createElement('div');
    stack.id = 'toast-stack';
    this.root.appendChild(stack);
    this.toastStack = stack;
  }

  private showToast(message: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = message;
    this.toastStack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-10px)';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  private bindBusEvents(): void {
    EventBus.on('love-changed', ({ love }: { love: number }) => {
      this.currentLove = Math.floor(love);
      this.loveEl.textContent = this.currentLove.toLocaleString();
    });

    EventBus.on('tokens-changed', ({ tokens }: { tokens: number }) => {
      this.currentTokens = tokens;
      this.tokensEl.textContent = this.currentTokens.toString();
    });

    EventBus.on('cats-changed', ({ count }: { count: number }) => {
      this.currentCatCount = count;
      this.adoptBtn.title = `Adopt a cat (${this.currentCatCount} currently in sanctuary)`;
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
        milestones: Milestone[];
        tokens: number;
      }) => {
        this.areasState = payload.areas;
        this.currentArea = payload.currentArea;
        this.catsList = payload.cats;
        this.ownedFurniture = payload.furniture ?? [];
        this.milestonesList = payload.milestones ?? [];
        this.currentTokens = payload.tokens ?? 0;
        this.tokensEl.textContent = this.currentTokens.toString();
        this.renderAreaNav();
      },
    );

    EventBus.on('toast', ({ message }: { message: string }) => this.showToast(message));

    EventBus.on('cat-info', ({ cat }: { cat: Cat }) => this.openJournal(cat));
    EventBus.on('journal-data', ({ cat, areas }: { cat: Cat; areas: Record<CatArea, SanctuaryArea> }) => {
      this.renderJournal(cat, areas);
    });

    EventBus.on('offline-summary', (summary: { minutesAway: number; loveEarned: number; headlines: string[] }) => {
      this.showOfflineSummary(summary);
    });
  }

  private updateWeatherButtonText(): void {
    const timeLabels: Record<TimeOfDay, string> = {
      morning: '🌅 Morning',
      day: '☀️ Day',
      sunset: '🌄 Sunset',
      night: '🌙 Night',
    };
    const weatherIcons: Record<WeatherType, string> = {
      sunny: '',
      rain: '🌧️',
      snow: '❄️',
    };
    const weatherPrefix = weatherIcons[this.currentWeather] ? `${weatherIcons[this.currentWeather]} ` : '';
    const label = `${weatherPrefix}${timeLabels[this.currentTimeOfDay]}`;
    this.timeWeatherBtn.querySelector('#time-weather-text')!.textContent = label;
  }

  private openJournal(cat: Cat): void {
    EventBus.emit('journal-requested', { catId: cat.id });
  }

  private renderJournal(cat: Cat, areas?: Record<CatArea, SanctuaryArea>): void {
    const backdrop = this.createBackdrop();
    const modal = document.createElement('div');
    modal.className = 'modal journal-modal';

    const activeAreas = areas || this.areasState;
    const skinDef = CAT_SKINS.find((s) => s.id === cat.color);
    const skinName = skinDef?.label ?? cat.color;
    const markingDef = CAT_MARKINGS.find((m) => m.id === cat.pattern);
    const markingName = markingDef ? markingDef.label : 'None';

    const majorDesc = TRAITS[cat.majorTrait]?.description ?? '';
    const minorDesc = TRAITS[cat.minorTrait]?.description ?? '';

    const bestFriend = cat.journal.bestFriendId ? '💛 Has a Best Friend' : '🌱 Looking for Friends';

    const rareBadge = cat.isRare
      ? `<span class="badge rare-badge">✨ ${skinDef?.description || 'Rare Collector Cat'}</span>`
      : '';

    const areaOptions = AREA_KEYS.map((k) => {
      const meta = AREA_INFO_MAP[k];
      const isUnlocked = activeAreas[k]?.unlocked;
      const selected = cat.area === k ? 'selected' : '';
      const disabled = !isUnlocked ? 'disabled' : '';
      const lockLabel = !isUnlocked ? ' (Locked)' : '';
      return `<option value="${k}" ${selected} ${disabled}>${meta.emoji} ${meta.label}${lockLabel}</option>`;
    }).join('');

    const stageLabel =
      cat.stage === 'kitten'
        ? '🐾 Kitten'
        : cat.stage === 'teen'
          ? '🌱 Teen'
          : '👑 Adult';

    const nextStageText =
      cat.stage === 'kitten'
        ? 'Growing into Teen'
        : cat.stage === 'teen'
          ? 'Growing into Adult'
          : 'Fully Grown';

    const growthHtml =
      cat.stage === 'adult'
        ? `<div class="growth-box"><span class="stage-tag-badge adult-badge">👑 Fully Grown Adult</span></div>`
        : `
          <div class="growth-box">
            <div class="growth-label-row">
              <span class="stage-tag-badge">${stageLabel}</span>
              <span class="growth-next-text">${nextStageText} (${Math.round(cat.growthProgress)}%)</span>
            </div>
            <div class="progress-track"><div class="progress-fill fill-growth" style="width: ${cat.growthProgress}%"></div></div>
          </div>
        `;

    modal.innerHTML = `
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
        <label for="cat-area-select"><b>📍 Current Area:</b></label>
        <select id="cat-area-select" class="area-select-dropdown">
          ${areaOptions}
        </select>
      </div>

      <div class="traits-container">
        <div class="trait-chip">
          <b>🌟 ${cap(cat.majorTrait)}:</b> <span>${escapeHtml(majorDesc)}</span>
        </div>
        <div class="trait-chip">
          <b>✨ ${cap(cat.minorTrait)}:</b> <span>${escapeHtml(minorDesc)}</span>
        </div>
      </div>

      <!-- Quick-Care Action Bar -->
      <div class="quick-care-section">
        <div class="quick-care-header">
          <span>✨ Direct Care Actions</span>
        </div>
        <div class="quick-care-grid">
          <button class="quick-care-btn quick-food" data-tool="food" title="Feed ${escapeHtml(cat.name)}">
            <span class="qc-icon">🐟</span><span>Feed</span>
          </button>
          <button class="quick-care-btn quick-pet" data-tool="pet" title="Pet ${escapeHtml(cat.name)}">
            <span class="qc-icon">💖</span><span>Pet</span>
          </button>
          <button class="quick-care-btn quick-brush" data-tool="brush" title="Brush ${escapeHtml(cat.name)}">
            <span class="qc-icon">🪮</span><span>Brush</span>
          </button>
          <button class="quick-care-btn quick-toy" data-tool="toy" title="Play with ${escapeHtml(cat.name)}">
            <span class="qc-icon">🧶</span><span>Toy</span>
          </button>
          <button class="quick-care-btn quick-wash" data-tool="wash" title="Wash ${escapeHtml(cat.name)}">
            <span class="qc-icon">🫧</span><span>Wash</span>
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
          <span class="need-label"><span class="svg-inline">${SVG_ICONS.wash}</span> Clean</span>
          <div class="progress-track"><div class="progress-fill fill-clean" style="width: ${cat.cleanliness}%"></div></div>
          <span class="need-pct-clean">${Math.round(cat.cleanliness)}%</span>
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
          <span class="need-label">⚡ Energy</span>
          <div class="progress-track"><div class="progress-fill fill-energy" style="width: ${cat.energy}%"></div></div>
          <span>${Math.round(cat.energy)}%</span>
        </div>
      </div>

      <div class="journal-stats">
        <div class="journal-stat">Favorite Food<br/><b>🐟 ${escapeHtml(cat.favoriteFood)}</b></div>
        <div class="journal-stat">Favorite Toy<br/><b>🧶 ${escapeHtml(cat.favoriteToy)}</b></div>
        <div class="journal-stat">Markings<br/><b>🐾 ${escapeHtml(markingName)}</b></div>
        <div class="journal-stat">Pets Received<br/><b>✋ ${cat.journal.totalPetsReceived}</b></div>
      </div>

      <div class="subtitle-status">${bestFriend} · Happiness ${Math.round(cat.happiness)}%</div>

      <div class="journal-history-label">Sanctuary Diary</div>
      <ul class="journal-entries">
        ${[...cat.journal.entries].reverse().slice(0, 10).map((e) => `<li><b>Day ${e.day}:</b> ${escapeHtml(e.message)}</li>`).join('')}
      </ul>

      <button class="modal-action-btn export-card-btn" id="export-card-btn">
        📸 Save Adoption Card (.PNG)
      </button>

      <button class="modal-close" id="journal-close-btn">Close</button>
    `;

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

        // Real-time animated progress bar update
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

    modal.querySelector('#export-card-btn')!.addEventListener('click', () => {
      sound.playTap();
      EventBus.emit('export-cat-card', { catId: cat.id });
    });

    modal.querySelector('#journal-close-btn')!.addEventListener('click', () => {
      sound.playTap();
      backdrop.remove();
    });
    backdrop.appendChild(modal);
    this.root.appendChild(backdrop);

    this.drawCatAvatar(modal.querySelector('#journal-cat-canvas') as HTMLCanvasElement, cat);
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

  private openShopModal(defaultTab: 'areas' | 'furniture' | 'milestones' | 'rare' | 'sort' = 'areas'): void {
    const backdrop = this.createBackdrop();
    const modal = document.createElement('div');
    modal.className = 'modal shop-modal';

    const renderTabs = (activeTab: 'areas' | 'furniture' | 'milestones' | 'rare' | 'sort') => {
      modal.innerHTML = `
        <div class="shop-header">
          <h2>🛍️ Sanctuary Emporium</h2>
          <div class="shop-balances">
            <span class="shop-love-balance"><b>${this.currentLove.toLocaleString()} 💗</b></span>
            <span class="shop-tokens-balance"><b>${this.currentTokens} ⭐</b></span>
          </div>
        </div>

        <div class="shop-tabs">
          <button class="shop-tab-btn ${activeTab === 'areas' ? 'active' : ''}" id="tab-areas-btn">🏡 Areas</button>
          <button class="shop-tab-btn ${activeTab === 'furniture' ? 'active' : ''}" id="tab-furniture-btn">🪵 Decor</button>
          <button class="shop-tab-btn ${activeTab === 'milestones' ? 'active' : ''}" id="tab-milestones-btn">⭐ Goals</button>
          <button class="shop-tab-btn ${activeTab === 'rare' ? 'active' : ''}" id="tab-rare-btn">🌟 Rares</button>
          <button class="shop-tab-btn ${activeTab === 'sort' ? 'active' : ''}" id="tab-sort-btn">🐾 Sort</button>
        </div>

        <div class="shop-content">
          ${
            activeTab === 'areas'
              ? this.renderShopAreasContent()
              : activeTab === 'furniture'
                ? this.renderShopFurnitureContent()
                : activeTab === 'milestones'
                  ? this.renderShopMilestonesContent()
                  : activeTab === 'rare'
                    ? this.renderShopRareSummonsContent()
                    : this.renderShopSortContent()
          }
        </div>

        <button class="modal-close" id="shop-close-btn">Done</button>
      `;

      modal.querySelector('#tab-areas-btn')?.addEventListener('click', () => {
        sound.playTap();
        renderTabs('areas');
      });
      modal.querySelector('#tab-furniture-btn')?.addEventListener('click', () => {
        sound.playTap();
        renderTabs('furniture');
      });
      modal.querySelector('#tab-milestones-btn')?.addEventListener('click', () => {
        sound.playTap();
        renderTabs('milestones');
      });
      modal.querySelector('#tab-rare-btn')?.addEventListener('click', () => {
        sound.playTap();
        renderTabs('rare');
      });
      modal.querySelector('#tab-sort-btn')?.addEventListener('click', () => {
        sound.playTap();
        renderTabs('sort');
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
          setTimeout(() => renderTabs('areas'), 200);
        });
      });

      // Bind Capacity Upgrade buttons
      modal.querySelectorAll('.upgrade-cap-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const areaKey = (btn as HTMLElement).dataset.area as CatArea;
          EventBus.emit('upgrade-capacity', { area: areaKey });
          setTimeout(() => renderTabs('areas'), 200);
        });
      });

      // Bind Furniture Purchase buttons
      modal.querySelectorAll('.buy-furniture-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const furnitureId = (btn as HTMLElement).dataset.furnitureId;
          if (furnitureId) {
            EventBus.emit('buy-furniture', { furnitureId });
            setTimeout(() => renderTabs('furniture'), 200);
          }
        });
      });

      // Bind Milestone Claim buttons
      modal.querySelectorAll('.claim-milestone-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const milestoneId = (btn as HTMLElement).dataset.milestoneId;
          if (milestoneId) {
            EventBus.emit('claim-milestone', { milestoneId });
            setTimeout(() => renderTabs('milestones'), 200);
          }
        });
      });

      // Bind Rare Summon buttons
      modal.querySelectorAll('.summon-rare-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const rareType = (btn as HTMLElement).dataset.rareType as RareCatType;
          if (rareType) {
            EventBus.emit('summon-rare-cat', { rareType });
            setTimeout(() => renderTabs('rare'), 200);
          }
        });
      });

      // Bind Cat Move Dropdowns
      modal.querySelectorAll('.roster-move-select').forEach((sel) => {
        sel.addEventListener('change', (e) => {
          const target = e.target as HTMLSelectElement;
          const catId = target.dataset.catId;
          const toArea = target.value as CatArea;
          if (catId && toArea) {
            EventBus.emit('move-cat', { catId, toArea });
            setTimeout(() => renderTabs('sort'), 200);
          }
        });
      });
    };

    renderTabs(defaultTab);
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
              <h3>${meta.emoji} ${meta.label} <span class="lock-badge">Locked</span></h3>
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
            <h3>${meta.emoji} ${meta.label} <span class="unlocked-badge">Active</span></h3>
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

  private renderShopFurnitureContent(): string {
    return FURNITURE_CATALOG.map((item) => {
      const isOwned = this.ownedFurniture.includes(item.id);
      const canAfford = this.currentLove >= item.loveCost;
      const areaMeta = AREA_INFO_MAP[item.area];

      if (isOwned) {
        return `
          <div class="shop-card unlocked-card">
            <div class="shop-card-info">
              <h3>${item.emoji} ${item.name} <span class="unlocked-badge">Placed</span></h3>
              <p>${item.description}</p>
              <div class="shop-card-meta">Location: <b>${areaMeta.label}</b> · <span class="bonus-tag">${item.bonusText}</span></div>
            </div>
          </div>
        `;
      }

      return `
        <div class="shop-card">
          <div class="shop-card-info">
            <h3>${item.emoji} ${item.name}</h3>
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
      <div class="milestones-intro">Complete sanctuary milestones to earn ⭐ Adoption Tokens for legendary cats!</div>
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

  private renderShopRareSummonsContent(): string {
    return `
      <div class="rares-intro">Summon guaranteed Legendary &amp; Rare Cats using ⭐ Adoption Tokens:</div>
      <div class="rares-list">
        ${RARE_SUMMONS.map((summon) => {
          const canAfford = this.currentTokens >= summon.tokenCost;
          const skin = CAT_SKINS.find((s) => s.id === summon.skinId);

          return `
            <div class="shop-card rare-summon-card">
              <div class="shop-card-info">
                <h3>✨ ${summon.name} · ${summon.title}</h3>
                <p>${summon.description}</p>
                <div class="shop-card-meta">Fur Style: <b>${skin?.label || summon.skinId}</b></div>
              </div>
              <button class="shop-action-btn summon-rare-btn" data-rare-type="${summon.id}" ${!canAfford ? 'disabled' : ''}>
                Summon Cat (${summon.tokenCost} ⭐)
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  private renderShopSortContent(): string {
    if (this.catsList.length === 0) {
      return `<div class="empty-roster">No cats in sanctuary yet! Adopt some cute cats first.</div>`;
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
            return `<option value="${k}" ${isSelected} ${isDisabled}>${meta.emoji} ${meta.label}${!isUnlocked ? ' 🔒' : ''}</option>`;
          }).join('');

          const stageBadge =
            cat.stage === 'kitten'
              ? '<span class="stage-tag-badge">🐾 Kitten</span>'
              : cat.stage === 'teen'
                ? '<span class="stage-tag-badge">🌱 Teen</span>'
                : '<span class="stage-tag-badge adult-badge">👑 Adult</span>';

          return `
            <div class="roster-cat-row">
              <div class="roster-cat-info">
                <div class="roster-title-row">
                  <span class="roster-name"><b>${escapeHtml(cat.name)}</b> ${cat.isRare ? '✨' : ''}</span>
                  ${stageBadge}
                </div>
                <span class="roster-sub">${skin?.label || cat.color} · in ${currentMeta.emoji} ${currentMeta.label}</span>
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

  private showOfflineSummary(summary: { minutesAway: number; loveEarned: number; headlines: string[] }): void {
    const backdrop = this.createBackdrop();
    const modal = document.createElement('div');
    modal.className = 'modal';
    const minutes = Math.round(summary.minutesAway);
    modal.innerHTML = `
      <h2>🐾 Welcome Back!</h2>
      <div class="subtitle">You were away for ${minutes} minute${minutes === 1 ? '' : 's'}.</div>
      <div class="journal-stat offline-love-stat">While you were away<br/><b>+${summary.loveEarned} 💗 Love</b></div>
      ${summary.headlines.length ? `<ul class="headline-list">${summary.headlines.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>` : ''}
      <button class="modal-close" id="offline-close-btn">Collect &amp; Play</button>
    `;
    modal.querySelector('#offline-close-btn')!.addEventListener('click', () => {
      sound.playPurr();
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
      <h2>⚙️ Sanctuary Options</h2>
      <div class="subtitle">Progress autosaves every 30 seconds to this browser.</div>
      <button class="modal-action-btn" id="export-btn">💾 Export savegame.json</button>
      <label class="modal-action-btn" style="display:block;text-align:center;margin-top:8px;cursor:pointer;">
        📂 Import savegame.json
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
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
