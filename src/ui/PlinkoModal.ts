import type { Cat, CatArea, GameState } from '../data/types';
import { PlinkoSystem, getPlinkoBoardRank, type PlinkoTier, type PlinkoBoardRank } from '../systems/PlinkoSystem';
import { EventBus } from './EventBus';
import { sound } from '../systems/SoundManager';
import { SVG_ICONS } from './icons';
import { AREA_INFO_MAP } from '../data/constants';
import { MUTATION_CATALOG } from '../data/mutations';

interface Peg {
  x: number;
  y: number;
  r: number;
  flash: number; // for hit glow effect
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

export class PlinkoModal {
  private root: HTMLElement;
  private state: GameState;
  private plinkoSystem: PlinkoSystem;
  private backdrop: HTMLElement | null = null;

  private wager = 1;
  private isDropping = false;
  private animationFrameId: number | null = null;

  // Physics simulation properties
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private width = 360;
  private height = 400;

  private pegs: Peg[] = [];
  private slots: SlotZone[] = [];
  private particles: Particle[] = [];

  // Active ball physics
  private ball: { x: number; y: number; vx: number; vy: number; r: number; active: boolean; trail: { x: number; y: number }[] } | null = null;

  private preferredArea: CatArea;

  constructor(root: HTMLElement, state: GameState, preferredArea: CatArea = 'yard') {
    this.root = root;
    this.state = state;
    this.preferredArea = preferredArea;
    this.plinkoSystem = new PlinkoSystem(state);
  }

  open(): void {
    if (this.backdrop) this.close();

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
      dropBtn.disabled = tokens < this.wager;
    }
  };

