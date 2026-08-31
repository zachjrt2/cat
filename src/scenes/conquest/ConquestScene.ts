// ---------------------------------------------------------------------------
// Cat Conquest — Cozy Sanctuary 10-Lane Horde Battle Scene
// Matches the visual aesthetics and pixel-art cat rendering of Cozy Cat Sanctuary.
// Displays 10 combat lanes with all reserves standing in ranks behind the front line.
// ---------------------------------------------------------------------------

import '../../ui/conquest.css';
import type { Cat, ConquestState, CatMutationType, LifeStage } from '../../data/types';
import type { ConquestCat, EnemyCat, Formation, BattleEvent } from '../../data/conquest/ConquestTypes';
import { CONQUEST_REGIONS, FORMATIONS, generateEnemyBatch } from '../../data/conquest/ConquestData';
import { deriveConquestRoster } from '../../data/conquest/StatDeriver';
import { BattleEngine, createBattleState } from './BattleEngine';
import { EventBus } from '../../ui/EventBus';
import { SVG_ICONS } from '../../ui/icons';
import { CAT_SKINS, CAT_MARKINGS } from '../../data/catAssets';
import { sound } from '../../systems/SoundManager';


type View = 'map' | 'formation' | 'battle' | 'results';

const ROUND_INTERVAL_MS = 230;
const NUM_LANES = 10;


// Per-sprite tracking entry
interface SpriteInfo {
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  targetY: number;   // % from top
  currentY: number;
  targetX: number;   // % from left
  side: 'player' | 'enemy';
  rank: number;      // 0 = front line (active), 1+ = reserve rows
  lane: number;      // 0..9
  isMoving: boolean;
  stopAnim: () => void;
}

export class ConquestScene {
  private root: HTMLElement;
  private overlay!: HTMLElement;
  private cats: Cat[];
  private conquestState: ConquestState;
  private love: number;

  // Image cache for pixel art sprite sheets
  private static imageCache = new Map<string, HTMLImageElement>();

  // Current session state
  private selectedRegionIndex = 0;
  private selectedFormation: Formation = 'balanced';
  private currentView: View = 'map';

  // Battle session
  private engine: BattleEngine | null = null;
  private battleTimer: ReturnType<typeof setInterval> | null = null;
  private battleRegionIndex = 0;

  // Animated sprite tracking
  private spriteMap = new Map<string, SpriteInfo>();
  private spritesMarchedIn = new Set<string>();

