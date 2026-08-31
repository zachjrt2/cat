import type { Cat, CatArea, GameState } from '../data/types';
import {
  PlinkoSystem,
  getPlinkoBoardRank,
  getMultiballDiscount,
  getGoldenPegCount,
  type PlinkoTier,
  type PlinkoBoardRank,
} from '../systems/PlinkoSystem';
import { EventBus } from './EventBus';
import { sound } from '../systems/SoundManager';
import { SVG_ICONS } from './icons';
import { AREA_INFO_MAP, PLINKO_UPGRADES_CATALOG } from '../data/constants';
import { MUTATION_CATALOG } from '../data/mutations';
import { CAT_SKINS } from '../data/catAssets';

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

const CHEST_SVG = `<svg class="unboxing-svg-chest" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <polygon style="fill:#702600;" points="296.73,380.343 275.832,339.133 117.018,318.235 137.916,422.267 275.832,422.267 "></polygon>
  <polygon style="fill:#983300;" points="0,339.133 0,422.267 137.916,422.267 137.916,318.235 "></polygon>
  <polygon style="fill:#541D00;" points="296.73,295.345 275.832,256 117.018,235.102 137.916,339.133 275.832,339.133 "></polygon>
  <g>
    <polygon style="fill:#702600;" points="0,256 0,339.133 137.916,339.133 137.916,235.102 "></polygon>
    <polygon style="fill:#702600;" points="393.916,172.867 196.958,151.969 149.309,157.163 117.018,207.817 137.916,256 393.916,256 "></polygon>
  </g>
  <path style="fill:#541D00;" d="M393.916,89.733H256c-32.326,0-96.761,4.162-118.084,25.206c-13.668,13.49,5.26,57.928,5.26,57.928 h250.74V89.733z"></path>
  <path style="fill:#983300;" d="M149.309,157.163L5.26,172.867C1.842,183.911,0,195.649,0,207.817V256h137.916v-48.183 C137.916,189.687,142.007,172.514,149.309,157.163z"></path>
  <g>
    <path style="fill:#702600;" d="M256,89.733H118.084l0,0c-53.047,0-97.924,34.981-112.824,83.133h137.916 C158.076,124.714,202.952,89.733,256,89.733z"></path>
    <polygon style="fill:#702600;" points="512,256 370.553,243.483 393.916,422.267 512,422.267 "></polygon>
  </g>
  <g>
    <polygon style="fill:#983300;" points="275.832,235.102 275.832,422.267 393.916,422.267 393.916,245.551 "></polygon>
    <path style="fill:#983300;" d="M512,207.817c0-19.361-4.659-37.633-12.918-53.758c-1.739-3.395-3.636-6.694-5.684-9.888 c-1.536-2.396-3.157-4.732-4.856-7.005c-4.534-6.063-9.636-11.674-15.227-16.756c-2.633-2.393-5.378-4.664-8.22-6.814 c-0.38-0.287-0.763-0.573-1.146-0.856c-1.317-0.972-2.651-1.922-4.008-2.839c-1.08-0.729-2.178-1.436-3.283-2.131 c-2.532-1.591-5.129-3.089-7.787-4.488c-0.822-0.433-1.65-0.857-2.484-1.271c-15.807-7.853-33.62-12.278-52.469-12.278 l-20.898,91.035l20.898,75.233H512V207.817z"></path>
  </g>
  <polygon style="fill:#FFAD00;" points="185.885,216.655 137.916,216.655 117.018,256 137.916,295.345 185.885,295.345 "></polygon>
  <rect x="89.945" y="216.66" style="fill:#FFCE2A;" width="47.968" height="78.691"></rect>
  <rect x="122.243" y="241.633" style="fill:#FDEB95;" width="31.347" height="28.745"></rect>
  <path style="fill:#D5681E;" d="M393.916,127.957V89.733c-65.216,0-118.084,52.868-118.084,118.084V256h118.084v-96.696 c26.75,0,48.513,21.763,48.513,48.513h31.347C473.776,163.783,437.951,127.957,393.916,127.957z"></path>
</svg>`;

interface Peg {
  x: number;
  y: number;
  r: number;
  flash: number;
  isGolden?: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  size?: number;
}

interface SlotZone {
  index: number;
  xStart: number;
  xEnd: number;
  tier: PlinkoTier;
  label: string;
  color: string;
  bgHex: string;
  borderHex: string;
}

interface BallPhysics {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  active: boolean;
  isMegaBall?: boolean;
  trail: { x: number; y: number }[];
}

export class PlinkoModal {
  private static catImageCache = new Map<string, HTMLImageElement>();
  private root: HTMLElement;
  private state: GameState;
  private plinkoSystem: PlinkoSystem;
  private backdrop: HTMLElement | null = null;

  private wager = 1;
  private ballCount = 1;
  private isDropping = false;
  private showUpgradesDrawer = false;
  private animationFrameId: number | null = null;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private width = 360;
  private height = 400;

  private pegs: Peg[] = [];
  private slots: SlotZone[] = [];
  private particles: Particle[] = [];

  private balls: BallPhysics[] = [];
  private batchWonCats: Cat[] = [];
  private batchLandedSlots: PlinkoTier[] = [];
  private totalBallsInFlight = 0;

  private preferredArea: CatArea;

  constructor(root: HTMLElement, state: GameState, preferredArea: CatArea = 'yard') {
    this.root = root;
    this.state = state;
    this.preferredArea = preferredArea;
    this.plinkoSystem = new PlinkoSystem(state);
    if (!this.state.plinkoUpgrades) {
      this.state.plinkoUpgrades = {};
    }
  }

