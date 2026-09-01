import type { Cat, CatArea, SanctuaryArea } from '../../data/types';
import { AREA_INFO_MAP } from '../../data/constants';
import { SVG_ICONS } from '../icons';
import { sound } from '../../systems/SoundManager';
import { EventBus } from '../EventBus';

const AREA_KEYS: CatArea[] = ['yard', 'shelter', 'sunroom', 'cafe'];

export interface HeaderHudCallbacks {
  onOpenMinigames: () => void;
  onOpenPlinko: () => void;
  onOpenShop: (tab?: 'areas' | 'machines' | 'furniture' | 'milestones' | 'upgrades') => void;
  onOpenSaveMenu: () => void;
}

export class HeaderHud {
  private headerEl: HTMLElement;
  private loveEl!: HTMLElement;
  private tokensEl!: HTMLElement;
  private areaNavEl!: HTMLElement;

  private currentLove = 0;
  private currentTokens = 0;
  private currentArea: CatArea = 'yard';
  private areasState: Record<CatArea, SanctuaryArea> = {
    yard: { id: 'yard', unlocked: true, unlockThreshold: 0, capacity: 5 },
    shelter: { id: 'shelter', unlocked: false, unlockThreshold: 3, capacity: 15 },
    sunroom: { id: 'sunroom', unlocked: false, unlockThreshold: 8, capacity: 25 },
    cafe: { id: 'cafe', unlocked: false, unlockThreshold: 15, capacity: 40 },
  };
  private catsList: Cat[] = [];

  constructor(
    private root: HTMLElement,
    private callbacks: HeaderHudCallbacks,
  ) {
    this.headerEl = document.createElement('header');
    this.headerEl.className = 'top-header';
    this.root.appendChild(this.headerEl);

    this.buildHud();
    this.buildAreaNav();
  }

  private buildHud(): void {
    const hud = document.createElement('div');
    hud.className = 'hud';
    hud.innerHTML = `
      <div class="hud-stats-group">
        <div class="hud-love" title="Care Points">
          <span class="hud-icon heart-icon">${SVG_ICONS.heart}</span>
          <span id="love-value">0</span>
        </div>
        <div class="hud-tokens" id="tokens-pill" title="Stars (for Plinko & Mini Games!)">
          <span class="hud-icon star-icon">${SVG_ICONS.star}</span>
          <span id="tokens-value">0</span>
        </div>
      </div>

      <div class="hud-actions">
        <button class="icon-btn minigames-btn" id="minigames-btn" title="🎮 Cat Mini Games Hub">
          ${SVG_ICONS.minigames}
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
    this.headerEl.appendChild(hud);
    this.loveEl = hud.querySelector('#love-value')!;
    this.tokensEl = hud.querySelector('#tokens-value')!;

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
    };

    // Show 1-tap mobile fullscreen prompt modal if on mobile touch device
    this.showMobileFullscreenPrompt(toggleFullscreen);

    hud.querySelector('#minigames-btn')!.addEventListener('click', () => {
      sound.playTap();
      this.callbacks.onOpenMinigames();
    });

    hud.querySelector('#plinko-btn')!.addEventListener('click', () => {
      sound.playTap();
      this.callbacks.onOpenPlinko();
    });

    hud.querySelector('#shop-btn')!.addEventListener('click', () => {
      sound.playTap();
      this.callbacks.onOpenShop();
    });

    hud.querySelector('#save-menu-btn')!.addEventListener('click', () => {
      this.callbacks.onOpenSaveMenu();
    });
  }


  private showMobileFullscreenPrompt(onEnterFullscreen: () => void): void {
    const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window || (navigator as any).maxTouchPoints > 0;
    const isAlreadyFullscreen = Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
    if (!isMobile || isAlreadyFullscreen) return;

    if (sessionStorage.getItem('cat_sanctuary_fs_prompt_seen') === 'true') return;
    sessionStorage.setItem('cat_sanctuary_fs_prompt_seen', 'true');

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        sound.playTap();
        backdrop.remove();
      }
    });

    const modal = document.createElement('div');
    modal.className = 'modal welcome-fullscreen-modal';
    modal.innerHTML = `
      <h2>Welcome to Cozy Sanctuary</h2>
      <div class="subtitle" style="margin-bottom:10px;">For the best relaxing experience on mobile:</div>
      <div class="welcome-fs-card">
        <p>Would you like to play in <b>Fullscreen Mode</b> for wider views and seamless touch interactions?</p>
      </div>
      <button class="modal-close" id="fs-enter-btn" style="margin-top:16px;">Play in Fullscreen</button>
      <button class="modal-action-btn" id="fs-skip-btn" style="margin-top:8px;">Continue in Window</button>
    `;

    modal.querySelector('#fs-enter-btn')?.addEventListener('click', () => {
      sound.playTap();
      onEnterFullscreen();
      backdrop.remove();
    });

    modal.querySelector('#fs-skip-btn')?.addEventListener('click', () => {
      sound.playTap();
      backdrop.remove();
    });

    backdrop.appendChild(modal);
    this.root.appendChild(backdrop);
  }

  private buildAreaNav(): void {
    const nav = document.createElement('div');
    nav.className = 'area-nav';
    this.headerEl.appendChild(nav);
    this.areaNavEl = nav;
    this.renderAreaNav();
  }

  renderAreaNav(): void {
    this.areaNavEl.innerHTML = '';
    for (const key of AREA_KEYS) {
      const info = AREA_INFO_MAP[key];
      const areaState = this.areasState[key];
      const count = this.catsList.filter((c) => c.area === key).length;
      const areaSvg = SVG_ICONS[key] || SVG_ICONS.yard;

      const btn = document.createElement('button');
      btn.className = `area-nav-btn ${this.currentArea === key ? 'active' : ''} ${!areaState?.unlocked ? 'locked' : ''}`;

      if (areaState?.unlocked) {
        btn.innerHTML = `
          <div class="area-nav-top">
            <span class="area-svg-icon">${areaSvg}</span>
            <span class="area-count">${count}/${areaState.capacity}</span>
          </div>
          <span class="area-label">${info.label}</span>
        `;
        btn.addEventListener('click', () => {
          if (this.currentArea === key) return;
          EventBus.emit('switch-area', { area: key });
        });
      } else {
        btn.innerHTML = `
          <div class="area-nav-top">
            <span class="area-svg-icon">${areaSvg}</span>
            <span class="lock-badge">${SVG_ICONS.lock}</span>
          </div>
          <span class="area-label">${info.label}</span>
        `;
        btn.addEventListener('click', () => {
          sound.playTap();
          this.callbacks.onOpenShop('areas');
        });
      }

      this.areaNavEl.appendChild(btn);
    }
  }

  updateLove(love: number): void {
    this.currentLove = Math.floor(love);
    if (this.loveEl) {
      this.loveEl.textContent = this.currentLove.toLocaleString();
    }
  }

  updateTokens(tokens: number): void {
    this.currentTokens = tokens;
    if (this.tokensEl) {
      this.tokensEl.textContent = this.currentTokens.toString();
    }
  }

  updateAreas(areas: Record<CatArea, SanctuaryArea>, currentArea: CatArea, cats: Cat[]): void {
    this.areasState = areas;
    this.currentArea = currentArea;
    this.catsList = cats;
    this.renderAreaNav();
  }
}