  close(): void {
    EventBus.off('tokens-changed', this.handleTokensChanged);
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.backdrop) {
      this.backdrop.remove();
      this.backdrop = null;
    }
    this.ball = null;
    this.isDropping = false;
  }

  private renderModalContent(modal: HTMLElement): void {
    const starBalance = this.state.adoptionTokens || 0;
    const odds = this.plinkoSystem.calculateOdds(this.wager);
    const rank = getPlinkoBoardRank(this.wager);

    modal.innerHTML = `
      <div class="plinko-header">
        <div class="plinko-title-row">
          <h2>⭐ Cat Plinko</h2>
          <div class="plinko-star-badge" title="Your Star Balance">
            <span class="svg-inline">${SVG_ICONS.star}</span>
            <span id="plinko-star-balance" class="plinko-star-val">${starBalance}</span>
          </div>
        </div>
        <p class="plinko-subtitle">Drop stars to discover new cats! Higher bets upgrade the board & unlock multi-cat drops.</p>
      </div>

      <div class="plinko-game-container">
        <div class="plinko-board-rank-container" id="plinko-board-rank-container">
          ${this.renderBoardRankCard(rank)}
        </div>

        <div class="plinko-canvas-wrapper">
          <canvas id="plinko-canvas" width="${this.width}" height="${this.height}"></canvas>
        </div>

        <div class="plinko-controls-panel">
          <div class="plinko-wager-section">
            <div class="plinko-wager-label-row">
              <label for="plinko-wager-input"><b>Wager Amount:</b></label>
              <span class="plinko-win-rate-badge" id="plinko-win-rate">Win Chance: <b>${odds.winChancePercent}%</b></span>
            </div>

            <div class="plinko-wager-input-row">
              <button class="plinko-step-btn" id="plinko-minus-btn" title="Decrease bet">−</button>
              <input type="number" id="plinko-wager-input" min="1" max="${Math.max(1, starBalance)}" value="${this.wager}" />
              <button class="plinko-step-btn" id="plinko-plus-btn" title="Increase bet">+</button>
            </div>

            <div class="plinko-quick-bets">
              <button class="plinko-chip-btn ${this.wager === 1 ? 'active' : ''}" data-bet="1">1 ⭐</button>
              <button class="plinko-chip-btn ${this.wager === 5 ? 'active' : ''}" data-bet="5">5 ⭐</button>
              <button class="plinko-chip-btn ${this.wager === 10 ? 'active' : ''}" data-bet="10">10 ⭐</button>
              <button class="plinko-chip-btn ${this.wager === 25 ? 'active' : ''}" data-bet="25">25 ⭐</button>
              <button class="plinko-chip-btn ${this.wager === 50 ? 'active' : ''}" data-bet="50">50 ⭐</button>
              <button class="plinko-chip-btn ${this.wager === 100 ? 'active' : ''}" data-bet="100">100 ⭐</button>
              <button class="plinko-chip-btn ${this.wager === 250 ? 'active' : ''}" data-bet="250">250 ⭐</button>
              <button class="plinko-chip-btn" id="plinko-max-btn">Max</button>
            </div>
          </div>

          <div class="plinko-odds-breakdown" id="plinko-odds-breakdown">
            ${this.renderOddsBreakdown(odds)}
          </div>

          <button class="plinko-drop-btn" id="plinko-drop-btn" ${starBalance < this.wager ? 'disabled' : ''}>
            <span class="svg-inline">${SVG_ICONS.sparkle}</span>
            <span>Drop Ball (⭐ ${this.wager})</span>
          </button>
        </div>
      </div>

      <button class="modal-close" id="plinko-close-btn">Done</button>
    `;

    this.bindControls(modal);
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

    if (odds.jackpotChancePercent > 0) {
      pills.push(`
        <div class="odds-pill jackpot-pill" title="Multi-Cat Jackpot chance">
          <span class="odds-dot" style="background:#ec4899;"></span>
          <span>Multi-Drop: <b>${odds.jackpotChancePercent}%</b></span>
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

    const updateWager = (val: number) => {
      const maxStars = Math.max(1, this.state.adoptionTokens || 0);
      this.wager = Math.max(1, Math.min(val, maxStars));
      if (wagerInput) wagerInput.value = String(this.wager);

      // Dynamically update the bottom slots on the board
      this.updateSlotsForWager(this.wager);

      const odds = this.plinkoSystem.calculateOdds(this.wager);
      const rank = getPlinkoBoardRank(this.wager);

      const rankContainer = modal.querySelector('#plinko-board-rank-container');
      if (rankContainer) rankContainer.innerHTML = this.renderBoardRankCard(rank);

      const winRateEl = modal.querySelector('#plinko-win-rate');
      if (winRateEl) winRateEl.innerHTML = `Win Chance: <b>${odds.winChancePercent}%</b>`;

      const breakdownEl = modal.querySelector('#plinko-odds-breakdown');
      if (breakdownEl) breakdownEl.innerHTML = this.renderOddsBreakdown(odds);

      const hasSpace = this.plinkoSystem.hasRemainingSanctuarySpace();
      const canAfford = (this.state.adoptionTokens || 0) >= this.wager;

      if (dropBtn) {
        if (!hasSpace) {
          dropBtn.innerHTML = `<span class="svg-inline">${SVG_ICONS.sparkle}</span><span>Sanctuary Full (No Room)</span>`;
          dropBtn.disabled = true;
        } else {
          dropBtn.innerHTML = `<span class="svg-inline">${SVG_ICONS.sparkle}</span><span>Drop Ball (⭐ ${this.wager})</span>`;
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

    maxBtn?.addEventListener('click', () => {
      sound.playTap();
      const maxStars = this.state.adoptionTokens || 0;
      updateWager(Math.max(1, maxStars));
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

    for (let r = 0; r < rows; r++) {
      const pegsInRow = r + 3;
      const spacing = this.width / (pegsInRow + 1);
      for (let i = 0; i < pegsInRow; i++) {
        const x = spacing * (i + 1);
        const y = startY + r * rowHeight;
        this.pegs.push({ x, y, r: 4.5, flash: 0 });
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

    const rank = getPlinkoBoardRank(wager);
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
      } as any);
    }
  }

  private triggerDrop(): void {
    if (this.isDropping) return;

    if (!this.plinkoSystem.hasRemainingSanctuarySpace()) {
      EventBus.emit('toast', { message: '🏠 Sanctuary is full! Expand or unlock an area first to play Plinko.' });
      sound.playTap();
      return;
    }

    if ((this.state.adoptionTokens || 0) < this.wager) {
      EventBus.emit('toast', { message: '⭐ Not enough Stars! Breed cats or complete goals to earn more.' });
      return;
    }

    // Deduct Stars
    this.state.adoptionTokens = Math.max(0, (this.state.adoptionTokens || 0) - this.wager);
    EventBus.emit('spend-tokens', { amount: this.wager });
    EventBus.emit('tokens-changed', { tokens: this.state.adoptionTokens });
    sound.playCoin();

    // Update UI star counter
    const balEl = this.backdrop?.querySelector('#plinko-star-balance');
    if (balEl) balEl.textContent = String(this.state.adoptionTokens);

    const dropBtn = this.backdrop?.querySelector('#plinko-drop-btn') as HTMLButtonElement;
    if (dropBtn) dropBtn.disabled = true;

    this.isDropping = true;

    // Spawn ball at top with slight random horizontal start
    const startX = this.width / 2 + (Math.random() - 0.5) * 36;
    this.ball = {
      x: startX,
      y: 18,
      vx: (Math.random() - 0.5) * 2,
      vy: 1.0,
      r: 7,
      active: true,
      trail: [],
    };
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
    // Update peg flashes
    for (const peg of this.pegs) {
      if (peg.flash > 0) peg.flash = Math.max(0, peg.flash - 0.05);
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12; // gravity
      p.life++;
      p.alpha = Math.max(0, 1 - p.life / p.maxLife);
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
      }
    }

    if (!this.ball || !this.ball.active) return;

    const b = this.ball;
    const gravity = 0.20;
    const friction = 0.988;
    const restitution = 0.70;

    b.vy += gravity;
    b.vx *= friction;
    b.x += b.vx;
    b.y += b.vy;

    // Record trail
    b.trail.unshift({ x: b.x, y: b.y });
    if (b.trail.length > 10) b.trail.pop();

    // Side wall collisions
    if (b.x - b.r < 12) {
      b.x = 12 + b.r;
      b.vx = Math.abs(b.vx) * restitution + 0.6;
    } else if (b.x + b.r > this.width - 12) {
      b.x = this.width - 12 - b.r;
      b.vx = -Math.abs(b.vx) * restitution - 0.6;
    }

    // Peg collisions
    for (const peg of this.pegs) {
      const dx = b.x - peg.x;
      const dy = b.y - peg.y;
      const dist = Math.hypot(dx, dy);
      const minDist = b.r + peg.r;

      if (dist < minDist && dist > 0) {
        // Normal vector
        const nx = dx / dist;
        const ny = dy / dist;

        // Position resolution
        b.x = peg.x + nx * minDist;
        b.y = peg.y + ny * minDist;

        // Velocity reflection
        const dot = b.vx * nx + b.vy * ny;
        b.vx = (b.vx - 2 * dot * nx) * restitution + (Math.random() - 0.5) * 0.9;
        b.vy = (b.vy - 2 * dot * ny) * restitution + (Math.random() - 0.5) * 0.5;

        peg.flash = 1.0;
        sound.playTap();

        // Emit spark particles
        for (let k = 0; k < 4; k++) {
          this.particles.push({
            x: peg.x + nx * peg.r,
            y: peg.y + ny * peg.r,
            vx: (Math.random() - 0.5) * 3 + nx * 1.5,
            vy: (Math.random() - 0.5) * 3 + ny * 1.5,
            color: ['#f59e0b', '#fbbf24', '#ec4899', '#38bdf8'][Math.floor(Math.random() * 4)],
            alpha: 1,
            life: 0,
            maxLife: 20 + Math.floor(Math.random() * 15),
          });
        }
      }
    }

    // Bottom slot entry
    if (b.y >= this.height - 35) {
      b.active = false;
      this.handleSlotLanding(b.x);
    }
  }

  private handleSlotLanding(ballX: number): void {
    const landedSlot = this.slots.find((s) => ballX >= s.xStart && ballX < s.xEnd) || this.slots[Math.floor(this.slots.length / 2)];
    
    let catsCount = 1;
    let isJackpot = false;
    if (landedSlot.tier !== 'miss' && this.wager >= 5) {
      const jackpotChance = Math.min(0.25, (this.wager - 4) * 0.02);
      if (Math.random() < jackpotChance) {
        isJackpot = true;
        catsCount = Math.random() < 0.25 ? 3 : 2;
      }
    }

    // Emit celebration particles
    for (let k = 0; k < 30; k++) {
      this.particles.push({
        x: ballX,
        y: this.height - 35,
        vx: (Math.random() - 0.5) * 6,
        vy: -Math.random() * 5 - 2,
        color: ['#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#a855f7'][Math.floor(Math.random() * 5)],
        alpha: 1,
        life: 0,
        maxLife: 40 + Math.floor(Math.random() * 20),
      });
    }

    setTimeout(() => {
      this.isDropping = false;
      const dropBtn = this.backdrop?.querySelector('#plinko-drop-btn') as HTMLButtonElement;
      if (dropBtn) dropBtn.disabled = (this.state.adoptionTokens || 0) < this.wager;

      if (landedSlot.tier === 'miss') {
        sound.playPop();
        EventBus.emit('toast', { message: '💨 Missed this drop! Higher star wagers guarantee better odds.' });
      } else {
        const catsWon = this.plinkoSystem.generateCatsForTier(landedSlot.tier, catsCount, this.preferredArea, this.wager);
        for (const cat of catsWon) {
          this.state.cats.push(cat);
          EventBus.emit('cat-acquired-from-plinko', { cat });
        }
        sound.playAdoptFanfare();
        this.showCelebrationModal(catsWon, landedSlot.tier, isJackpot);
      }
    }, 450);
  }

  private showCelebrationModal(cats: Cat[], tier: PlinkoTier, isJackpot: boolean): void {
    const modal = document.createElement('div');
    modal.className = 'modal plinko-reward-modal';

    const tierBadgeHtml = `
      <span class="stage-tag-badge" style="background:${this.getTierColor(tier)};color:#fff;font-weight:bold;padding:4px 10px;border-radius:12px;">
        ${tier.toUpperCase()} ${isJackpot ? '🎉 JACKPOT!' : ''}
      </span>
    `;

    const catCardsHtml = cats
      .map((c) => {
        const areaMeta = AREA_INFO_MAP[c.area];
        const mutDef = c.mutation ? MUTATION_CATALOG[c.mutation] : null;
        const mutHtml = mutDef
          ? `<div class="reward-cat-mutation" style="background:${mutDef.tagBg};color:${mutDef.tagColor};border:1.5px solid ${mutDef.borderHex};border-radius:999px;padding:2px 8px;font-size:11px;font-weight:800;display:inline-block;margin-top:4px;">${mutDef.badgeLabel}</div>`
          : '';

        return `
        <div class="plinko-cat-reward-card">
          <div class="reward-cat-title"><b>${c.name}</b> (${cap(c.stage)})</div>
          ${mutHtml}
          <div class="reward-cat-trait">✨ Personality: ${cap(c.majorTrait)} & ${cap(c.minorTrait)}</div>
          <div class="reward-cat-area">🏡 Settled in: <b>${areaMeta?.label || c.area}</b></div>
          <div class="reward-cat-favorite">🐟 Favorite: ${c.favoriteFood}</div>
        </div>
      `;
      })
      .join('');

    modal.innerHTML = `
      <h2>🐾 New Sanctuary Arrival${cats.length > 1 ? 's' : ''}!</h2>
      <div style="margin-bottom:12px;">${tierBadgeHtml}</div>
      <p style="font-size:14px;color:var(--text-dark);margin-bottom:16px;">
        ${
          isJackpot
            ? `<b>Incredible!</b> You hit a multi-cat jackpot and welcomed <b>${cats.length}</b> new cats to the sanctuary!`
            : `Congratulations! <b>${cats[0].name}</b> was drawn to your sanctuary and found a warm home!`
        }
      </p>
      <div class="plinko-cats-grid">
        ${catCardsHtml}
      </div>
      <button class="modal-close" id="reward-done-btn" style="margin-top:16px;">Welcome Home!</button>
    `;

    const innerBackdrop = document.createElement('div');
    innerBackdrop.className = 'modal-backdrop';
    innerBackdrop.appendChild(modal);
    this.root.appendChild(innerBackdrop);

    modal.querySelector('#reward-done-btn')?.addEventListener('click', () => {
      sound.playTap();
      innerBackdrop.remove();
    });
  }

  private getTierColor(tier: PlinkoTier): string {
    switch (tier) {
      case 'legendary': return '#b45309';
      case 'epic': return '#be185d';
      case 'rare': return '#7e22ce';
      case 'uncommon': return '#0284c7';
      case 'common': return '#2d6a4f';
      default: return '#8d7865';
    }
  }

  private renderCanvas(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // 1. Cozy Honey Birch Wood Board Base
    const bgGrad = ctx.createLinearGradient(0, 0, 0, this.height);
    bgGrad.addColorStop(0, '#fdfaf5');
    bgGrad.addColorStop(0.5, '#f7efe2');
    bgGrad.addColorStop(1, '#eedecb');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, this.width, this.height);

    // Subtle Warm Vertical Wood Grain Lines
    ctx.strokeStyle = 'rgba(180, 140, 100, 0.08)';
    ctx.lineWidth = 1;
    for (let gx = 16; gx < this.width - 12; gx += 14) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx + (gx % 28 === 0 ? 6 : -4), this.height);
      ctx.stroke();
    }

    // 2. Polished Mahogany / Oak Wooden Frame Borders
    ctx.strokeStyle = '#a67c52';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, this.width - 12, this.height - 12);

    ctx.strokeStyle = '#d4a373';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(9, 9, this.width - 18, this.height - 18);

    // Cute Brass Corner Rivets
    const corners = [
      [14, 14],
      [this.width - 14, 14],
      [14, this.height - 14],
      [this.width - 14, this.height - 14],
    ];
    for (const [cx, cy] of corners) {
      ctx.fillStyle = '#e09f3e';
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff4d4';
      ctx.beginPath();
      ctx.arc(cx - 0.7, cy - 0.7, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Golden Brass Pegs
    for (const peg of this.pegs) {
      // Soft shadow underneath
      ctx.fillStyle = 'rgba(90, 60, 35, 0.2)';
      ctx.beginPath();
      ctx.arc(peg.x, peg.y + 1.8, peg.r, 0, Math.PI * 2);
      ctx.fill();

      // Brass body gradient
      const pegGrad = ctx.createRadialGradient(peg.x - 1.2, peg.y - 1.2, 0.5, peg.x, peg.y, peg.r);
      if (peg.flash > 0) {
        pegGrad.addColorStop(0, '#ffffff');
        pegGrad.addColorStop(0.5, '#fef08a');
        pegGrad.addColorStop(1, '#f59e0b');
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 14 * peg.flash;
      } else {
        pegGrad.addColorStop(0, '#fff4cc');
        pegGrad.addColorStop(0.4, '#ffd166');
        pegGrad.addColorStop(0.85, '#e09f3e');
        pegGrad.addColorStop(1, '#b07d2b');
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = pegGrad;
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Peg Brass Rim Outline
      ctx.strokeStyle = peg.flash > 0 ? '#fde047' : '#935817';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Highlight gleam
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.beginPath();
      ctx.arc(peg.x - 1.3, peg.y - 1.3, peg.r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Bottom Catch Compartments / Slots
    const slotY = this.height - 38;
    const slotH = 30;

    for (const slot of this.slots) {
      const sx = slot.xStart + 2;
      const sw = (slot.xEnd - slot.xStart) - 4;

      // Slot Compartment Tray Drop Shadow
      ctx.fillStyle = 'rgba(90, 60, 35, 0.15)';
      ctx.fillRect(sx, slotY + 2, sw, slotH);

      // Pastel Felt Inset Background
      ctx.fillStyle = slot.bgHex;
      ctx.fillRect(sx, slotY, sw, slotH);

      // Compartment Border
      ctx.strokeStyle = slot.borderHex || slot.color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx, slotY, sw, slotH);

      // Top divider post caps
      ctx.fillStyle = '#b08968';
      ctx.fillRect(slot.xStart - 1.5, slotY - 4, 3, 6);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(slot.xStart - 1, slotY - 5, 2, 2);

      // Slot Label
      ctx.fillStyle = slot.color;
      ctx.font = 'bold 9.5px "Nunito", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(slot.label, (slot.xStart + slot.xEnd) / 2, slotY + slotH / 2);
    }

    // 5. Celebration & Impact Particles
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 6. Glowing Golden Star Marble Ball & Trail
    if (this.ball && this.ball.active) {
      const b = this.ball;

      // Star Sparkle Trail
      for (let t = 0; t < b.trail.length; t++) {
        const pt = b.trail[t];
        const alpha = (1 - t / b.trail.length) * 0.45;
        const radius = b.r * (1 - t / b.trail.length * 0.55);
        ctx.fillStyle = `rgba(255, 183, 3, ${alpha})`;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Ball Soft Drop Shadow on Board
      ctx.fillStyle = 'rgba(77, 56, 39, 0.25)';
      ctx.beginPath();
      ctx.arc(b.x + 1.5, b.y + 2.5, b.r, 0, Math.PI * 2);
      ctx.fill();

      // Ball Glowing Golden Body
      const ballGrad = ctx.createRadialGradient(b.x - 2.2, b.y - 2.2, 1, b.x, b.y, b.r);
      ballGrad.addColorStop(0, '#ffffff');
      ballGrad.addColorStop(0.25, '#fff0a6');
      ballGrad.addColorStop(0.7, '#ffb703');
      ballGrad.addColorStop(1, '#e07a00');

      ctx.fillStyle = ballGrad;
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Ball Outer Golden Rim
      ctx.strokeStyle = '#fff8db';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Top Specular Star Shine
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(b.x - 2.2, b.y - 2.2, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function cap(s?: string): string {
  if (!s || typeof s !== 'string') return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