  open(): void {
    if (this.backdrop) this.close();

    sound.startPlinkoMusic();

    EventBus.on('tokens-changed', this.handleTokensChanged);

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop plinko-modal-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop && !this.isDropping) {
        sound.playTap();
        this.close();
      }
    });

    const modal = document.createElement('div');
    modal.className = 'modal plinko-modal';
    backdrop.appendChild(modal);
    this.root.appendChild(backdrop);
    this.backdrop = backdrop;

    this.renderModalContent(modal);
    this.initCanvas(modal);
    this.setupPegboard();
    this.startPhysicsLoop();
  }

  private handleTokensChanged = ({ tokens }: { tokens: number }) => {
    this.state.adoptionTokens = tokens;
    const balEl = this.backdrop?.querySelector('#plinko-star-balance');
    if (balEl) balEl.textContent = String(tokens);
    const dropBtn = this.backdrop?.querySelector('#plinko-drop-btn') as HTMLButtonElement;
    if (dropBtn && !this.isDropping) {
      dropBtn.disabled = tokens < this.getTotalCost();
    }
  };

  close(): void {
    sound.stopPlinkoMusic();

    EventBus.off('tokens-changed', this.handleTokensChanged);
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.backdrop) {
      this.backdrop.remove();
      this.backdrop = null;
    }
    this.balls = [];
    this.isDropping = false;
  }

  private getTotalCost(): number {
    const raw = this.wager * this.ballCount;
    const discount = getMultiballDiscount(this.ballCount, this.state.plinkoUpgrades);
    return Math.max(1, Math.ceil(raw * (1 - discount)));
  }

  private renderModalContent(modal: HTMLElement): void {
    const starBalance = this.state.adoptionTokens || 0;
    const odds = this.plinkoSystem.calculateOdds(this.wager);
    const rank = getPlinkoBoardRank(this.wager, this.state.plinkoUpgrades);
    const totalCost = this.getTotalCost();
    const discount = getMultiballDiscount(this.ballCount, this.state.plinkoUpgrades);
    const discountPercent = Math.round(discount * 100);

    const upgrades = this.state.plinkoUpgrades || {};
    const totalPurchasedUpgrades = Object.values(upgrades).reduce((acc, v) => acc + (v || 0), 0);

    modal.innerHTML = `
      <div class="plinko-header">
        <div class="plinko-title-row">
          <div class="plinko-title-left">
            <h2>Cat Plinko</h2>
            <button class="plinko-perks-toggle-btn ${this.showUpgradesDrawer ? 'active' : ''}" id="plinko-perks-toggle-btn" title="Shop">
              <span class="svg-inline">${SVG_ICONS.sparkle}</span>
              <span>Shop ${totalPurchasedUpgrades > 0 ? `(${totalPurchasedUpgrades})` : ''}</span>
            </button>
          </div>
          <div class="plinko-star-badge" title="Your Star Balance">
            <span class="svg-inline">${SVG_ICONS.star}</span>
            <span id="plinko-star-balance" class="plinko-star-val">${starBalance}</span>
          </div>
        </div>
        <p class="plinko-subtitle">Drop stars to discover cats! Wager higher or buy perks to unlock golden pegs, rare breeds, and mutations.</p>
      </div>

      <div class="plinko-upgrades-drawer ${this.showUpgradesDrawer ? 'open' : ''}" id="plinko-upgrades-drawer">
        ${this.renderUpgradesDrawer()}
      </div>

      <div class="plinko-game-container">
        <div class="plinko-board-rank-container" id="plinko-board-rank-container">
          ${this.renderBoardRankCard(rank)}
        </div>

        <div class="plinko-canvas-wrapper">
          <div class="plinko-marquee-border">
            <canvas id="plinko-canvas" width="${this.width}" height="${this.height}"></canvas>
          </div>
        </div>

        <div class="plinko-controls-panel">
          <div class="plinko-wager-section">
            <div class="plinko-wager-label-row">
              <label for="plinko-wager-input"><b>Bet Per Ball:</b></label>
              <span class="plinko-win-rate-badge" id="plinko-win-rate">Win Chance: <b>${odds.winChancePercent}%</b></span>
            </div>

            <div class="plinko-wager-input-row">
              <button class="plinko-step-btn" id="plinko-minus-btn" title="Decrease bet">−</button>
              <input type="number" id="plinko-wager-input" min="1" max="${Math.max(1, starBalance)}" value="${this.wager}" />
              <button class="plinko-step-btn" id="plinko-plus-btn" title="Increase bet">+</button>
            </div>

            <div class="plinko-quick-bets">
              <button class="plinko-chip-btn ${this.wager === 1 ? 'active' : ''}" data-bet="1">1 Star</button>
              <button class="plinko-chip-btn ${this.wager === 5 ? 'active' : ''}" data-bet="5">5 Stars</button>
              <button class="plinko-chip-btn ${this.wager === 10 ? 'active' : ''}" data-bet="10">10 Stars</button>
              <button class="plinko-chip-btn ${this.wager === 25 ? 'active' : ''}" data-bet="25">25 Stars</button>
              <button class="plinko-chip-btn ${this.wager === 50 ? 'active' : ''}" data-bet="50">50 Stars</button>
              <button class="plinko-chip-btn ${this.wager === 100 ? 'active' : ''}" data-bet="100">100 Stars</button>
              <button class="plinko-chip-btn ${this.wager === 250 ? 'active' : ''}" data-bet="250">250 Stars</button>
              <button class="plinko-chip-btn" id="plinko-max-btn">Max</button>
            </div>
          </div>

          <div class="plinko-multiball-section">
            <div class="plinko-wager-label-row">
              <label><b>Balls to Drop:</b></label>
              <span class="plinko-multiball-summary">Total: <b>${totalCost} Stars</b> ${discountPercent > 0 ? `<span class="discount-tag">-${discountPercent}% OFF</span>` : ''}</span>
            </div>
            <div class="plinko-multiball-selector">
              <button class="plinko-multiball-btn ${this.ballCount === 1 ? 'active' : ''}" data-balls="1">1 Ball</button>
              <button class="plinko-multiball-btn ${this.ballCount === 3 ? 'active' : ''}" data-balls="3">3 Balls</button>
              <button class="plinko-multiball-btn ${this.ballCount === 5 ? 'active' : ''}" data-balls="5">5 Balls</button>
              <button class="plinko-multiball-btn ${this.ballCount === 10 ? 'active' : ''}" data-balls="10">10 Balls</button>
            </div>
          </div>

          <div class="plinko-odds-breakdown" id="plinko-odds-breakdown">
            ${this.renderOddsBreakdown(odds)}
          </div>

          <button class="plinko-drop-btn" id="plinko-drop-btn" ${starBalance < totalCost ? 'disabled' : ''}>
            <span class="svg-inline">${SVG_ICONS.sparkle}</span>
            <span>Drop ${this.ballCount > 1 ? `${this.ballCount} Balls` : 'Ball'} (${totalCost} Stars)</span>
          </button>
        </div>
      </div>

      <button class="modal-close" id="plinko-close-btn">Done</button>
    `;

    this.bindControls(modal);
  }

  private renderUpgradesDrawer(): string {
    const starBalance = this.state.adoptionTokens || 0;
    const upgrades = this.state.plinkoUpgrades || {};

    const cardsHtml = PLINKO_UPGRADES_CATALOG.map((up) => {
      const curLevel = upgrades[up.id] || 0;
      const isMax = curLevel >= up.maxLevel;
      const nextCost = !isMax ? up.costs[curLevel] : null;
      const canAfford = nextCost ? starBalance >= nextCost.stars : false;

      let btnHtml = '';
      if (isMax) {
        btnHtml = `<span class="claimed-badge">Max</span>`;
      } else if (nextCost) {
        btnHtml = `
          <button class="plinko-upgrade-buy-btn" data-upgrade-id="${up.id}" ${!canAfford ? 'disabled' : ''}>
            ${curLevel === 0 ? 'Buy' : 'Tier ' + (curLevel + 1)} · ${nextCost.stars} Stars
          </button>
        `;
      }

      const activeText = curLevel > 0 ? up.effectLabel[curLevel - 1] : up.description;

      return `
        <div class="plinko-upgrade-card ${curLevel > 0 ? 'active-upgrade' : ''}">
          <div class="upgrade-info-left">
            <div class="upgrade-title-row">
              <span class="upgrade-name">${up.name}</span>
              <span class="upgrade-tier-pill">T${curLevel}/${up.maxLevel}</span>
            </div>
            <div class="upgrade-desc">${activeText}</div>
          </div>
          <div class="upgrade-action-right">
            ${btnHtml}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="upgrades-drawer-inner">
        <div class="drawer-header">
          <h3>Shop</h3>
        </div>
        <div class="upgrades-grid">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  private renderBoardRankCard(rank: PlinkoBoardRank): string {
    return `
      <div class="plinko-board-rank-card" style="border-left: 4px solid ${rank.color}; background: ${rank.bgGrad};">
        <div class="rank-badge" style="background: ${rank.color}; color: #fff;">${rank.badge}</div>
        <div class="rank-info">
          <div class="rank-name" style="color: ${rank.color};">${rank.name}</div>
          <div class="rank-perks">${rank.perks}</div>
        </div>
      </div>
    `;
  }

  private renderOddsBreakdown(odds: ReturnType<PlinkoSystem['calculateOdds']>): string {
    const pills: string[] = [];
    pills.push(`
      <div class="odds-pill mutation-pill" title="Chance of rare mutation">
        <span class="odds-dot" style="background:#d946ef;"></span>
        <span>Mutation: <b>${odds.mutationChancePercent}%</b></span>
      </div>
    `);
    if (odds.missChancePercent > 0) {
      pills.push(`
        <div class="odds-pill miss-pill" title="Miss rate">
          <span class="odds-dot" style="background:#8d7865;"></span>
          <span>Miss: <b>${odds.missChancePercent}%</b></span>
        </div>
      `);
    }
    if (odds.commonPercent > 0) {
      pills.push(`
        <div class="odds-pill common-pill" title="Common tier">
          <span class="odds-dot" style="background:#2d6a4f;"></span>
          <span>Common: <b>${odds.commonPercent}%</b></span>
        </div>
      `);
    }
    if (odds.uncommonPercent > 0) {
      pills.push(`
        <div class="odds-pill uncommon-pill" title="Uncommon tier">
          <span class="odds-dot" style="background:#0284c7;"></span>
          <span>Uncommon: <b>${odds.uncommonPercent}%</b></span>
        </div>
      `);
    }
    if (odds.rarePercent > 0) {
      pills.push(`
        <div class="odds-pill rare-pill" title="Rare tier">
          <span class="odds-dot" style="background:#7e22ce;"></span>
          <span>Rare: <b>${odds.rarePercent}%</b></span>
        </div>
      `);
    }
    if (odds.epicPercent > 0) {
      pills.push(`
        <div class="odds-pill epic-pill" title="Epic tier">
          <span class="odds-dot" style="background:#be185d;"></span>
          <span>Epic: <b>${odds.epicPercent}%</b></span>
        </div>
      `);
    }
    if (odds.legendaryPercent > 0) {
      pills.push(`
        <div class="odds-pill legendary-pill" title="Legendary tier">
          <span class="odds-dot" style="background:#b45309;"></span>
          <span>Legend: <b>${odds.legendaryPercent}%</b></span>
        </div>
      `);
    }
    return pills.join('');
  }

  private bindControls(modal: HTMLElement): void {
    const wagerInput = modal.querySelector('#plinko-wager-input') as HTMLInputElement;
    const dropBtn = modal.querySelector('#plinko-drop-btn') as HTMLButtonElement;
    const minusBtn = modal.querySelector('#plinko-minus-btn') as HTMLButtonElement;
    const plusBtn = modal.querySelector('#plinko-plus-btn') as HTMLButtonElement;
    const maxBtn = modal.querySelector('#plinko-max-btn') as HTMLButtonElement;
    const closeBtn = modal.querySelector('#plinko-close-btn') as HTMLButtonElement;
    const perksToggleBtn = modal.querySelector('#plinko-perks-toggle-btn') as HTMLButtonElement;

    perksToggleBtn?.addEventListener('click', () => {
      sound.playTap();
      this.showUpgradesDrawer = !this.showUpgradesDrawer;
      const drawer = modal.querySelector('#plinko-upgrades-drawer');
      if (drawer) {
        if (this.showUpgradesDrawer) {
          drawer.classList.add('open');
          perksToggleBtn.classList.add('active');
        } else {
          drawer.classList.remove('open');
          perksToggleBtn.classList.remove('active');
        }
      }
    });

    const bindUpgradeButtons = () => {
      modal.querySelectorAll('.plinko-upgrade-buy-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const upId = (btn as HTMLElement).dataset.upgradeId;
          if (!upId) return;
          const upDef = PLINKO_UPGRADES_CATALOG.find((u) => u.id === upId);
          if (!upDef) return;

          const upgrades = this.state.plinkoUpgrades || {};
          const curLevel = upgrades[upId] || 0;
          if (curLevel >= upDef.maxLevel) return;

          const cost = upDef.costs[curLevel];
          if ((this.state.adoptionTokens || 0) < cost.stars) {
            EventBus.emit('toast', { message: `Not enough Stars! Need ${cost.stars} Stars.` });
            return;
          }

          this.state.adoptionTokens = (this.state.adoptionTokens || 0) - cost.stars;
          upgrades[upId] = curLevel + 1;
          this.state.plinkoUpgrades = upgrades;

          EventBus.emit('upgrade-plinko', { upgradeId: upId, level: curLevel + 1, cost: cost.stars });
          EventBus.emit('spend-tokens', { amount: cost.stars });
          EventBus.emit('tokens-changed', { tokens: this.state.adoptionTokens });
          sound.playAdoptFanfare();

          EventBus.emit('toast', { message: `Upgraded ${upDef.name} to Tier ${curLevel + 1}!` });

          this.setupPegboard();
          const drawer = modal.querySelector('#plinko-upgrades-drawer');
          if (drawer) drawer.innerHTML = this.renderUpgradesDrawer();
          bindUpgradeButtons();
          refreshUI();
        });
      });
    };
    bindUpgradeButtons();

    const refreshUI = () => {
      const totalCost = this.getTotalCost();
      if (wagerInput) wagerInput.value = String(this.wager);
      this.updateSlotsForWager(this.wager);

      const odds = this.plinkoSystem.calculateOdds(this.wager);
      const rank = getPlinkoBoardRank(this.wager, this.state.plinkoUpgrades);
      const discount = getMultiballDiscount(this.ballCount, this.state.plinkoUpgrades);
      const discountPercent = Math.round(discount * 100);

      const rankContainer = modal.querySelector('#plinko-board-rank-container');
      if (rankContainer) rankContainer.innerHTML = this.renderBoardRankCard(rank);

      const winRateEl = modal.querySelector('#plinko-win-rate');
      if (winRateEl) winRateEl.innerHTML = `Win Chance: <b>${odds.winChancePercent}%</b>`;

      const summaryEl = modal.querySelector('.plinko-multiball-summary');
      if (summaryEl) {
        summaryEl.innerHTML = `Total: <b>${totalCost} Stars</b> ${discountPercent > 0 ? `<span class="discount-tag">-${discountPercent}% OFF</span>` : ''}`;
      }

      const breakdownEl = modal.querySelector('#plinko-odds-breakdown');
      if (breakdownEl) breakdownEl.innerHTML = this.renderOddsBreakdown(odds);

      const hasSpace = this.plinkoSystem.hasRemainingSanctuarySpace();
      const canAfford = (this.state.adoptionTokens || 0) >= totalCost;

      if (dropBtn) {
        if (!hasSpace) {
          dropBtn.innerHTML = `<span class="svg-inline">${SVG_ICONS.sparkle}</span><span>Sanctuary Full</span>`;
          dropBtn.disabled = true;
        } else {
          dropBtn.innerHTML = `<span class="svg-inline">${SVG_ICONS.sparkle}</span><span>Drop ${this.ballCount > 1 ? `${this.ballCount} Balls` : 'Ball'} (${totalCost} Stars)</span>`;
          dropBtn.disabled = this.isDropping || !canAfford;
        }
      }

      modal.querySelectorAll('.plinko-chip-btn').forEach((btn) => {
        const bet = (btn as HTMLElement).dataset.bet;
        if (bet) {
          if (parseInt(bet, 10) === this.wager) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });

      modal.querySelectorAll('.plinko-multiball-btn').forEach((btn) => {
        const balls = (btn as HTMLElement).dataset.balls;
        if (balls) {
          if (parseInt(balls, 10) === this.ballCount) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });
    };

    const updateWager = (val: number) => {
      const maxStars = Math.max(1, this.state.adoptionTokens || 0);
      this.wager = Math.max(1, Math.min(val, maxStars));
      refreshUI();
    };

    wagerInput?.addEventListener('input', () => {
      const val = parseInt(wagerInput.value, 10) || 1;
      updateWager(val);
    });

    minusBtn?.addEventListener('click', () => {
      sound.playTap();
      updateWager(this.wager - 1);
    });

    plusBtn?.addEventListener('click', () => {
      sound.playTap();
      updateWager(this.wager + 1);
    });

    modal.querySelectorAll('.plinko-chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const b = (btn as HTMLElement).dataset.bet;
        if (b) {
          sound.playTap();
          updateWager(parseInt(b, 10));
        }
      });
    });

    modal.querySelectorAll('.plinko-multiball-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const count = parseInt((btn as HTMLElement).dataset.balls || '1', 10);
        sound.playTap();
        this.ballCount = count;
        refreshUI();
      });
    });

    maxBtn?.addEventListener('click', () => {
      sound.playTap();
      const maxStars = this.state.adoptionTokens || 0;
      updateWager(Math.max(1, Math.floor(maxStars / Math.max(1, this.ballCount))));
    });

    dropBtn?.addEventListener('click', () => {
      if (this.isDropping) return;
      this.triggerDrop();
    });

    closeBtn?.addEventListener('click', () => {
      if (this.isDropping) return;
      sound.playTap();
      this.close();
    });
  }

  private initCanvas(modal: HTMLElement): void {
    this.canvas = modal.querySelector('#plinko-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
  }

  private setupPegboard(): void {
    this.pegs = [];
    const rows = 8;
    const startY = 55;
    const rowHeight = 36;
    const goldenCount = getGoldenPegCount(this.state.plinkoUpgrades);

    const goldenPegIndices = new Set<string>();
    if (goldenCount >= 2) {
      goldenPegIndices.add('3:2');
      goldenPegIndices.add('3:3');
    }
    if (goldenCount >= 4) {
      goldenPegIndices.add('4:2');
      goldenPegIndices.add('4:4');
    }
    if (goldenCount >= 6) {
      goldenPegIndices.add('5:3');
      goldenPegIndices.add('5:4');
    }

    for (let r = 0; r < rows; r++) {
      const pegsInRow = r + 3;
      const spacing = this.width / (pegsInRow + 1);
      for (let i = 0; i < pegsInRow; i++) {
        const x = spacing * (i + 1);
        const y = startY + r * rowHeight;
        const key = `${r}:${i}`;
        const isGolden = goldenPegIndices.has(key);
        this.pegs.push({ x, y, r: isGolden ? 5.2 : 4.5, flash: 0, isGolden });
      }
    }

    this.updateSlotsForWager(this.wager);
  }

  private updateSlotsForWager(wager: number): void {
    const slotCount = 9;
    const slotWidth = this.width / slotCount;
    this.slots = [];

    const tierMeta: Record<PlinkoTier, { label: string; color: string; bgHex: string; borderHex: string }> = {
      miss: { label: 'Miss', color: '#8d7865', bgHex: '#f1ede6', borderHex: '#d5cbbe' },
      common: { label: 'Common', color: '#2d6a4f', bgHex: '#e8f5e9', borderHex: '#a7d7b0' },
      uncommon: { label: 'Uncommon', color: '#0284c7', bgHex: '#e0f2fe', borderHex: '#7dd3fc' },
      rare: { label: 'Rare', color: '#7e22ce', bgHex: '#f3e8ff', borderHex: '#d8b4fe' },
      epic: { label: 'Epic', color: '#be185d', bgHex: '#fce7f3', borderHex: '#f9a8d4' },
      legendary: { label: 'Legend', color: '#b45309', bgHex: '#fef3c7', borderHex: '#fcd34d' },
    };

    const rank = getPlinkoBoardRank(wager, this.state.plinkoUpgrades);
    const tiers = rank.slots;

    for (let s = 0; s < slotCount; s++) {
      const t = tiers[s];
      const meta = tierMeta[t];
      this.slots.push({
        index: s,
        xStart: s * slotWidth,
        xEnd: (s + 1) * slotWidth,
        tier: t,
        label: meta.label,
        color: meta.color,
        bgHex: meta.bgHex,
        borderHex: meta.borderHex,
      });
    }
  }

  private triggerDrop(): void {
    if (this.isDropping) return;

    if (!this.plinkoSystem.hasRemainingSanctuarySpace()) {
      EventBus.emit('toast', { message: 'Sanctuary is full! Expand or unlock an area first to play Plinko.' });
      sound.playTap();
      return;
    }

    const totalCost = this.getTotalCost();
    if ((this.state.adoptionTokens || 0) < totalCost) {
      EventBus.emit('toast', { message: `Not enough Stars! Need ${totalCost} Stars.` });
      return;
    }

    this.state.adoptionTokens = Math.max(0, (this.state.adoptionTokens || 0) - totalCost);
    EventBus.emit('spend-tokens', { amount: totalCost });
    EventBus.emit('tokens-changed', { tokens: this.state.adoptionTokens });
    sound.playCoin();

    const dropBtn = this.backdrop?.querySelector('#plinko-drop-btn') as HTMLButtonElement;
    if (dropBtn) dropBtn.disabled = true;

    this.isDropping = true;
    this.batchWonCats = [];
    this.batchLandedSlots = [];
    this.totalBallsInFlight = this.ballCount;

    const ballColors = ['#f59e0b', '#ec4899', '#38bdf8', '#a855f7', '#10b981', '#f97316', '#eab308'];
    for (let i = 0; i < this.ballCount; i++) {
      setTimeout(() => {
        if (!this.isDropping) return;
        sound.playBalldrop();
        const startX = this.width / 2 + (Math.random() - 0.5) * 44;
        this.balls.push({
          id: Date.now() + i,
          x: startX,
          y: 18,
          vx: (Math.random() - 0.5) * 2.2,
          vy: 1.0 + Math.random() * 0.4,
          r: 6.5,
          color: ballColors[i % ballColors.length],
          active: true,
          trail: [],
        });
      }, i * 110);
    }
  }

  private startPhysicsLoop(): void {
    const loop = () => {
      this.updatePhysics();
      this.renderCanvas();
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  private updatePhysics(): void {
    for (const peg of this.pegs) {
      if (peg.flash > 0) peg.flash = Math.max(0, peg.flash - 0.05);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12;
      p.life++;
      p.alpha = Math.max(0, 1 - p.life / p.maxLife);
      if (p.life >= p.maxLife) this.particles.splice(i, 1);
    }

    if (this.balls.length === 0) return;

    const gravity = 0.20;
    const friction = 0.988;
    const restitution = 0.70;

    for (let idx = this.balls.length - 1; idx >= 0; idx--) {
      const b = this.balls[idx];
      if (!b.active) continue;

      b.vy += gravity;
      b.vx *= friction;
      b.x += b.vx;
      b.y += b.vy;

      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 8) b.trail.shift();

      if (b.x - b.r < 8) {
        b.x = 8 + b.r;
        b.vx = Math.abs(b.vx) * restitution + 0.5;
      } else if (b.x + b.r > this.width - 8) {
        b.x = this.width - 8 - b.r;
        b.vx = -Math.abs(b.vx) * restitution - 0.5;
      }

      for (const peg of this.pegs) {
        const dx = b.x - peg.x;
        const dy = b.y - peg.y;
        const dist = Math.hypot(dx, dy);
        const minDist = b.r + peg.r;

        if (dist < minDist && dist > 0) {
          const nx = dx / dist;
          const ny = dy / dist;

          b.x = peg.x + nx * minDist;
          b.y = peg.y + ny * minDist;

          const dot = b.vx * nx + b.vy * ny;
          b.vx = (b.vx - 2 * dot * nx) * restitution + (Math.random() - 0.5) * 0.9;
          b.vy = (b.vy - 2 * dot * ny) * restitution + (Math.random() - 0.5) * 0.5;

          if (peg.isGolden) {
            const centerDiff = (this.width / 2) - b.x;
            b.vx += Math.sign(centerDiff) * 0.8;
            this.state.adoptionTokens = (this.state.adoptionTokens || 0) + 1;
            EventBus.emit('tokens-changed', { tokens: this.state.adoptionTokens });
          }

          peg.flash = 1.0;
          sound.playBounce(0.85 + Math.random() * 0.35);

          const pColor = peg.isGolden
            ? '#fbbf24'
            : ['#f59e0b', '#fbbf24', '#ec4899', '#38bdf8'][Math.floor(Math.random() * 4)];
          for (let k = 0; k < (peg.isGolden ? 6 : 3); k++) {
            this.particles.push({
              x: peg.x + nx * peg.r,
              y: peg.y + ny * peg.r,
              vx: (Math.random() - 0.5) * (peg.isGolden ? 4.5 : 3) + nx * 1.5,
              vy: (Math.random() - 0.5) * (peg.isGolden ? 4.5 : 3) + ny * 1.5,
              color: pColor,
              alpha: 1,
              life: 0,
              maxLife: 20 + Math.floor(Math.random() * 15),
              size: peg.isGolden ? 3.5 : 2.5,
            });
          }
        }
      }

      if (b.y >= this.height - 35) {
        b.active = false;
        this.handleSlotLanding(b.x, b);
        this.balls.splice(idx, 1);
      }
    }
  }

  private handleSlotLanding(ballX: number, _ball: BallPhysics): void {
    const landedSlot = this.slots.find((s) => ballX >= s.xStart && ballX < s.xEnd) || this.slots[Math.floor(this.slots.length / 2)];
    this.batchLandedSlots.push(landedSlot.tier);

    let catsCount = 1;
    if (landedSlot.tier !== 'miss' && this.wager >= 5) {
      const jackpotChance = Math.min(0.35, (this.wager - 4) * 0.02);
      if (Math.random() < jackpotChance) {
        catsCount = Math.random() < 0.3 ? 3 : 2;
      }
    }

    if (landedSlot.tier === 'miss') {
      sound.playFail();
    } else {
      const catsWon = this.plinkoSystem.generateCatsForTier(landedSlot.tier, catsCount, this.preferredArea, this.wager);
      for (const cat of catsWon) {
        this.state.cats.push(cat);
        EventBus.emit('cat-acquired-from-plinko', { cat });
        this.batchWonCats.push(cat);
      }
      sound.playBigWin();
    }

    if (this.batchLandedSlots.length >= this.totalBallsInFlight) {
      setTimeout(() => {
        this.isDropping = false;
        const totalCost = this.getTotalCost();
        const dropBtn = this.backdrop?.querySelector('#plinko-drop-btn') as HTMLButtonElement;
        if (dropBtn) dropBtn.disabled = (this.state.adoptionTokens || 0) < totalCost;

        if (this.batchWonCats.length > 0) {
          this.startSequentialUnboxing(this.batchWonCats, this.batchLandedSlots);
        } else {
          EventBus.emit('toast', { message: 'No cats found in this drop! Upgrade perks or increase your star bet to eliminate miss slots.' });
        }
      }, 350);
    }
  }

  // ── Vampire Survivors Style Sequential Chest Opening ─────────────────────────

  private startSequentialUnboxing(cats: Cat[], landedTiers: PlinkoTier[]): void {
    let currentIndex = 0;
    let stopCurrentPortraitAnim: (() => void) | null = null;

    const unboxBackdrop = document.createElement('div');
    unboxBackdrop.className = 'modal-backdrop plinko-unboxing-backdrop';
    unboxBackdrop.style.zIndex = '10080';

    const modal = document.createElement('div');
    modal.className = 'modal plinko-unboxing-modal';
    unboxBackdrop.appendChild(modal);
    document.body.appendChild(unboxBackdrop);

    const renderCurrentBox = (state: 'closed' | 'buildup' | 'revealed') => {
      if (stopCurrentPortraitAnim) {
        stopCurrentPortraitAnim();
        stopCurrentPortraitAnim = null;
      }

      const cat = cats[currentIndex];
      const winTiers = landedTiers.filter((t) => t !== 'miss');
      const tier = winTiers[currentIndex] || (cat.isRare ? 'rare' : 'common');
      const tierColor = this.getTierColor(tier);
      const isLast = currentIndex >= cats.length - 1;

      const areaMeta = AREA_INFO_MAP[cat.area];
      const mutDef = cat.mutation ? MUTATION_CATALOG[cat.mutation] : null;
      const mutHtml = mutDef
        ? `<div class="reward-cat-mutation" style="background:${mutDef.tagBg};color:${mutDef.tagColor};border:1.5px solid ${mutDef.borderHex};border-radius:999px;padding:4px 14px;font-size:12px;font-weight:900;display:inline-block;margin-top:6px;box-shadow:0 2px 10px ${mutDef.borderHex}55;">${mutDef.badgeLabel}</div>`
        : '';

      if (state === 'closed') {
        modal.innerHTML = `
          <div class="unboxing-container vs-stage-closed">
            <div class="vs-sunburst-rays" style="--tier-color:${tierColor};"></div>
            
            <div class="unboxing-step-badge">
              <span>CHEST ${currentIndex + 1} OF ${cats.length}</span>
            </div>

            <div class="vs-chest-stage">
              <div class="vs-chest-wrapper vs-chest-idle" id="vs-chest-trigger">
                ${CHEST_SVG}
                <div class="vs-chest-glow" style="background:${tierColor};"></div>
              </div>
            </div>

            <div class="unboxing-prompt">
              <h3>Feline Discovery Ready</h3>
              <p>Tap chest or click below to unlock your new companion.</p>
            </div>

            <div class="unboxing-actions">
              <button class="unboxing-open-btn" id="vs-open-btn" style="--btn-color:${tierColor};">
                <span>OPEN</span>
              </button>
              ${cats.length > 1 ? `<button class="unboxing-skip-btn" id="vs-skip-all-btn">Reveal All (${cats.length})</button>` : ''}
            </div>
          </div>
        `;

        const startBuildup = () => {
          sound.playChestReward();
          renderCurrentBox('buildup');
        };

        modal.querySelector('#vs-chest-trigger')?.addEventListener('click', startBuildup);
        modal.querySelector('#vs-open-btn')?.addEventListener('click', startBuildup);
        modal.querySelector('#vs-skip-all-btn')?.addEventListener('click', () => {
          sound.playSuccess();
          this.showAllRevealedGrid(cats, landedTiers, unboxBackdrop, modal);
        });

      } else if (state === 'buildup') {
        modal.innerHTML = `
          <div class="unboxing-container vs-stage-buildup">
            <div class="vs-sunburst-rays vs-rays-accelerate" style="--tier-color:${tierColor};"></div>
            <div class="vs-screen-flash" id="vs-flash-elem"></div>
            
            <div class="unboxing-step-badge">
              <span>UNLOCKING...</span>
            </div>

            <div class="vs-chest-stage">
              <div class="vs-chest-wrapper vs-chest-rumbling">
                ${CHEST_SVG}
                <div class="vs-chest-glow vs-glow-escalate" style="background:${tierColor};"></div>
              </div>
            </div>

            <div class="unboxing-prompt">
              <h3 class="vs-buildup-text">Power Surging...</h3>
            </div>
          </div>
        `;

        sound.playBounce(0.85);
        setTimeout(() => sound.playBounce(1.1), 350);
        setTimeout(() => sound.playCoin(), 700);
        setTimeout(() => sound.playBounce(1.35), 1050);
        setTimeout(() => sound.playCoin(), 1350);

        setTimeout(() => {
          const flash = modal.querySelector('#vs-flash-elem');
          if (flash) flash.classList.add('active');
        }, 1600);

        setTimeout(() => {
          sound.playSuccess();
          renderCurrentBox('revealed');
        }, 1800);

      } else {
        modal.innerHTML = `
          <div class="unboxing-container vs-stage-revealed">
            <div class="vs-sunburst-rays vs-rays-celebrate" style="--tier-color:${tierColor};"></div>
            <div class="unboxing-confetti-burst"></div>

            <div class="unboxing-step-badge">
              <span>DISCOVERED ${currentIndex + 1} OF ${cats.length}</span>
            </div>

            <div class="unboxing-reveal-stage">
              <div class="vs-card-reveal-impact" style="border-color:${tierColor}; box-shadow: 0 10px 40px ${tierColor}44;">
                <div class="unboxing-card-tier-tag" style="background:${tierColor};">
                  ${tier.toUpperCase()} ARRIVAL
                </div>
                
                <div class="vs-cat-portrait-wrap">
                  <canvas class="vs-cat-canvas" id="vs-current-cat-canvas" width="128" height="128"></canvas>
                </div>

                <div class="unboxing-cat-name">${cat.name}</div>
                <div class="unboxing-cat-stage">Stage: <b>${cap(cat.stage)}</b></div>
                ${mutHtml}

                <div class="unboxing-cat-details">
                  <div class="cat-detail-row"><span>Personality:</span> <b>${cap(cat.majorTrait)} & ${cap(cat.minorTrait)}</b></div>
                  <div class="cat-detail-row"><span>Location:</span> <b>${areaMeta?.label || cat.area}</b></div>
                  <div class="cat-detail-row"><span>Favorite:</span> <b>${cat.favoriteFood}</b></div>
                </div>
              </div>
            </div>

            <div class="unboxing-actions">
              ${!isLast
                ? `<button class="unboxing-open-btn unboxing-next-btn" id="unbox-next-btn"><span>Next</span></button>
                   <button class="unboxing-skip-btn" id="unbox-skip-all-btn">Reveal All</button>`
                : `<button class="unboxing-open-btn unboxing-finish-btn" id="unbox-finish-btn"><span>Welcome to Sanctuary</span></button>`}
            </div>
          </div>
        `;

        const canvas = modal.querySelector<HTMLCanvasElement>('#vs-current-cat-canvas');
        if (canvas) {
          stopCurrentPortraitAnim = PlinkoModal.drawCatPortrait(canvas, cat);
        }

        modal.querySelector('#unbox-next-btn')?.addEventListener('click', () => {
          sound.playTap();
          currentIndex++;
          renderCurrentBox('closed');
        });

        modal.querySelector('#unbox-skip-all-btn')?.addEventListener('click', () => {
          sound.playSuccess();
          this.showAllRevealedGrid(cats, landedTiers, unboxBackdrop, modal);
        });

        modal.querySelector('#unbox-finish-btn')?.addEventListener('click', () => {
          if (stopCurrentPortraitAnim) stopCurrentPortraitAnim();
          sound.playTap();
          unboxBackdrop.remove();
        });
      }
    };

    renderCurrentBox('closed');
  }

  private showAllRevealedGrid(cats: Cat[], landedTiers: PlinkoTier[], backdrop: HTMLElement, modal: HTMLElement): void {
    const winTiers = landedTiers.filter((t) => t !== 'miss');
    const highestTier = winTiers.includes('legendary') ? 'legendary' : winTiers.includes('epic') ? 'epic' : winTiers.includes('rare') ? 'rare' : winTiers.includes('uncommon') ? 'uncommon' : 'common';
    const tierColor = this.getTierColor(highestTier);

    const catCardsHtml = cats
      .map((c, i) => {
        const areaMeta = AREA_INFO_MAP[c.area];
        const mutDef = c.mutation ? MUTATION_CATALOG[c.mutation] : null;
        const mutHtml = mutDef
          ? `<div class="reward-cat-mutation" style="background:${mutDef.tagBg};color:${mutDef.tagColor};border:1.5px solid ${mutDef.borderHex};border-radius:999px;padding:3px 10px;font-size:11px;font-weight:900;display:inline-block;margin-top:4px;">${mutDef.badgeLabel}</div>`
          : '';
        return `
          <div class="plinko-cat-reward-card">
            <div class="summary-cat-portrait-box">
              <canvas class="summary-cat-canvas" data-summary-idx="${i}" width="64" height="64"></canvas>
            </div>
            <div class="summary-cat-text">
              <div class="reward-cat-title"><b>${c.name}</b> (${cap(c.stage)})</div>
              ${mutHtml}
              <div class="reward-cat-trait">Personality: ${cap(c.majorTrait)} & ${cap(c.minorTrait)}</div>
              <div class="reward-cat-area">Location: <b>${areaMeta?.label || c.area}</b></div>
              <div class="reward-cat-favorite">Favorite: ${c.favoriteFood}</div>
            </div>
          </div>
        `;
      })
      .join('');

    modal.innerHTML = `
      <h2>New Sanctuary Arrivals</h2>
      <div style="margin-bottom:12px;">
        <span class="stage-tag-badge" style="background:${tierColor};color:#fff;font-weight:bold;padding:4px 14px;border-radius:12px;">
          ${highestTier.toUpperCase()} BATCH (${cats.length} Cats)
        </span>
      </div>
      <p style="font-size:13.5px;color:var(--brown-light);margin-bottom:16px;">
        All <b>${cats.length}</b> new cats have arrived and settled into the sanctuary!
      </p>
      <div class="plinko-cats-grid">
        ${catCardsHtml}
      </div>
      <button class="modal-close" id="reward-collect-all-btn" style="margin-top:18px;">Welcome Home</button>
    `;

    modal.querySelectorAll<HTMLCanvasElement>('canvas.summary-cat-canvas').forEach((canvas) => {
      const idx = parseInt(canvas.dataset.summaryIdx || '0', 10);
      const cat = cats[idx];
      if (cat) PlinkoModal.drawCatPortrait(canvas, cat);
    });

    modal.querySelector('#reward-collect-all-btn')?.addEventListener('click', () => {
      sound.playTap();
      backdrop.remove();
    });
  }

  // ── Cat Sprite Renderer ───────────────────────────────────────────────────

  private static drawCatPortrait(canvas: HTMLCanvasElement, cat: Cat): () => void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};
    ctx.imageSmoothingEnabled = false;

    const skinDef = CAT_SKINS.find((s) => s.id === cat.color) || CAT_SKINS[0];
    const baseSrc = `assets/cats/${skinDef.file}`;
    const markSrc = cat.marking ? `assets/cats/Markings/${encodeURIComponent(cat.marking)}` : null;

    let stopped = false;
    let animId: number | null = null;

    const getImage = (src: string, cb: (img: HTMLImageElement) => void) => {
      if (PlinkoModal.catImageCache.has(src)) {
        const img = PlinkoModal.catImageCache.get(src)!;
        if (img.complete && img.naturalWidth > 0) cb(img);
        else img.addEventListener('load', () => cb(img), { once: true });
      } else {
        const img = new Image();
        img.src = src;
        PlinkoModal.catImageCache.set(src, img);
        img.addEventListener('load', () => cb(img), { once: true });
      }
    };

    let baseImg: HTMLImageElement | null = null;
    let markImg: HTMLImageElement | null = null;

    getImage(baseSrc, (img) => { baseImg = img; });
    if (markSrc) {
      getImage(markSrc, (img) => { markImg = img; });
    }

    interface AnimFrame { col: number; row: number; dur: number }
    const sitFrames: AnimFrame[] = [
      { col: 0, row: 1, dur: 280 },
      { col: 1, row: 1, dur: 280 },
      { col: 2, row: 1, dur: 280 },
      { col: 3, row: 1, dur: 320 },
      { col: 2, row: 1, dur: 280 },
      { col: 1, row: 1, dur: 280 },
    ];

    let frameIdx = Math.floor(Math.random() * sitFrames.length);
    let lastTime = performance.now() - Math.random() * sitFrames[frameIdx].dur;
    const speedFactor = 0.92 + Math.random() * 0.16;

    const draw = (now: number) => {
      if (stopped) return;
      if (now - lastTime >= sitFrames[frameIdx].dur / speedFactor) {
        frameIdx = (frameIdx + 1) % sitFrames.length;
        lastTime = now;
      }
      const frame = sitFrames[frameIdx];
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (baseImg && baseImg.complete && baseImg.naturalWidth > 0) {
        const targetSize = cat.mutation === 'tiny' ? canvas.width * 0.68 : cat.mutation === 'giant' ? canvas.width : canvas.width * 0.90;
        const targetX = (canvas.width - targetSize) / 2;
        const targetY = (canvas.height - targetSize) / 2 + (cat.mutation === 'tiny' ? 4 : 0);

        ctx.save();
        if (cat.mutation === 'inverted') {
          const invT = (Math.sin(now / 360) + 1) / 2;
          ctx.filter = `invert(0.92) hue-rotate(${160 + invT * 50}deg) saturate(1.8)`;
        } else if (cat.mutation === 'frosted') {
          const iceT = (Math.sin(now / 380) + 1) / 2;
          ctx.filter = `hue-rotate(${175 + iceT * 35}deg) saturate(${1.6 + iceT * 1.0}) brightness(${1.05 + iceT * 0.25})`;
        } else if (cat.mutation === 'flaming') {
          const fireT = (Math.sin(now / 300) + 1) / 2;
          ctx.filter = `sepia(0.65) saturate(${3.2 + fireT * 1.5}) hue-rotate(${-32 + fireT * 35}deg) brightness(${1.05 + fireT * 0.2})`;
        } else if (cat.mutation === 'chromatic') {
          ctx.filter = `hue-rotate(${(now / 12) % 360}deg) saturate(2.4)`;
        } else if (cat.mutation === 'sparkly') {
          const sparkT = (Math.sin(now / 320) + 1) / 2;
          ctx.filter = `hue-rotate(${275 + sparkT * 40}deg) saturate(2.2) brightness(${1.2 + sparkT * 0.25})`;
        } else if (cat.mutation === 'gilded') {
          const goldT = (Math.sin(now / 340) + 1) / 2;
          ctx.filter = `sepia(0.9) saturate(${3.8 + goldT * 1.2}) hue-rotate(8deg) brightness(${1.1 + goldT * 0.3})`;
        } else if (cat.mutation === 'stinky') {
          const stinkyT = (Math.sin(now / 450) + 1) / 2;
          const hue = 30 + stinkyT * 85; // Oscillates from 30deg (muddy brown) to 115deg (toxic green)
          ctx.filter = `sepia(0.55) hue-rotate(${hue}deg) saturate(2.5) brightness(0.95)`;
        }

        const sx = frame.col * 32;
        const sy = frame.row * 32;
        ctx.drawImage(baseImg, sx, sy, 32, 32, targetX, targetY, targetSize, targetSize);

        if (markImg && markImg.complete && markImg.naturalWidth > 0) {
          ctx.drawImage(markImg, sx, sy, 32, 32, targetX, targetY, targetSize, targetSize);
        }
        ctx.restore();

        if (cat.mutation === 'angelic') {
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const haloBob = Math.sin((now % 1200) / 1200 * Math.PI * 2) * 1.5;
          ctx.ellipse(canvas.width / 2, targetY - 3 + haloBob, 10, 3.5, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (cat.mutation === 'stinky') {
          const puffPhase = (now % 1400) / 1400;
          ctx.fillStyle = 'rgba(74, 222, 128, 0.7)';
          ctx.beginPath();
          ctx.arc(canvas.width / 2 + Math.sin(puffPhase * 6.28) * 6, targetY - puffPhase * 12, 3.5 * (1 - puffPhase * 0.3), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);

    return () => {
      stopped = true;
      if (animId) cancelAnimationFrame(animId);
    };
  }

  private getTierColor(tier: PlinkoTier): string {
    switch (tier) {
      case 'legendary': return '#f59e0b';
      case 'epic': return '#ec4899';
      case 'rare': return '#a855f7';
      case 'uncommon': return '#0284c7';
      case 'common': return '#2d6a4f';
      default: return '#6b7280';
    }
  }

  private renderCanvas(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    const bgGrad = ctx.createLinearGradient(0, 0, 0, this.height);
    bgGrad.addColorStop(0, '#fdfaf5');
    bgGrad.addColorStop(1, '#f4ede4');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.fillStyle = '#e8dfd5';
    ctx.beginPath();
    ctx.moveTo(this.width / 2 - 40, 0);
    ctx.lineTo(this.width / 2 + 40, 0);
    ctx.lineTo(this.width / 2 + 20, 24);
    ctx.lineTo(this.width / 2 - 20, 24);
    ctx.closePath();
    ctx.fill();

    for (const slot of this.slots) {
      ctx.fillStyle = slot.bgHex;
      ctx.fillRect(slot.xStart, this.height - 35, slot.xEnd - slot.xStart, 35);
      ctx.strokeStyle = slot.borderHex;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(slot.xStart, this.height - 35, slot.xEnd - slot.xStart, 35);
      ctx.fillStyle = slot.color;
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(slot.label, (slot.xStart + slot.xEnd) / 2, this.height - 14);
    }

    const timeSec = Date.now() / 1000;
    for (const peg of this.pegs) {
      if (peg.isGolden) {
        const pulse = 1 + Math.sin(timeSec * 6 + peg.x) * 0.18;
        ctx.fillStyle = `rgba(251, 191, 36, ${0.45 * pulse})`;
        ctx.beginPath();
        ctx.arc(peg.x, peg.y, (peg.r + 3.5) * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(peg.x - 1.4, peg.y - 1.4, 1.8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        if (peg.flash > 0) {
          ctx.fillStyle = `rgba(245, 158, 11, ${peg.flash * 0.6})`;
          ctx.beginPath();
          ctx.arc(peg.x, peg.y, peg.r + 5 * peg.flash, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#6b4f3b';
        ctx.beginPath();
        ctx.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#eedfcc';
        ctx.beginPath();
        ctx.arc(peg.x - 1.2, peg.y - 1.2, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size || 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const b of this.balls) {
      if (!b.active) continue;
      for (let i = 0; i < b.trail.length; i++) {
        const pt = b.trail[i];
        const a = (i / b.trail.length) * 0.45;
        ctx.fillStyle = b.color;
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, b.r * (0.4 + 0.6 * (i / b.trail.length)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;
      const ballGrad = ctx.createRadialGradient(b.x - 2, b.y - 2, 1, b.x, b.y, b.r);
      ballGrad.addColorStop(0, '#ffffff');
      ballGrad.addColorStop(0.3, b.color);
      ballGrad.addColorStop(1, '#b45309');
      ctx.fillStyle = ballGrad;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}