  constructor(root: HTMLElement, cats: Cat[], conquestState: ConquestState, love: number) {
    this.root = root;
    this.cats = cats;
    this.conquestState = conquestState;
    this.love = love;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  mount(): void {
    sound.startConquestMusic();
    this.overlay = document.createElement('div');
    this.overlay.id = 'conquest-overlay';
    this.root.appendChild(this.overlay);
    this.renderShell();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.overlay.classList.add('open'));
    });
    this.showView('map');
  }

  unmount(): void {
    this.stopBattle();
    sound.stopConquestMusic();
    this.overlay.classList.remove('open');
    setTimeout(() => this.overlay.remove(), 400);
  }


  // ── Shell (Header + View Containers) ──────────────────────────────────────

  private renderShell(): void {
    this.overlay.innerHTML = `
      <div class="cq-header">
        <button class="cq-back-btn" id="cq-back-btn">
          ← Back
        </button>
        <div class="cq-title" id="cq-title">
          <span class="svg-inline" style="display:inline-flex;align-items:center;">${SVG_ICONS.conquest}</span> Cat Conquest
        </div>
        <div class="cq-love-display" id="cq-love-display">
          <span class="svg-inline">${SVG_ICONS.heart}</span>
          <span>${this.love.toLocaleString()}</span>
        </div>
      </div>

      <div class="cq-view" id="cq-view-map">
        <div class="cq-map-container" id="cq-map-container"></div>
      </div>

      <div class="cq-view hidden" id="cq-view-formation">
        <div class="cq-formation-view" id="cq-formation-inner"></div>
      </div>

      <div class="cq-view hidden" id="cq-view-battle">
        <div class="cq-battle-view" id="cq-battle-inner">
          <div class="cq-battle-arena" id="cq-battle-arena">
            <!-- Wooden Fence Boundaries -->
            <div class="cq-ground-line cq-ground-enemy"></div>
            <div class="cq-ground-line cq-ground-player"></div>
            <!-- Cobblestone Clash Center Line -->
            <div class="cq-clash-divider">
              <span class="cq-clash-text"><span class="svg-inline" style="display:inline-flex;">${SVG_ICONS.conquest}</span> CLASH <span class="svg-inline" style="display:inline-flex;">${SVG_ICONS.conquest}</span></span>
            </div>
            <!-- Zone Header Wooden Pills -->
            <div class="cq-zone-pill cq-zone-enemy" id="cq-enemy-wave-label">ENEMY HORDE</div>
            <div class="cq-zone-pill cq-zone-player" id="cq-player-wave-label">SANCTUARY ARMY</div>
            <!-- Center Clash Impact FX -->
            <div class="cq-clash-flash" id="cq-clash-flash"></div>
          </div>
          <div class="cq-battle-footer">

            <div class="cq-battle-info">
              <span class="cq-wave-info" id="cq-wave-info">Wave 1</span>
              <span class="cq-round-info" id="cq-round-info">Round 0</span>
              <span class="cq-reserves" id="cq-reserves"></span>
            </div>
            <div class="cq-battle-log" id="cq-battle-log">The battle begins…</div>
          </div>
        </div>
      </div>

      <div class="cq-view hidden" id="cq-view-results">
        <div class="cq-results-view" id="cq-results-inner"></div>
      </div>
    `;

    this.overlay.querySelector('#cq-back-btn')!.addEventListener('click', () => this.handleBack());
  }

  // ── View Management ───────────────────────────────────────────────────────

  private showView(view: View): void {
    this.currentView = view;
    const ids: Record<View, string> = {
      map: 'cq-view-map',
      formation: 'cq-view-formation',
      battle: 'cq-view-battle',
      results: 'cq-view-results',
    };
    const titles: Record<View, string> = {
      map: `<span class="svg-inline" style="display:inline-flex;align-items:center;">${SVG_ICONS.conquest}</span> Cat Conquest`,
      formation: `<span class="svg-inline" style="display:inline-flex;align-items:center;">${SVG_ICONS.conquest}</span> Choose Formation`,
      battle: `<span class="svg-inline" style="display:inline-flex;align-items:center;">${SVG_ICONS.conquest}</span> Horde Battle`,
      results: `<span class="svg-inline" style="display:inline-flex;align-items:center;">${SVG_ICONS.conquest}</span> Battle Summary`,
    };


    for (const [v, id] of Object.entries(ids)) {
      const el = this.overlay.querySelector(`#${id}`) as HTMLElement;
      if (el) el.classList.toggle('hidden', v !== view);
    }
    const titleEl = this.overlay.querySelector('#cq-title') as HTMLElement;
    if (titleEl) titleEl.innerHTML = titles[view];

    if (view === 'map') this.renderMap();
    if (view === 'formation') this.renderFormation();
    if (view === 'battle') this.startBattle();
    if (view === 'results') this.stopBattle();
  }

  private handleBack(): void {
    if (this.currentView === 'battle') {
      this.stopBattle();
      this.showView('map');
    } else if (this.currentView === 'formation') {
      this.showView('map');
    } else if (this.currentView === 'results') {
      this.showView('map');
    } else {
      this.depositRewardsAndClose();
    }
  }

  // ── Map View ──────────────────────────────────────────────────────────────

  private renderMap(): void {
    const container = this.overlay.querySelector('#cq-map-container') as HTMLElement;
    const cs = this.conquestState;
    const clearedCount = cs.clearedRegions.length;
    const isConqueror = clearedCount === CONQUEST_REGIONS.length;

    let html = `
      <div class="cq-map-stats">
        <div class="cq-map-stat-item">
          <div class="cq-map-stat-value">${clearedCount}/10</div>
          <div class="cq-map-stat-label">Claimed Regions</div>
        </div>
        <div class="cq-map-stat-item">
          <div class="cq-map-stat-value">${cs.totalBattlesWon}</div>
          <div class="cq-map-stat-label">Victories</div>
        </div>
        <div class="cq-map-stat-item">
          <div class="cq-map-stat-value">${cs.totalBattlesLost}</div>
          <div class="cq-map-stat-label">Defeats</div>
        </div>
      </div>
    `;

    if (isConqueror) {
      html += `<div class="cq-conqueror-banner">🏆 GRAND CONQUEROR — All 10 Regions Claimed! 🏆</div>`;
    }

    for (const region of CONQUEST_REGIONS) {
      const cleared = cs.clearedRegions.includes(region.index);
      const isAvailable = region.index === 0 || cs.clearedRegions.includes(region.index - 1) || cleared;
      const canAfford = this.love >= region.invasionCost;

      let statusClass = 'locked';
      let badge = 'Locked';
      if (cleared) { statusClass = 'cleared'; badge = 'Claimed'; }
      else if (isAvailable) { statusClass = 'available'; badge = `<span class="svg-inline" style="color:#ff758f;display:inline-flex;">${SVG_ICONS.conquest}</span>`; }

      const btnDisabled = !isAvailable || !canAfford;
      const btnLabel = cleared ? 'Re-invade Territory' : `Launch Invasion — ${region.invasionCost.toLocaleString()} 💗`;

      html += `
        <div class="cq-region-card ${statusClass}" data-region="${region.index}">
          <div class="cq-region-header">
            <div class="cq-region-info">
              <div class="cq-region-name">${region.name}</div>
              <div class="cq-region-flavor">${region.flavor}</div>
            </div>
            <div class="cq-region-badge">${badge}</div>
          </div>
          <div class="cq-region-footer">
            <span class="cq-region-cost"><span class="svg-inline">${SVG_ICONS.heart}</span> ${region.invasionCost.toLocaleString()}</span>
            <span class="cq-region-enemies">${region.isBoss ? 'Boss Battle' : `${region.enemyCount} Enemy Horde`}</span>
            <span class="cq-region-reward">+${region.loveReward.toLocaleString()} 💗 +${region.starReward} ⭐</span>
          </div>
          ${isAvailable ? `<button class="cq-launch-btn" ${btnDisabled ? 'disabled' : ''} data-launch="${region.index}">
            ${btnLabel}
          </button>` : ''}
        </div>
      `;
    }


    container.innerHTML = html;

    container.querySelectorAll('[data-launch]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt((e.currentTarget as HTMLElement).dataset.launch!, 10);
        this.selectedRegionIndex = idx;
        this.showView('formation');
      });
    });
  }

  // ── Formation View ────────────────────────────────────────────────────────

  private renderFormation(): void {
    const inner = this.overlay.querySelector('#cq-formation-inner') as HTMLElement;
    const region = CONQUEST_REGIONS[this.selectedRegionIndex];
    const roster = deriveConquestRoster(this.cats);

    const formationCards = FORMATIONS.map((f) => `
      <div class="cq-formation-card ${this.selectedFormation === f.id ? 'selected' : ''}" data-formation="${f.id}">
        <div class="cq-formation-emoji">${f.emoji}</div>
        <div class="cq-formation-label">${f.label}</div>
        <div class="cq-formation-desc">${f.description}</div>
      </div>
    `).join('');

    const adults = roster.filter((c) => c.stage === 'adult').length;
    const teens = roster.filter((c) => c.stage === 'teen').length;
    const kittens = roster.filter((c) => c.stage === 'kitten').length;

    const catPips = roster.slice(0, 40).map((c) => {
      const stageEmoji = c.stage === 'kitten' ? '🐾' : c.stage === 'teen' ? '🐈' : '🐱';
      const stageClass = `pip-${c.stage || 'adult'}`;
      return `
        <div class="cq-cat-pip ${c.isRare ? 'rare' : ''} ${stageClass}" title="${c.stage} · ${c.majorTrait}">
          ${stageEmoji}
        </div>
      `;
    }).join('');

    inner.innerHTML = `
      <div class="cq-formation-title">Choose Battle Formation</div>
      <div class="cq-formation-subtitle">Invading: ${region.name}</div>
      <div class="cq-formation-grid">${formationCards}</div>
      <div class="cq-army-preview">
        <div class="cq-army-preview-title">Your Full Army: ${roster.length} cat${roster.length !== 1 ? 's' : ''} (${adults} adults · ${teens} teens · ${kittens} kittens)</div>
        <div class="cq-army-preview-cats">${catPips}${roster.length === 0 ? '<span style="color:#7c6855;font-size:12px;">No cats in sanctuary!</span>' : ''}</div>
      </div>
      <button class="cq-fight-btn" id="cq-fight-btn" ${roster.length === 0 ? 'disabled' : ''} style="display:flex;align-items:center;justify-content:center;gap:8px;">
        <span class="svg-inline" style="display:inline-flex;">${SVG_ICONS.conquest}</span> MARCH HORDE TO BATTLE!
      </button>
    `;



    inner.querySelectorAll('[data-formation]').forEach((card) => {
      card.addEventListener('click', (e) => {
        this.selectedFormation = (e.currentTarget as HTMLElement).dataset.formation as Formation;
        inner.querySelectorAll('[data-formation]').forEach((c) => c.classList.remove('selected'));
        (e.currentTarget as HTMLElement).classList.add('selected');
      });
    });

    inner.querySelector('#cq-fight-btn')!.addEventListener('click', () => {
      this.showView('battle');
    });
  }

  // ── Battle ────────────────────────────────────────────────────────────────

  private startBattle(): void {
    const region = CONQUEST_REGIONS[this.selectedRegionIndex];
    this.battleRegionIndex = this.selectedRegionIndex;

    const formationDef = FORMATIONS.find((f) => f.id === this.selectedFormation) ?? FORMATIONS[0];
    const playerCats = deriveConquestRoster(this.cats, formationDef);
    const allEnemies = generateEnemyBatch(region, region.enemyCount);

    const state = createBattleState(playerCats, allEnemies, this.selectedFormation);
    this.engine = new BattleEngine(state, formationDef.critMult);
    this.conquestState.totalInvasionsLaunched++;

    // Clear and clean up old sprites & animations
    this.spriteMap.forEach((info) => info.stopAnim());
    this.spriteMap.clear();
    this.spritesMarchedIn.clear();

    const arena = this.overlay.querySelector('#cq-battle-arena') as HTMLElement;
    arena.querySelectorAll('.cq-sprite').forEach((s) => s.remove());

    // Spawn ALL cats in army organized by 10 independent vertical lane queues
    this.spawnArmyWithReserves(state.playerLanes, 'player');
    this.spawnArmyWithReserves(state.enemyLanes, 'enemy');

    this.updateInfoBar();

    // March cats forward in ranks, then start auto-battle rounds
    this.marchCatsIn(() => {
      this.battleTimer = setInterval(() => {
        if (!this.engine) return;
        const events = this.engine.tick();
        this.processBattleEvents(events);
        this.updateSpriteStates();
        this.updateInfoBar();

        if (this.engine.state.outcome !== 'ongoing') {
          this.stopBattle();
          setTimeout(() => this.showResults(
            this.engine!.state.outcome as 'player_win' | 'player_lose',
            this.engine!.state.playerKoCount,
          ), 1000);
        }
      }, ROUND_INTERVAL_MS);
    });
  }

  private stopBattle(): void {
    if (this.battleTimer !== null) {
      clearInterval(this.battleTimer);
      this.battleTimer = null;
    }
  }

  // ── Pixel-Art Cat Canvas Sprite System (10 Lanes + Ranks) ─────────────────

  private static loadImage(src: string): Promise<HTMLImageElement> {
    const cached = ConquestScene.imageCache.get(src);
    if (cached && cached.complete && cached.naturalWidth > 0) {
      return Promise.resolve(cached);
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        ConquestScene.imageCache.set(src, img);
        resolve(img);
      };
      img.onerror = () => resolve(img);
    });
  }

  private getRankAndLaneY(rank: number, side: 'player' | 'enemy'): { entryY: number; fightY: number } {
    if (side === 'player') {
      // Front line at ~55%, Rank 1 at ~66%, Rank 2 at ~77%, Rank 3 at ~88%
      const fightY = 55 + rank * 11;
      const entryY = 115 + rank * 12;
      return { entryY, fightY };
    } else {
      // Front line at ~35%, Rank 1 at ~24%, Rank 2 at ~13%, Rank 3 at ~2%
      const fightY = 35 - rank * 11;
      const entryY = -25 - rank * 12;
      return { entryY, fightY };
    }
  }

  private getLaneX(lane: number, rank: number, totalInRank: number): number {
    if (totalInRank === 1) return 50;
    // Spread 10 lanes evenly across 5% to 95%
    const basePct = 5 + (lane / (NUM_LANES - 1)) * 90;
    // Slight horizontal stagger for reserve rows for military horde look
    const stagger = rank > 0 && rank % 2 === 1 ? (lane < NUM_LANES - 1 ? 1.5 : -1.5) : 0;
    return Math.max(4, Math.min(96, basePct + stagger));
  }

  private spawnArmyWithReserves(lanes: (ConquestCat | EnemyCat)[][], side: 'player' | 'enemy'): void {
    const arena = this.overlay.querySelector('#cq-battle-arena') as HTMLElement;
    const isFriendly = side === 'player';

    lanes.forEach((laneQueue, laneIdx) => {
      laneQueue.forEach((cat, rank) => {
        const id = isFriendly ? (cat as ConquestCat).sourceId : (cat as EnemyCat).id;
        if (this.spriteMap.has(id)) return;

        const xPct = this.getLaneX(laneIdx, rank, NUM_LANES);
        const { entryY, fightY } = this.getRankAndLaneY(rank, side);

        const el = document.createElement('div');
        el.className = `cq-sprite cq-sprite-${side} ${rank === 0 ? 'front-line' : 'reserve-rank'}`;
        el.id = `cq-sprite-${id}`;
        el.dataset.unitId = id;
        const zIdx = Math.max(1, 20 - rank);
        el.style.cssText = `left:${xPct}%;top:${entryY}%;transform:translateX(-50%);z-index:${zIdx};`;

        const hp = cat.hp;
        const maxHp = cat.maxHp;
        const pct = Math.round((hp / maxHp) * 100);
        const stage = (cat as ConquestCat).stage || 'adult';
        const stageClass = `sz-${stage}`;
        const rareClass = (cat as ConquestCat).isRare ? 'rare-aura' : '';
        const hpColor = isFriendly ? '#68ad6c' : '#ff758f';
        const friendlyCat = cat as ConquestCat;
        const canSpecial = isFriendly && !friendlyCat.specialUsed && hp > 0 && rank === 0;

        const canvas = document.createElement('canvas');
        canvas.className = `cq-cat-canvas ${stageClass}`;
        canvas.width = 96;
        canvas.height = 96;

        el.innerHTML = `
          <div class="cq-cat-canvas-wrap ${rareClass}">
            ${canSpecial ? `<div class="cq-sprite-special-badge">✨</div>` : ''}
            <div class="cq-synergy-badge" id="cq-syn-${id}"></div>
          </div>
          <div class="cq-sprite-hp-wrap" style="${rank > 0 ? 'opacity:0.6;' : ''}">
            <div class="cq-sprite-hp-bar" style="width:${pct}%;background:${hpColor};"></div>
          </div>
        `;



        el.querySelector('.cq-cat-canvas-wrap')!.appendChild(canvas);

        if (isFriendly) {
          el.addEventListener('click', () => {
            if (!this.engine || friendlyCat.specialUsed || friendlyCat.hp <= 0) return;
            const events = this.engine.triggerSpecial(id);
            this.processBattleEvents(events);
            el.querySelector('.cq-sprite-special-badge')?.remove();
          });
        }

        arena.appendChild(el);

        const spriteObj: SpriteInfo = {
          el,
          canvas,
          targetY: fightY,
          currentY: entryY,
          targetX: xPct,
          side,
          rank,
          lane: laneIdx,
          isMoving: true,
          stopAnim: () => {},
        };

        const stopAnim = this.startCatCanvasAnimation(
          canvas,
          cat.color,
          cat.pattern,
          (cat as ConquestCat).mutation,
          (cat as ConquestCat).stage,
          side,
          spriteObj,
        );
        spriteObj.stopAnim = stopAnim;

        this.spriteMap.set(id, spriteObj);
      });
    });
  }

  private startCatCanvasAnimation(
    canvas: HTMLCanvasElement,
    colorId: string,
    patternId: string | undefined,
    mutation: CatMutationType | null | undefined,
    stage: LifeStage | undefined,
    side: 'player' | 'enemy',
    spriteInfo: { isMoving: boolean },
  ): () => void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};
    ctx.imageSmoothingEnabled = false;

    const skinDef = CAT_SKINS.find((s) => s.id === colorId) || CAT_SKINS[0];
    const skinSrc = skinDef?.file ? `./assets/cats/${skinDef.file}` : './assets/cats/orange_0.png';

    const markingDef = CAT_MARKINGS.find((m) => m.id === patternId);
    const markingSrc = markingDef?.file ? `./assets/cats/Markings/${markingDef.file}` : null;

    let isRunning = true;
    let animFrameId: number;

    let baseImg: HTMLImageElement | null = null;
    let markingImg: HTMLImageElement | null = null;

    ConquestScene.loadImage(skinSrc).then((img) => { baseImg = img; });
    if (markingSrc) {
      ConquestScene.loadImage(markingSrc).then((img) => { markingImg = img; });
    }

    const FRAME_SIZE = 32;
    // Player cats face North/Up towards enemy (dir 4 -> row 9)
    // Enemy cats face South/Down towards player (dir 0 -> row 1)
    const walkRow = side === 'player' ? 9 : 1;
    const sitRow = side === 'player' ? 9 : 1;

    let frameIndex = Math.floor(Math.random() * 4);
    let lastFrameTime = performance.now();

    const render = (now: number) => {
      if (!isRunning) return;

      const isMoving = spriteInfo.isMoving;
      const frameDuration = isMoving ? 50 : 130;

      if (now - lastFrameTime >= frameDuration) {
        frameIndex = (frameIndex + 1) % 4;
        lastFrameTime = now;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (baseImg && baseImg.complete && baseImg.naturalWidth > 0) {
        let srcX = 0;
        let srcY = 0;

        if (isMoving) {
          srcX = (12 + frameIndex) * FRAME_SIZE;
          srcY = walkRow * FRAME_SIZE;
        } else {
          srcX = (frameIndex % 2) * FRAME_SIZE;
          srcY = (sitRow + 1) * FRAME_SIZE;
        }

        let scale = stage === 'kitten' ? 0.72 : stage === 'teen' ? 0.86 : 1.0;
        if (mutation === 'tiny') scale *= 0.65;
        if (mutation === 'giant') scale *= 1.30;

        const drawSize = Math.round(canvas.width * 0.90 * scale);
        const drawX = Math.round((canvas.width - drawSize) / 2);
        const drawY = Math.round((canvas.height - drawSize) / 2 + (stage === 'kitten' ? 4 : 0));

        ctx.save();

        if (mutation === 'inverted') {
          ctx.filter = 'invert(0.92) hue-rotate(180deg) saturate(1.8)';
        } else if (mutation === 'frosted') {
          ctx.filter = 'hue-rotate(180deg) saturate(2.0) brightness(1.15)';
        } else if (mutation === 'flaming') {
          ctx.filter = 'sepia(0.65) saturate(3.5) hue-rotate(-30deg) brightness(1.1)';
        } else if (mutation === 'chromatic') {
          ctx.filter = `hue-rotate(${(now / 12) % 360}deg) saturate(2.4)`;
        } else if (mutation === 'sparkly') {
          ctx.filter = 'hue-rotate(280deg) saturate(2.2) brightness(1.25)';
        } else if (mutation === 'gilded') {
          ctx.filter = 'sepia(0.9) saturate(4.0) hue-rotate(10deg) brightness(1.15)';
        } else if (mutation === 'stinky') {
          ctx.filter = 'sepia(0.55) hue-rotate(85deg) saturate(2.5) brightness(0.95)';
        }

        ctx.drawImage(baseImg, srcX, srcY, FRAME_SIZE, FRAME_SIZE, drawX, drawY, drawSize, drawSize);

        if (markingImg && markingImg.complete && markingImg.naturalWidth > 0) {
          ctx.drawImage(markingImg, srcX, srcY, FRAME_SIZE, FRAME_SIZE, drawX, drawY, drawSize, drawSize);
        }

        ctx.restore();

        if (mutation === 'angelic') {
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const haloBob = Math.sin((now % 1200) / 1200 * Math.PI * 2) * 1.5;
          ctx.ellipse(canvas.width / 2, drawY - 2 + haloBob, 7, 2.5, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      animFrameId = requestAnimationFrame(render);
    };

    animFrameId = requestAnimationFrame(render);

    return () => {
      isRunning = false;
      cancelAnimationFrame(animFrameId);
    };
  }

  /** Animate full horde marching in rank-by-rank */
  private marchCatsIn(onComplete: () => void): void {
    let maxDelay = 0;
    this.spriteMap.forEach((info, id) => {
      if (this.spritesMarchedIn.has(id)) return;
      // Stagger by rank and lane
      const delay = info.rank * 60 + Math.random() * 60;
      maxDelay = Math.max(maxDelay, delay);
      setTimeout(() => {
        info.isMoving = true;
        info.el.style.transition = 'top 0.35s cubic-bezier(0.22, 0.68, 0, 1.05)';
        info.el.style.top = `${info.targetY}%`;
        info.currentY = info.targetY;
        this.spritesMarchedIn.add(id);

        setTimeout(() => {
          info.isMoving = false;
          info.el.style.transition = '';
          info.el.classList.add('cq-sprite-idle');
        }, 380);
      }, delay);
    });

    setTimeout(onComplete, maxDelay + 400);
  }

  /** Update HP bars and step forward reserves when front line cats fall */
  private updateSpriteStates(): void {
    if (!this.engine) return;
    const { activeFriendly, activeEnemy, playerLanes } = this.engine.state;

    // Update active combatant HP and status badges
    activeFriendly.forEach((cat) => {
      const info = this.spriteMap.get(cat.sourceId);
      if (!info) return;
      this.updateSpriteHp(info.el, cat.hp, cat.maxHp, 'player');
      this.updateStatusBadges(info.el, cat);
      if (cat.hp <= 0 && !info.el.classList.contains('poof')) this.animateKo(cat.sourceId);
    });

    activeEnemy.forEach((enemy) => {
      const info = this.spriteMap.get(enemy.id);
      if (!info) return;
      this.updateSpriteHp(info.el, enemy.hp, enemy.maxHp, 'enemy');
      this.updateStatusBadges(info.el, enemy);
      if (enemy.hp <= 0 && !info.el.classList.contains('poof')) this.animateKo(enemy.id);
    });

    // Update reserve status indicators
    playerLanes.forEach((lane) => {
      lane.forEach((cat, r) => {
        if (r > 0) {
          const info = this.spriteMap.get(cat.sourceId);
          if (info) {
            this.updateSpriteHp(info.el, cat.hp, cat.maxHp, 'player');
            this.updateStatusBadges(info.el, cat);
          }
        }
      });
    });


    // Update reserve cats positions if active wave changes
    this.updateReserveAdvancement();
  }

  private updateStatusBadges(el: HTMLElement, cat: ConquestCat | EnemyCat): void {
    const badge = el.querySelector('.cq-synergy-badge') as HTMLElement | null;
    if (!badge) return;

    let text = '';
    if ('hasBestFriendAhead' in cat && cat.hasBestFriendAhead) text += '💖';
    if ('hasCoatHarmony' in cat && cat.hasCoatHarmony) text += '✨';
    if ('hasProtectorAhead' in cat && cat.hasProtectorAhead) text += '🛡️';
    if ('avengerRounds' in cat && cat.avengerRounds > 0) text += '🔥';

    badge.textContent = text;
    badge.style.display = text ? 'flex' : 'none';

    // Status effect CSS classes
    if (cat.burnRounds > 0) el.classList.add('cq-burning');
    else el.classList.remove('cq-burning');

    if (cat.chillRounds > 0) el.classList.add('cq-chilled');
    else el.classList.remove('cq-chilled');
  }

  private updateReserveAdvancement(): void {
    if (!this.engine) return;
    const { playerLanes, enemyLanes } = this.engine.state;

    // 1. Advance Player Lane Queues (pure vertical queue per lane)
    playerLanes.forEach((laneQueue, laneIdx) => {
      laneQueue.forEach((cat, rank) => {
        const info = this.spriteMap.get(cat.sourceId);
        if (info && cat.hp > 0) {
          const targetY = 55 + rank * 11;
          const targetX = this.getLaneX(laneIdx, rank, NUM_LANES);
          info.rank = rank;
          info.lane = laneIdx;
          info.targetY = targetY;
          info.targetX = targetX;
          info.el.style.transition = 'top 0.16s cubic-bezier(0.22, 0.68, 0, 1.05), left 0.16s cubic-bezier(0.22, 0.68, 0, 1.05)';
          info.el.style.top = `${targetY}%`;
          info.el.style.left = `${targetX}%`;
          info.el.style.zIndex = `${Math.max(1, 20 - rank)}`;

          if (rank === 0) {
            info.el.classList.remove('reserve-rank');
            info.el.classList.add('front-line');
            const hpWrap = info.el.querySelector('.cq-sprite-hp-wrap') as HTMLElement | null;
            if (hpWrap) hpWrap.style.opacity = '1';
          }
        }
      });
    });

    // 2. Advance Enemy Lane Queues (pure vertical queue per lane)
    enemyLanes.forEach((laneQueue, laneIdx) => {
      laneQueue.forEach((enemy, rank) => {
        const info = this.spriteMap.get(enemy.id);
        if (info && enemy.hp > 0) {
          const targetY = 35 - rank * 11;
          const targetX = this.getLaneX(laneIdx, rank, NUM_LANES);
          info.rank = rank;
          info.lane = laneIdx;
          info.targetY = targetY;
          info.targetX = targetX;
          info.el.style.transition = 'top 0.16s cubic-bezier(0.22, 0.68, 0, 1.05), left 0.16s cubic-bezier(0.22, 0.68, 0, 1.05)';
          info.el.style.top = `${targetY}%`;
          info.el.style.left = `${targetX}%`;
          info.el.style.zIndex = `${Math.max(1, 20 - rank)}`;

          if (rank === 0) {
            info.el.classList.remove('reserve-rank');
            info.el.classList.add('front-line');
            const hpWrap = info.el.querySelector('.cq-sprite-hp-wrap') as HTMLElement | null;
            if (hpWrap) hpWrap.style.opacity = '1';
          }
        }
      });
    });
  }

  private updateSpriteHp(el: HTMLElement, hp: number, maxHp: number, side: 'player' | 'enemy'): void {
    const bar = el.querySelector('.cq-sprite-hp-bar') as HTMLElement | null;
    if (!bar) return;
    const pct = Math.max(0, Math.round((hp / maxHp) * 100));
    bar.style.width = `${pct}%`;
    if (pct < 25) bar.style.background = '#dc2626';
    else if (pct < 50) bar.style.background = '#ffb703';
    else bar.style.background = side === 'player' ? '#68ad6c' : '#ff758f';
  }


  /** Lunge attacker forward into enemy ranks then spring back */
  private animateAttack(id: string, side: 'player' | 'enemy'): void {
    const info = this.spriteMap.get(id);
    if (!info || info.el.classList.contains('poof')) return;
    info.el.classList.remove('cq-sprite-idle');
    const lunge = side === 'player' ? -10 : 10;
    info.el.style.transition = 'top 0.04s ease-out';
    info.el.style.top = `${info.targetY + lunge}%`;
    setTimeout(() => {
      info.el.style.transition = 'top 0.06s ease-in';
      info.el.style.top = `${info.targetY}%`;
      setTimeout(() => info.el.classList.add('cq-sprite-idle'), 70);
    }, 45);
  }

  private animateHit(id: string): void {
    const info = this.spriteMap.get(id);
    if (!info) return;
    info.el.classList.add('cq-hit');
    setTimeout(() => info.el.classList.remove('cq-hit'), 100);
  }

  private animateKo(id: string): void {
    const info = this.spriteMap.get(id);
    if (!info || info.el.classList.contains('poof')) return;
    info.el.classList.add('poof');
    info.el.classList.remove('cq-sprite-idle');

    sound.playPop();

    const poofEl = document.createElement('div');
    poofEl.className = 'cq-poof-fx';
    poofEl.textContent = '💨';
    info.el.appendChild(poofEl);

    // Stop sprite animation and completely remove the defeated cat so no ghosts remain
    info.stopAnim();
    setTimeout(() => {
      if (info.el && info.el.parentNode) {
        info.el.remove();
      }
      this.spriteMap.delete(id);
    }, 140);
  }


  private refreshWaveSprites(): void {
    this.updateReserveAdvancement();
    const state = this.engine?.state;
    if (!state) return;
    const eLbl = this.overlay.querySelector('#cq-enemy-wave-label') as HTMLElement;
    const pLbl = this.overlay.querySelector('#cq-player-wave-label') as HTMLElement;
    if (eLbl) eLbl.textContent = `🚩 ENEMY HORDE — WAVE ${state.enemyWaveNumber}`;
    if (pLbl) pLbl.textContent = `🛡️ SANCTUARY ARMY — WAVE ${state.playerWaveNumber}`;
  }

  // ── Battle Event Processing ───────────────────────────────────────────────

  private processBattleEvents(events: BattleEvent[]): void {
    const log = this.overlay.querySelector('#cq-battle-log') as HTMLElement;
    for (const ev of events) {
      switch (ev.type) {
        case 'attack': {
          this.animateAttack(ev.attackerId, ev.side);
          setTimeout(() => this.animateHit(ev.targetId), 40);
          this.triggerClashFlash();
          if (ev.isCrit) {
            log.className = 'cq-battle-log crit';
            log.textContent = `💥 Critical Hit! ${ev.damage} damage dealt!`;
          } else {
            log.className = 'cq-battle-log';
            log.textContent = `${ev.side === 'player' ? '🐱' : '😾'} ${ev.damage} damage!`;
          }
          break;
        }
        case 'cleave': {
          log.className = 'cq-battle-log cleave';
          log.textContent = `🦣 Giant Cleave hit ${ev.targets.length} nearby enemies!`;
          ev.targets.forEach((t) => this.animateHit(t.id));

          const arena = this.overlay.querySelector('#cq-battle-arena');
          if (arena) {
            arena.classList.add('quake');
            setTimeout(() => arena.classList.remove('quake'), 200);
          }
          break;
        }
        case 'counter': {
          log.className = 'cq-battle-log counter';
          log.textContent = `🐾 Tiny Cat Dodge Counter-Attack (${ev.damage} dmg)!`;
          this.animateAttack(ev.attackerId, ev.side);
          this.animateHit(ev.targetId);
          break;
        }
        case 'burn': {
          log.className = 'cq-battle-log burn';
          log.textContent = `🔥 Burn damage: ${ev.damage} HP!`;
          this.animateHit(ev.catId);
          break;
        }
        case 'heal': {
          log.className = 'cq-battle-log heal';
          log.textContent = ev.description;
          const info = this.spriteMap.get(ev.catId);
          if (info) {
            info.el.classList.add('cq-special-glow');
            setTimeout(() => info.el.classList.remove('cq-special-glow'), 300);
          }
          break;
        }
        case 'shield': {
          log.className = 'cq-battle-log shield';
          log.textContent = ev.description;
          break;
        }
        case 'avenger': {
          log.className = 'cq-battle-log avenger';
          log.textContent = ev.description;
          break;
        }
        case 'ko': {
          this.animateKo(ev.catId);
          log.className = 'cq-battle-log ko';
          log.textContent = ev.side === 'enemy' ? '💀 Enemy cat defeated!' : '😿 Sanctuary cat resting!';
          break;
        }
        case 'special': {
          log.className = 'cq-battle-log special';
          log.textContent = `✨ ${ev.description}`;
          const info = this.spriteMap.get(ev.catId);
          if (info) {
            info.el.classList.add('cq-special-glow');
            setTimeout(() => info.el.classList.remove('cq-special-glow'), 400);
          }
          break;
        }
        case 'buff': {
          log.className = 'cq-battle-log buff';
          log.textContent = `✨ ${ev.description}`;
          break;
        }
        case 'wave_start': {
          this.refreshWaveSprites();
          break;
        }
      }
    }
  }

  private triggerClashFlash(): void {

    const flash = this.overlay.querySelector('#cq-clash-flash') as HTMLElement;
    if (!flash) return;
    flash.classList.remove('flash');
    void flash.offsetWidth;
    flash.classList.add('flash');
  }


  private updateInfoBar(): void {
    if (!this.engine) return;
    const state = this.engine.state;
    const roundInfo = this.overlay.querySelector('#cq-round-info') as HTMLElement;
    const waveInfo = this.overlay.querySelector('#cq-wave-info') as HTMLElement;
    const reserves = this.overlay.querySelector('#cq-reserves') as HTMLElement;
    if (roundInfo) roundInfo.textContent = `Round ${state.round}`;
    if (waveInfo) waveInfo.textContent = `Wave ${state.playerWaveNumber}`;
    const pRes = state.playerLanes.reduce((sum, lane) => sum + Math.max(0, lane.length - 1), 0);
    const eRes = state.enemyLanes.reduce((sum, lane) => sum + Math.max(0, lane.length - 1), 0);
    if (reserves) reserves.textContent = `Reserves: 🐱 ${pRes} | 😾 ${eRes}`;
  }


  // ── Results (Parchment Summary) ───────────────────────────────────────────

  private showResults(outcome: 'player_win' | 'player_lose', playerKoCount: number): void {
    const region = CONQUEST_REGIONS[this.battleRegionIndex];
    const isWin = outcome === 'player_win';

    if (isWin) {
      this.conquestState.totalBattlesWon++;
      if (!this.conquestState.clearedRegions.includes(region.index)) {
        this.conquestState.clearedRegions.push(region.index);
      }
      const isPerfect = playerKoCount === 0;
      const loveReward = isPerfect ? Math.round(region.loveReward * 1.5) : region.loveReward;
      this.conquestState.pendingLove += loveReward;
      this.conquestState.pendingStars += region.starReward;
    } else {
      this.conquestState.totalBattlesLost++;
    }

    EventBus.emit('conquest-save', { conquestState: { ...this.conquestState } });
    this.showView('results');
    this.renderResults(outcome, region, playerKoCount);
  }

  private renderResults(
    outcome: 'player_win' | 'player_lose',
    region: (typeof CONQUEST_REGIONS)[0],
    playerKoCount: number,
  ): void {
    const inner = this.overlay.querySelector('#cq-results-inner') as HTMLElement;
    const isWin = outcome === 'player_win';
    const isPerfect = isWin && playerKoCount === 0;
    const isConqueror = this.conquestState.clearedRegions.length === CONQUEST_REGIONS.length;
    const loveReward = isPerfect ? Math.round(region.loveReward * 1.5) : region.loveReward;

    let html = `
      <div class="cq-result-card">
        <div class="cq-result-emoji">${isWin ? '🏆' : '😿'}</div>
        <div class="cq-result-title ${isWin ? 'win' : 'lose'}">${isWin ? 'VICTORY!' : 'DEFEATED'}</div>
        <div class="cq-result-subtitle">
          ${isWin
            ? (isPerfect ? '⭐ Perfect Battle! No cats rested! ⭐' : `${playerKoCount} cat${playerKoCount !== 1 ? 's' : ''} rested during battle.`)
            : 'Your cats need a quick rest. Regroup and try again!'}
        </div>
    `;

    if (isWin) {
      html += `
        <div class="cq-result-rewards">
          <div class="cq-result-reward-row">
            <span class="cq-result-reward-label"><span class="svg-inline">${SVG_ICONS.heart}</span> Care Points Earned</span>
            <span class="cq-result-reward-value">+${loveReward.toLocaleString()} 💗</span>
          </div>
          <div class="cq-result-reward-row">
            <span class="cq-result-reward-label"><span class="svg-inline">${SVG_ICONS.star}</span> Stars Earned</span>
            <span class="cq-result-reward-value">+${region.starReward} ⭐</span>
          </div>
          ${isPerfect ? `<div class="cq-result-reward-row">
            <span class="cq-result-reward-label">⭐ Perfect Horde Bonus</span>
            <span class="cq-result-reward-value" style="color:#d97706;">+50% 💗</span>
          </div>` : ''}
        </div>
      `;
    }

    if (isConqueror) {
      html += `<div class="cq-conqueror-banner">🏆 GRAND CONQUEROR — All 10 Regions Claimed! 🏆</div>`;
    }

    html += `
        <button class="cq-result-btn" id="cq-result-continue-btn">Cozy On!</button>
      </div>
    `;

    inner.innerHTML = html;
    inner.querySelector('#cq-result-continue-btn')!.addEventListener('click', () => {
      this.showView('map');
    });
  }

  // ── Reward Deposit ────────────────────────────────────────────────────────

  private depositRewardsAndClose(): void {
    const pending = {
      love: this.conquestState.pendingLove,
      stars: this.conquestState.pendingStars,
    };
    if (pending.love > 0 || pending.stars > 0) {
      this.conquestState.pendingLove = 0;
      this.conquestState.pendingStars = 0;
      EventBus.emit('conquest-reward', pending);
    }
    EventBus.emit('conquest-save', { conquestState: { ...this.conquestState } });
    this.unmount();
  }
}
