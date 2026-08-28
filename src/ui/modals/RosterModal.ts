import type { Cat, CatArea, SanctuaryArea } from '../../data/types';
import { AREA_INFO_MAP } from '../../data/constants';
import { CAT_SKINS, CAT_MARKINGS } from '../../data/catAssets';
import { sound } from '../../systems/SoundManager';
import { CatInfoModal } from './CatInfoModal';

const AREA_KEYS: CatArea[] = ['yard', 'shelter', 'sunroom', 'cafe'];

function escapeHtml(s?: string): string {
  if (!s || typeof s !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

export type StageFilter = 'all' | 'kitten' | 'teen' | 'adult';
export type AreaFilter = 'all' | CatArea;
export type SpecialFilter = 'all' | 'rare' | 'mutation';
export type NeedsFilter = 'all' | 'hungry' | 'dirty' | 'affection' | 'fun' | 'sleepy';
export type SortOption = 'name' | 'stage' | 'happiness' | 'needs';

interface AvatarAnimFrame {
  row: number;
  col: number;
  duration: number;
}

const MINI_IDLE_FRAMES: AvatarAnimFrame[] = [
  // Front sitting and breathing (facing camera)
  { row: 2, col: 0, duration: 420 },
  { row: 2, col: 1, duration: 420 },
  { row: 1, col: 4, duration: 380 },
  { row: 1, col: 5, duration: 380 },
  { row: 1, col: 6, duration: 380 },
  { row: 1, col: 7, duration: 320 }, // Blink
  { row: 1, col: 5, duration: 340 },
  { row: 2, col: 0, duration: 420 },
  // Cute stroll right
  { row: 5, col: 12, duration: 160 },
  { row: 5, col: 13, duration: 160 },
  { row: 5, col: 14, duration: 160 },
  { row: 5, col: 15, duration: 160 },
  // Look front
  { row: 1, col: 4, duration: 380 },
  // Cute stroll left
  { row: 13, col: 12, duration: 160 },
  { row: 13, col: 13, duration: 160 },
  { row: 13, col: 14, duration: 160 },
  { row: 13, col: 15, duration: 160 },
  // Sit down front
  { row: 1, col: 0, duration: 140 },
  { row: 1, col: 1, duration: 140 },
  { row: 1, col: 2, duration: 140 },
  { row: 1, col: 3, duration: 140 },
];

export class RosterModal {
  private static avatarImageCache = new Map<string, HTMLImageElement>();

  static open(
    root: HTMLElement,
    catsList: Cat[],
    areasState: Record<CatArea, SanctuaryArea>,
    _initialCatId?: string,
    currentLove = 0,
  ): void {
    if (catsList.length === 0) return;

    let searchQuery = '';
    let stageFilter: StageFilter = 'all';
    let areaFilter: AreaFilter = 'all';
    let specialFilter: SpecialFilter = 'all';
    let needsFilter: NeedsFilter = 'all';
    let currentSort: SortOption = 'name';

    let activeAnimCleanups: Array<() => void> = [];

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal roster-modal-grid-view';

    const cleanupAnimations = () => {
      activeAnimCleanups.forEach((c) => c());
      activeAnimCleanups = [];
    };

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        sound.playTap();
        cleanupAnimations();
        backdrop.remove();
      }
    });

    const getFilteredAndSortedCats = (): Cat[] => {
      const filtered = catsList.filter((cat) => {
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const skin = CAT_SKINS.find((s) => s.id === cat.color);
          const nameMatch = cat.name.toLowerCase().includes(q);
          const skinMatch = skin ? skin.label.toLowerCase().includes(q) : cat.color.toLowerCase().includes(q);
          const traitMatch = cat.majorTrait.toLowerCase().includes(q) || cat.minorTrait.toLowerCase().includes(q);
          const mutMatch = cat.mutation ? cat.mutation.toLowerCase().includes(q) : false;
          if (!nameMatch && !skinMatch && !traitMatch && !mutMatch) {
            return false;
          }
        }

        if (stageFilter !== 'all' && cat.stage !== stageFilter) return false;
        if (areaFilter !== 'all' && cat.area !== areaFilter) return false;
        if (specialFilter === 'rare' && !cat.isRare) return false;
        if (specialFilter === 'mutation' && !cat.mutation) return false;

        if (needsFilter === 'hungry' && cat.hunger >= 40) return false;
        if (needsFilter === 'dirty' && cat.cleanliness >= 40) return false;
        if (needsFilter === 'affection' && cat.affection >= 40) return false;
        if (needsFilter === 'fun' && cat.fun >= 40) return false;
        if (needsFilter === 'sleepy' && cat.energy >= 30) return false;

        return true;
      });

      return filtered.sort((a, b) => {
        if (currentSort === 'name') {
          return a.name.localeCompare(b.name);
        } else if (currentSort === 'stage') {
          const order = { kitten: 0, teen: 1, adult: 2 };
          return (order[a.stage] ?? 2) - (order[b.stage] ?? 2);
        } else if (currentSort === 'happiness') {
          return b.happiness - a.happiness;
        } else if (currentSort === 'needs') {
          const aAvg = (a.hunger + a.cleanliness + a.affection + a.fun) / 4;
          const bAvg = (b.hunger + b.cleanliness + b.affection + b.fun) / 4;
          return aAvg - bAvg; // Lowest need first
        }
        return 0;
      });
    };

    const render = () => {
      cleanupAnimations();
      const visibleCats = getFilteredAndSortedCats();

      modal.innerHTML = `
        <div class="roster-view-header">
          <div class="roster-title-group">
            <h2>🐾 Sanctuary Roster</h2>
            <span class="roster-count-badge">${visibleCats.length} / ${catsList.length} Cats</span>
          </div>
          <button class="modal-close-icon" id="roster-close-btn" title="Close">✕</button>
        </div>

        <div class="roster-search-bar-wrap">
          <input type="text" class="roster-search-input" id="roster-search-input" placeholder="🔍 Search by name, coat, trait..." value="${escapeHtml(searchQuery)}" />
        </div>

        <!-- Categorized Symmetrical Filter Lines -->
        <div class="roster-filters-stack">
          <!-- Line 1: Life Stage -->
          <div class="roster-filter-row">
            <span class="roster-filter-label">Stage:</span>
            <div class="roster-filter-chips">
              <button class="filter-chip filter-chip-multiline ${stageFilter === 'all' ? 'active' : ''}" data-filter="stage" data-val="all">
                <span class="chip-emoji">🐾</span>
                <span class="chip-label">All Stages</span>
              </button>
              <button class="filter-chip filter-chip-multiline ${stageFilter === 'kitten' ? 'active' : ''}" data-filter="stage" data-val="kitten">
                <span class="chip-emoji">🍼</span>
                <span class="chip-label">Kittens</span>
              </button>
              <button class="filter-chip filter-chip-multiline ${stageFilter === 'teen' ? 'active' : ''}" data-filter="stage" data-val="teen">
                <span class="chip-emoji">🧶</span>
                <span class="chip-label">Teens</span>
              </button>
              <button class="filter-chip filter-chip-multiline ${stageFilter === 'adult' ? 'active' : ''}" data-filter="stage" data-val="adult">
                <span class="chip-emoji">🐾</span>
                <span class="chip-label">Adults</span>
              </button>
            </div>
          </div>

          <!-- Line 2: Sanctuary Area (Multi-line Emoji + Label) -->
          <div class="roster-filter-row">
            <span class="roster-filter-label">Area:</span>
            <div class="roster-filter-chips">
              <button class="filter-chip filter-chip-multiline ${areaFilter === 'all' ? 'active' : ''}" data-filter="area" data-val="all">
                <span class="chip-emoji">🗺️</span>
                <span class="chip-label">All Areas</span>
              </button>
              ${AREA_KEYS.map((k) => {
                const meta = AREA_INFO_MAP[k];
                const unlocked = areasState[k]?.unlocked;
                if (!unlocked) return '';
                const shortName = k === 'yard' ? 'Yard' : k === 'shelter' ? 'Shelter' : k === 'sunroom' ? 'Sunroom' : 'Café';
                return `
                  <button class="filter-chip filter-chip-multiline ${areaFilter === k ? 'active' : ''}" data-filter="area" data-val="${k}">
                    <span class="chip-emoji">${meta.emoji}</span>
                    <span class="chip-label">${shortName}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Line 3: Urgent Needs -->
          <div class="roster-filter-row">
            <span class="roster-filter-label">Needs:</span>
            <div class="roster-filter-chips">
              <button class="filter-chip filter-chip-multiline ${needsFilter === 'hungry' ? 'active' : ''}" data-filter="needs" data-val="hungry">
                <span class="chip-emoji">🥣</span>
                <span class="chip-label">Hungry</span>
              </button>
              <button class="filter-chip filter-chip-multiline ${needsFilter === 'dirty' ? 'active' : ''}" data-filter="needs" data-val="dirty">
                <span class="chip-emoji">🫧</span>
                <span class="chip-label">Dirty</span>
              </button>
              <button class="filter-chip filter-chip-multiline ${needsFilter === 'affection' ? 'active' : ''}" data-filter="needs" data-val="affection">
                <span class="chip-emoji">💖</span>
                <span class="chip-label">Lonely</span>
              </button>
              <button class="filter-chip filter-chip-multiline ${needsFilter === 'sleepy' ? 'active' : ''}" data-filter="needs" data-val="sleepy">
                <span class="chip-emoji">💤</span>
                <span class="chip-label">Sleepy</span>
              </button>
            </div>
          </div>

          <!-- Line 4: Special Status -->
          <div class="roster-filter-row">
            <span class="roster-filter-label">Special:</span>
            <div class="roster-filter-chips">
              <button class="filter-chip ${specialFilter === 'rare' ? 'active' : ''}" data-filter="special" data-val="rare">
                <span class="chip-emoji">🌟</span>
                <span class="chip-label">Rare Guests</span>
              </button>
              <button class="filter-chip ${specialFilter === 'mutation' ? 'active' : ''}" data-filter="special" data-val="mutation">
                <span class="chip-emoji">🧬</span>
                <span class="chip-label">Mutations</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Sort Bar -->
        <div class="roster-sort-bar">
          <label for="roster-sort-select"><b>Sort Cards:</b></label>
          <select id="roster-sort-select" class="roster-sort-dropdown">
            <option value="name" ${currentSort === 'name' ? 'selected' : ''}>Name (A–Z)</option>
            <option value="stage" ${currentSort === 'stage' ? 'selected' : ''}>Age / Life Stage</option>
            <option value="happiness" ${currentSort === 'happiness' ? 'selected' : ''}>Happiness Level</option>
            <option value="needs" ${currentSort === 'needs' ? 'selected' : ''}>Needs Attention</option>
          </select>
        </div>

        <!-- Cards Grid Container -->
        <div class="roster-cards-container">
          ${visibleCats.length === 0 ? `
            <div class="roster-empty-state">
              <div class="empty-icon">🐱</div>
              <p>No cats found matching your search or filters.</p>
              <button class="modal-action-btn" id="clear-filters-btn" style="margin-top:8px;">Clear Filters</button>
            </div>
          ` : `
            <div class="roster-cards-grid">
              ${visibleCats.map((cat) => {
                const areaMeta = AREA_INFO_MAP[cat.area] || AREA_INFO_MAP.yard;
                const stageLabel =
                  cat.stage === 'kitten'
                    ? '🍼 Kitten'
                    : cat.stage === 'teen'
                      ? '🧶 Teen'
                      : '🐾 Adult';

                const stageClass =
                  cat.stage === 'kitten'
                    ? 'stage-kitten'
                    : cat.stage === 'teen'
                      ? 'stage-teen'
                      : 'stage-adult';

                const rareStar = cat.isRare ? ' <span class="card-sparkle">✨</span>' : '';
                const hasUrgentNeed = cat.hunger < 30 || cat.cleanliness < 30 || cat.affection < 30;

                return `
                  <div class="roster-mini-card ${hasUrgentNeed ? 'card-has-need' : ''}" data-cat-id="${cat.id}">
                    <div class="roster-card-avatar-wrap">
                      <canvas class="roster-card-canvas" data-cat-id="${cat.id}" width="48" height="48"></canvas>
                      ${cat.isRare ? `<span class="card-rare-badge" title="Rare Cat">⭐</span>` : ''}
                      ${cat.mutation ? `<span class="card-mut-badge" title="${escapeHtml(cat.mutation)} Mutation">🧬</span>` : ''}
                    </div>
                    <div class="roster-card-info">
                      <div class="roster-card-name" title="${escapeHtml(cat.name)}">
                        <b>${escapeHtml(cat.name)}</b>${rareStar}
                      </div>
                      <div class="roster-card-badges">
                        <span class="roster-card-stage ${stageClass}">${stageLabel}</span>
                        <span class="roster-card-area">${areaMeta.emoji} ${areaMeta.label}</span>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      `;

      // Bind Search Input
      const searchInput = modal.querySelector('#roster-search-input') as HTMLInputElement | null;
      if (searchInput) {
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
        searchInput.addEventListener('input', () => {
          searchQuery = searchInput.value;
          render();
        });
      }

      // Bind Filter Chips
      modal.querySelectorAll('.filter-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          sound.playTap();
          const filterType = (chip as HTMLElement).dataset.filter;
          const val = (chip as HTMLElement).dataset.val;

          if (filterType === 'stage') stageFilter = val as StageFilter;
          else if (filterType === 'area') areaFilter = val as AreaFilter;
          else if (filterType === 'special') specialFilter = specialFilter === val ? 'all' : (val as SpecialFilter);
          else if (filterType === 'needs') needsFilter = needsFilter === val ? 'all' : (val as NeedsFilter);

          render();
        });
      });

      // Bind Sort Dropdown
      modal.querySelector('#roster-sort-select')?.addEventListener('change', (e) => {
        sound.playTap();
        currentSort = (e.target as HTMLSelectElement).value as SortOption;
        render();
      });

      // Clear filters button
      modal.querySelector('#clear-filters-btn')?.addEventListener('click', () => {
        sound.playTap();
        searchQuery = '';
        stageFilter = 'all';
        areaFilter = 'all';
        specialFilter = 'all';
        needsFilter = 'all';
        render();
      });

      // Bind Card Click -> Open Cat Info Modal
      modal.querySelectorAll('.roster-mini-card').forEach((card) => {
        card.addEventListener('click', () => {
          const catId = (card as HTMLElement).dataset.catId;
          if (!catId) return;
          sound.playTap();
          cleanupAnimations();
          backdrop.remove();
          CatInfoModal.open(root, catsList, areasState, catId, currentLove);
        });
      });

      // Bind Close Button
      modal.querySelector('#roster-close-btn')?.addEventListener('click', () => {
        sound.playTap();
        cleanupAnimations();
        backdrop.remove();
      });

      // Mount mini animated cat avatars on each card
      modal.querySelectorAll('.roster-card-canvas').forEach((canvasEl) => {
        const catId = (canvasEl as HTMLElement).dataset.catId;
        const cat = catsList.find((c) => c.id === catId);
        if (cat) {
          const cleanup = RosterModal.startMiniAvatarAnimation(canvasEl as HTMLCanvasElement, cat);
          if (cleanup) activeAnimCleanups.push(cleanup);
        }
      });
    };

    render();
    backdrop.appendChild(modal);
    root.appendChild(backdrop);
  }

  private static startMiniAvatarAnimation(canvas: HTMLCanvasElement, cat: Cat): (() => void) | null {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.imageSmoothingEnabled = false;

    const skinDef = CAT_SKINS.find((s) => s.id === cat.color);
    const skinSrc = skinDef?.file ? `./assets/cats/${skinDef.file}` : './assets/cats/orange_0.png';

    const markingDef = CAT_MARKINGS.find((m) => m.id === cat.pattern);
    const markingSrc = markingDef?.file ? `./assets/cats/Markings/${markingDef.file}` : null;

    let isRunning = true;
    let animFrameId = 0;
    let frameIndex = 0;
    let frameStartTime = performance.now();

    const FRAME_SIZE = 32;

    const getImage = (src: string): Promise<HTMLImageElement> => {
      const cached = RosterModal.avatarImageCache.get(src);
      if (cached && cached.complete) return Promise.resolve(cached);
      return new Promise((resolve) => {
        const img = new Image();
        img.src = src;
        img.onload = () => {
          RosterModal.avatarImageCache.set(src, img);
          resolve(img);
        };
        img.onerror = () => resolve(img);
      });
    };

    let baseImg: HTMLImageElement | null = null;
    let markingImg: HTMLImageElement | null = null;

    getImage(skinSrc).then((img) => {
      baseImg = img;
      if (markingSrc) {
        getImage(markingSrc).then((mImg) => {
          markingImg = mImg;
        });
      }
    });

    const render = (now: number) => {
      if (!isRunning) return;

      if (baseImg && baseImg.complete) {
        const currentFrame = MINI_IDLE_FRAMES[frameIndex] || MINI_IDLE_FRAMES[0];
        const elapsed = now - frameStartTime;

        if (elapsed >= currentFrame.duration) {
          frameStartTime = now;
          frameIndex = (frameIndex + 1) % MINI_IDLE_FRAMES.length;
        }

        const activeFrame = MINI_IDLE_FRAMES[frameIndex] || MINI_IDLE_FRAMES[0];
        const srcX = activeFrame.col * FRAME_SIZE;
        const srcY = activeFrame.row * FRAME_SIZE;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.drawImage(baseImg, srcX, srcY, FRAME_SIZE, FRAME_SIZE, 0, 0, canvas.width, canvas.height);

        if (markingImg && markingImg.complete) {
          ctx.drawImage(markingImg, srcX, srcY, FRAME_SIZE, FRAME_SIZE, 0, 0, canvas.width, canvas.height);
        }
      }

      animFrameId = requestAnimationFrame(render);
    };

    animFrameId = requestAnimationFrame(render);

    return () => {
      isRunning = false;
      if (animFrameId) cancelAnimationFrame(animFrameId);
    };
  }
}
