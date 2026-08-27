import type { Cat, GameState } from '../data/types';
import { PlinkoSystem, type PlinkoTier } from '../systems/PlinkoSystem';
import { EventBus } from './EventBus';
import { sound } from '../systems/SoundManager';
import { SVG_ICONS } from './icons';

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

  constructor(root: HTMLElement, state: GameState) {
    this.root = root;
    this.state = state;
    this.plinkoSystem = new PlinkoSystem(state);
  }

  open(): void {
    if (this.backdrop) this.close();

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

  close(): void {
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

    modal.innerHTML = `
      <div class="plinko-header">
        <div class="plinko-title-row">
          <h2>⭐ Cat Plinko</h2>
          <div class="plinko-star-badge" title="Your Star Balance">
            <span class="svg-inline">${SVG_ICONS.star}</span>
            <span id="plinko-star-balance" class="plinko-star-val">${starBalance}</span>
          </div>
        </div>
        <p class="plinko-subtitle">Drop stars to discover new cats! Higher bets boost win rate & unlock rare jackpots.</p>
      </div>

      <div class="plinko-game-container">
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
              <button class="plinko-chip-btn ${this.wager === 2 ? 'active' : ''}" data-bet="2">2 ⭐</button>
              <button class="plinko-chip-btn ${this.wager === 5 ? 'active' : ''}" data-bet="5">5 ⭐</button>
              <button class="plinko-chip-btn ${this.wager === 10 ? 'active' : ''}" data-bet="10">10 ⭐</button>
              <button class="plinko-chip-btn ${this.wager === 25 ? 'active' : ''}" data-bet="25">25 ⭐</button>
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

  private renderOddsBreakdown(odds: ReturnType<PlinkoSystem['calculateOdds']>): string {
    return `
      <div class="odds-pill common-pill" title="Common tier">
        <span class="odds-dot" style="background:#94a3b8;"></span>
        <span>Common: <b>${odds.commonPercent}%</b></span>
      </div>
      <div class="odds-pill uncommon-pill" title="Uncommon tier">
        <span class="odds-dot" style="background:#10b981;"></span>
        <span>Uncommon: <b>${odds.uncommonPercent}%</b></span>
      </div>
      <div class="odds-pill rare-pill" title="Rare tier">
        <span class="odds-dot" style="background:#3b82f6;"></span>
        <span>Rare: <b>${odds.rarePercent}%</b></span>
      </div>
      <div class="odds-pill epic-pill" title="Epic tier">
        <span class="odds-dot" style="background:#8b5cf6;"></span>
        <span>Epic: <b>${odds.epicPercent}%</b></span>
      </div>
      <div class="odds-pill legendary-pill" title="Legendary tier">
        <span class="odds-dot" style="background:#f59e0b;"></span>
        <span>Legend: <b>${odds.legendaryPercent}%</b></span>
      </div>
      ${
        odds.jackpotChancePercent > 0
          ? `<div class="odds-pill jackpot-pill" title="Jackpot Multi-Drop chance">
              <span class="odds-dot" style="background:#ec4899;"></span>
              <span>Jackpot: <b>${odds.jackpotChancePercent}%</b></span>
            </div>`
          : ''
      }
    `;
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
      const winRateEl = modal.querySelector('#plinko-win-rate');
      if (winRateEl) winRateEl.innerHTML = `Win Chance: <b>${odds.winChancePercent}%</b>`;

      const breakdownEl = modal.querySelector('#plinko-odds-breakdown');
      if (breakdownEl) breakdownEl.innerHTML = this.renderOddsBreakdown(odds);

      if (dropBtn) {
        dropBtn.innerHTML = `<span class="svg-inline">${SVG_ICONS.sparkle}</span><span>Drop Ball (⭐ ${this.wager})</span>`;
        dropBtn.disabled = this.isDropping || (this.state.adoptionTokens || 0) < this.wager;
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

    const tierMeta: Record<PlinkoTier, { label: string; color: string; bgHex: string }> = {
      miss: { label: 'Miss', color: '#64748b', bgHex: '#1e293b' },
      common: { label: 'Common', color: '#94a3b8', bgHex: '#334155' },
      uncommon: { label: 'Uncommon', color: '#10b981', bgHex: '#064e3b' },
      rare: { label: 'Rare', color: '#3b82f6', bgHex: '#1e3a8a' },
      epic: { label: 'Epic', color: '#8b5cf6', bgHex: '#4c1d95' },
      legendary: { label: 'Legend', color: '#f59e0b', bgHex: '#78350f' },
    };

    let tiers: PlinkoTier[];
    if (wager <= 1) {
      // 1 Star: 66% Miss (6 slots), 33% Common (3 slots)
      tiers = ['miss', 'miss', 'common', 'miss', 'common', 'miss', 'common', 'miss', 'miss'];
    } else if (wager <= 2) {
      // 2 Stars: ~44% Miss (4 slots), 44% Common (4 slots), 11% Uncommon (1 slot)
      tiers = ['miss', 'miss', 'common', 'uncommon', 'common', 'common', 'common', 'miss', 'miss'];
    } else if (wager <= 4) {
      // 3-4 Stars: ~33% Miss (3 slots), 44% Common (4 slots), 22% Uncommon (2 slots)
      tiers = ['miss', 'common', 'uncommon', 'common', 'uncommon', 'common', 'common', 'miss', 'miss'];
    } else if (wager <= 9) {
      // 5-9 Stars: ~11% Miss (1 slot), 44% Common, 33% Uncommon, 11% Rare
      tiers = ['miss', 'common', 'uncommon', 'rare', 'uncommon', 'common', 'uncommon', 'common', 'common'];
    } else if (wager <= 24) {
      // 10-24 Stars: 0% Miss (95-100% win), mostly Common + Uncommon + Rare + Epic
      tiers = ['common', 'uncommon', 'rare', 'common', 'epic', 'common', 'rare', 'uncommon', 'common'];
    } else {
      // 25+ Stars: High roller jackpot board
      tiers = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
    }

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
      });
    }
  }

  private triggerDrop(): void {
    if (this.isDropping) return;
    if ((this.state.adoptionTokens || 0) < this.wager) {
      EventBus.emit('toast', { message: '⭐ Not enough Stars! Breed cats or complete goals to earn more.' });
      return;
    }

    // Deduct Stars
    this.state.adoptionTokens -= this.wager;
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
      vy: 1.5,
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
    const gravity = 0.28;
    const friction = 0.985;
    const restitution = 0.58;

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
      b.vx = Math.abs(b.vx) * restitution + 0.5;
    } else if (b.x + b.r > this.width - 12) {
      b.x = this.width - 12 - b.r;
      b.vx = -Math.abs(b.vx) * restitution - 0.5;
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
        b.vx = (b.vx - 2 * dot * nx) * restitution + (Math.random() - 0.5) * 0.8;
        b.vy = (b.vy - 2 * dot * ny) * restitution + (Math.random() - 0.5) * 0.4;

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
        const catsWon = this.plinkoSystem.generateCatsForTier(landedSlot.tier, catsCount);
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
      .map((c) => `
        <div class="plinko-cat-reward-card">
          <div class="reward-cat-title"><b>${c.name}</b> (${cap(c.stage)})</div>
          <div class="reward-cat-trait">✨ Personality: ${cap(c.majorTrait)} & ${cap(c.minorTrait)}</div>
          <div class="reward-cat-favorite">🐟 Favorite: ${c.favoriteFood}</div>
        </div>
      `)
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
      case 'legendary': return '#f59e0b';
      case 'epic': return '#8b5cf6';
      case 'rare': return '#3b82f6';
      case 'uncommon': return '#10b981';
      case 'common': return '#94a3b8';
      default: return '#64748b';
    }
  }

  private renderCanvas(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // 1. Board background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, this.height);
    bgGrad.addColorStop(0, '#1e1b4b');
    bgGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, this.width, this.height);

    // 2. Guide Rails (borders)
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, this.width - 12, this.height - 12);

    // 3. Pegs
    for (const peg of this.pegs) {
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2);
      ctx.fillStyle = peg.flash > 0 ? '#ffedd5' : '#cbd5e1';
      ctx.shadowColor = peg.flash > 0 ? '#f59e0b' : 'transparent';
      ctx.shadowBlur = peg.flash > 0 ? 12 : 0;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 4. Bottom Slots
    const slotY = this.height - 35;
    const slotH = 28;

    for (const slot of this.slots) {
      ctx.fillStyle = slot.bgHex;
      ctx.fillRect(slot.xStart + 2, slotY, (slot.xEnd - slot.xStart) - 4, slotH);

      ctx.strokeStyle = slot.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(slot.xStart + 2, slotY, (slot.xEnd - slot.xStart) - 4, slotH);

      // Label
      ctx.fillStyle = slot.color;
      ctx.font = 'bold 9px "Nunito", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(slot.label, (slot.xStart + slot.xEnd) / 2, slotY + slotH / 2);
    }

    // 5. Particles
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 6. Ball & Trail
    if (this.ball && this.ball.active) {
      const b = this.ball;

      // Draw Trail
      for (let t = 0; t < b.trail.length; t++) {
        const pt = b.trail[t];
        const alpha = (1 - t / b.trail.length) * 0.4;
        ctx.fillStyle = `rgba(251, 191, 36, ${alpha})`;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, b.r * (1 - t / b.trail.length * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }

      // Ball body
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = '#f59e0b';
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

function cap(s?: string): string {
  if (!s || typeof s !== 'string') return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
