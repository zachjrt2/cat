import type { Cat, CatArea, SanctuaryArea } from '../../data/types';
import { AREA_INFO_MAP, calculateRehomeLove } from '../../data/constants';
import { CAT_SKINS, CAT_MARKINGS } from '../../data/catAssets';
import { sound } from '../../systems/SoundManager';
import { EventBus } from '../EventBus';
import { SVG_ICONS } from '../icons';
import { CatInfoModal } from './CatInfoModal';

const AREA_KEYS: CatArea[] = ['yard', 'shelter', 'sunroom', 'cafe'];

function escapeHtml(s?: string): string {
  if (!s || typeof s !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function cap(s?: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type StageFilter = 'all' | 'kitten' | 'teen' | 'adult';
export type RarityFilter = 'all' | 'common' | 'rare';
export type MutationFilter = 'all' | 'none' | 'mutated';
export type AreaFilter = 'all' | CatArea;
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

    let love = currentLove;
    let searchQuery = '';
    let stageFilter: StageFilter = 'all';
    let rarityFilter: RarityFilter = 'all';
    let mutationFilter: MutationFilter = 'all';
    let areaFilter: AreaFilter = 'all';
    let needsFilter: NeedsFilter = 'all';
    let currentSort: SortOption = 'name';

    const selectedCatIds = new Set<string>();
    let activeAnimCleanups: Array<() => void> = [];

    const handleLoveChanged = ({ love: newLove }: { love: number }) => {
      love = Math.floor(newLove);
    };
    EventBus.on('love-changed', handleLoveChanged);

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal roster-modal-grid-view';

    const cleanupAnimations = () => {
      activeAnimCleanups.forEach((c) => c());
      activeAnimCleanups = [];
    };

    const cleanupModal = () => {
      EventBus.off('love-changed', handleLoveChanged);
      cleanupAnimations();
    };

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        sound.playTap();
        cleanupModal();
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
        if (rarityFilter === 'common' && cat.isRare) return false;
        if (rarityFilter === 'rare' && !cat.isRare) return false;
        if (mutationFilter === 'none' && cat.mutation) return false;
        if (mutationFilter === 'mutated' && !cat.mutation) return false;
        if (areaFilter !== 'all' && cat.area !== areaFilter) return false;

        if (needsFilter === 'hungry' && cat.hunger >= 40) return false;
        if (needsFilter === 'dirty' && cat.cleanliness >= 40) return false;
        if (needsFilter === 'affection' && cat.affection >= 40) return false;
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

      // Clean up selected IDs that are no longer in catsList
      for (const id of selectedCatIds) {
        if (!catsList.some((c) => c.id === id)) {
          selectedCatIds.delete(id);
        }
      }

      const selectedCats = catsList.filter((c) => selectedCatIds.has(c.id));
      let totalSelectedLove = 0;
      let totalSelectedStars = 0;
      selectedCats.forEach((c) => {
        const reward = calculateRehomeLove(c);
        totalSelectedLove += reward.total;
        totalSelectedStars += reward.stars;
      });

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
              <button class="filter-chip ${stageFilter === 'all' ? 'active' : ''}" data-filter="stage" data-val="all">All</button>
              <button class="filter-chip ${stageFilter === 'kitten' ? 'active' : ''}" data-filter="stage" data-val="kitten">Kittens</button>
              <button class="filter-chip ${stageFilter === 'teen' ? 'active' : ''}" data-filter="stage" data-val="teen">Teens</button>
              <button class="filter-chip ${stageFilter === 'adult' ? 'active' : ''}" data-filter="stage" data-val="adult">Adults</button>
            </div>
          </div>

          <!-- Line 2: Rarity -->
          <div class="roster-filter-row">
            <span class="roster-filter-label">Rarity:</span>
            <div class="roster-filter-chips">
              <button class="filter-chip ${rarityFilter === 'all' ? 'active' : ''}" data-filter="rarity" data-val="all">All</button>
              <button class="filter-chip ${rarityFilter === 'common' ? 'active' : ''}" data-filter="rarity" data-val="common">Common</button>
              <button class="filter-chip ${rarityFilter === 'rare' ? 'active' : ''}" data-filter="rarity" data-val="rare">Rare Guests</button>
            </div>
          </div>

          <!-- Line 3: Mutation -->
          <div class="roster-filter-row">
            <span class="roster-filter-label">Mutation:</span>
            <div class="roster-filter-chips">
              <button class="filter-chip ${mutationFilter === 'all' ? 'active' : ''}" data-filter="mutation" data-val="all">All</button>
              <button class="filter-chip ${mutationFilter === 'none' ? 'active' : ''}" data-filter="mutation" data-val="none">Pure / None</button>
              <button class="filter-chip ${mutationFilter === 'mutated' ? 'active' : ''}" data-filter="mutation" data-val="mutated">Mutated</button>
            </div>
          </div>

          <!-- Line 4: Sanctuary Area -->
          <div class="roster-filter-row">
            <span class="roster-filter-label">Area:</span>
            <div class="roster-filter-chips">
              <button class="filter-chip ${areaFilter === 'all' ? 'active' : ''}" data-filter="area" data-val="all">All</button>
              ${AREA_KEYS.map((k) => {
                const unlocked = areasState[k]?.unlocked;
                if (!unlocked) return '';
                const shortName = k === 'yard' ? 'Yard' : k === 'shelter' ? 'Shelter' : k === 'sunroom' ? 'Sunroom' : 'Café';
                return `
                  <button class="filter-chip ${areaFilter === k ? 'active' : ''}" data-filter="area" data-val="${k}">${shortName}</button>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Line 5: Urgent Needs -->
          <div class="roster-filter-row">
            <span class="roster-filter-label">Needs:</span>
            <div class="roster-filter-chips">
              <button class="filter-chip ${needsFilter === 'hungry' ? 'active' : ''}" data-filter="needs" data-val="hungry">Hungry</button>
              <button class="filter-chip ${needsFilter === 'dirty' ? 'active' : ''}" data-filter="needs" data-val="dirty">Dirty</button>
              <button class="filter-chip ${needsFilter === 'affection' ? 'active' : ''}" data-filter="needs" data-val="affection">Lonely</button>
              <button class="filter-chip ${needsFilter === 'sleepy' ? 'active' : ''}" data-filter="needs" data-val="sleepy">Sleepy</button>
            </div>
          </div>
        </div>

        <!-- Sort Bar -->
        <div class="roster-sort-bar">
          <label for="roster-sort-select"><b>Sort:</b></label>
          <select id="roster-sort-select" class="roster-sort-dropdown">
            <option value="name" ${currentSort === 'name' ? 'selected' : ''}>Name (A–Z)</option>
            <option value="stage" ${currentSort === 'stage' ? 'selected' : ''}>Age / Life Stage</option>
            <option value="happiness" ${currentSort === 'happiness' ? 'selected' : ''}>Happiness Level</option>
            <option value="needs" ${currentSort === 'needs' ? 'selected' : ''}>Needs Attention</option>
          </select>
        </div>

        <!-- Batch Selection Toolbar -->
        <div class="roster-batch-toolbar">
          <div class="batch-select-group">
            <button class="batch-action-btn" id="roster-select-all-btn" title="Select all currently filtered cats">
              ☑️ Select All (${visibleCats.length})
            </button>
            ${selectedCatIds.size > 0 ? `
              <button class="batch-action-btn" id="roster-deselect-btn" title="Deselect all">
                ✕ Deselect
              </button>
            ` : ''}
            <span class="batch-selection-pill">${selectedCatIds.size} / ${visibleCats.length} selected</span>
          </div>

          <button class="batch-sell-btn" id="roster-sell-selected-btn" ${selectedCatIds.size === 0 ? 'disabled' : ''} title="Adopt out all selected cats">
            <span>🏡 Adopt Out Selected (${selectedCatIds.size})</span>
            ${selectedCatIds.size > 0 ? `
              <span class="batch-sell-reward-pill">+${totalSelectedLove.toLocaleString()} 💗${totalSelectedStars > 0 ? ` (+${totalSelectedStars} ⭐)` : ''}</span>
            ` : ''}
          </button>
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
                const isSelected = selectedCatIds.has(cat.id);
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
                  <div class="roster-mini-card ${hasUrgentNeed ? 'card-has-need' : ''} ${isSelected ? 'card-selected' : ''}" data-cat-id="${cat.id}">
                    <button class="roster-card-checkbox ${isSelected ? 'checked' : ''}" data-cat-id="${cat.id}" title="${isSelected ? 'Deselect' : 'Select'}">
                      ${isSelected ? '✓' : ''}
                    </button>
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
          else if (filterType === 'rarity') rarityFilter = val as RarityFilter;
          else if (filterType === 'mutation') mutationFilter = val as MutationFilter;
          else if (filterType === 'area') areaFilter = val as AreaFilter;
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
        rarityFilter = 'all';
        mutationFilter = 'all';
        areaFilter = 'all';
        needsFilter = 'all';
        render();
      });

      // Select All Filtered Button
      modal.querySelector('#roster-select-all-btn')?.addEventListener('click', () => {
        sound.playTap();
        visibleCats.forEach((c) => selectedCatIds.add(c.id));
        render();
      });

      // Deselect Button
      modal.querySelector('#roster-deselect-btn')?.addEventListener('click', () => {
        sound.playTap();
        selectedCatIds.clear();
        render();
      });

      // Adopt Out Selected Button
      modal.querySelector('#roster-sell-selected-btn')?.addEventListener('click', () => {
        if (selectedCatIds.size === 0) {
          EventBus.emit('toast', { message: 'Select at least 1 cat to adopt out.' });
          sound.playPop();
          return;
        }

        sound.playTap();
        RosterModal.openBatchRehomeConfirmModal(
          root,
          selectedCats,
          totalSelectedLove,
          totalSelectedStars,
          () => {
            EventBus.emit('rehome-cats-batch', { catIds: Array.from(selectedCatIds) });
            // Remove from local list
            selectedCatIds.forEach((id) => {
              const idx = catsList.findIndex((c) => c.id === id);
              if (idx !== -1) catsList.splice(idx, 1);
            });
            selectedCatIds.clear();

            if (catsList.length === 0) {
              cleanupModal();
              backdrop.remove();
            } else {
              render();
            }
          },
        );
      });

      // Bind Checkbox click (prevent opening modal, toggle selection)
      modal.querySelectorAll('.roster-card-checkbox').forEach((chk) => {
        chk.addEventListener('click', (e) => {
          e.stopPropagation();
          sound.playTap();
          const catId = (chk as HTMLElement).dataset.catId;
          if (!catId) return;

          if (selectedCatIds.has(catId)) {
            selectedCatIds.delete(catId);
          } else {
            selectedCatIds.add(catId);
          }
          render();
        });
      });

      // Bind Card Click -> Open Cat Info Modal
      modal.querySelectorAll('.roster-mini-card').forEach((card) => {
        card.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.roster-card-checkbox')) return;
          const catId = (card as HTMLElement).dataset.catId;
          if (!catId) return;
          sound.playTap();
          cleanupModal();
          backdrop.remove();
          CatInfoModal.open(root, catsList, areasState, catId, love);
        });
      });

      // Bind Close Button
      modal.querySelector('#roster-close-btn')?.addEventListener('click', () => {
        sound.playTap();
        cleanupModal();
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

  static openBatchRehomeConfirmModal(
    root: HTMLElement,
    selectedCats: Cat[],
    totalLove: number,
    totalStars: number,
    onConfirm: () => void,
  ): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        sound.playTap();
        backdrop.remove();
      }
    });

    const rareCount = selectedCats.filter((c) => c.isRare || c.mutation).length;

    const modal = document.createElement('div');
    modal.className = 'modal rehome-confirm-modal batch-rehome-confirm-modal';
    modal.innerHTML = `
      <div class="rehome-modal-content">
        <div class="rehome-heart-icon">${SVG_ICONS.lovingHome}</div>
        <h2>Adopt Out ${selectedCats.length} Cats?</h2>

        <div class="rehome-reward-pill">
          <span class="rehome-reward-love">+${totalLove.toLocaleString()} 💗</span>
          ${totalStars > 0 ? `<span class="rehome-reward-stars">+${totalStars} ⭐</span>` : ''}
        </div>

        <div class="batch-rehome-cat-list">
          ${selectedCats.map((c) => {
            const mutText = c.mutation ? ` · 🧬 ${escapeHtml(c.mutation)}` : '';
            const rareText = c.isRare ? ' · ⭐ Rare' : '';
            return `<div class="batch-cat-item"><b>${escapeHtml(c.name)}</b> (${cap(c.stage)}${rareText}${mutText})</div>`;
          }).join('')}
        </div>

        ${rareCount > 0 ? `
          <div class="batch-rehome-warning">
            ⚠️ Includes ${rareCount} rare or mutated ${rareCount === 1 ? 'cat' : 'cats'}!
          </div>
        ` : ''}

        <div class="rehome-btn-group">
          <button class="rehome-confirm-btn" id="confirm-batch-rehome-btn">Adopt Out (${selectedCats.length})</button>
          <button class="rehome-cancel-btn" id="cancel-batch-rehome-btn">Cancel</button>
        </div>
      </div>
    `;

    modal.querySelector('#confirm-batch-rehome-btn')?.addEventListener('click', () => {
      sound.playSparkle();
      backdrop.remove();
      onConfirm();
    });

    modal.querySelector('#cancel-batch-rehome-btn')?.addEventListener('click', () => {
      sound.playTap();
      backdrop.remove();
    });

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

    let frameIndex = Math.floor(Math.random() * MINI_IDLE_FRAMES.length);
    const initialFrame = MINI_IDLE_FRAMES[frameIndex] || MINI_IDLE_FRAMES[0];
    let frameStartTime = performance.now() - Math.random() * initialFrame.duration;

    let traitSpeed = 1.0;
    if (cat.stage === 'kitten') traitSpeed *= 1.12;
    else if (cat.stage === 'teen') traitSpeed *= 1.04;
    if (cat.majorTrait === 'lazy' || cat.minorTrait === 'lazy') traitSpeed *= 0.88;
    else if (cat.majorTrait === 'zoomie' || cat.minorTrait === 'zoomie') traitSpeed *= 1.12;
    else if (cat.majorTrait === 'curious' || cat.minorTrait === 'curious') traitSpeed *= 1.05;

    const speedFactor = traitSpeed * (0.92 + Math.random() * 0.16);

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
    });

    if (markingSrc) {
      getImage(markingSrc).then((img) => {
        markingImg = img;
      });
    }

    const render = (now: number) => {
      if (!isRunning) return;

      if (baseImg && baseImg.complete) {
        const currentFrame = MINI_IDLE_FRAMES[frameIndex] || MINI_IDLE_FRAMES[0];
        const adjustedDuration = currentFrame.duration / speedFactor;
        const elapsed = now - frameStartTime;

        if (elapsed >= adjustedDuration) {
          frameStartTime = now;
          frameIndex = (frameIndex + 1) % MINI_IDLE_FRAMES.length;
        }

        const activeFrame = MINI_IDLE_FRAMES[frameIndex] || MINI_IDLE_FRAMES[0];
        const srcX = activeFrame.col * FRAME_SIZE;
        const srcY = activeFrame.row * FRAME_SIZE;

        const targetSize = cat.mutation === 'tiny' ? canvas.width * 0.68 : cat.mutation === 'giant' ? canvas.width : canvas.width * 0.90;
        const targetX = (canvas.width - targetSize) / 2;
        const targetY = (canvas.height - targetSize) / 2 + (cat.mutation === 'tiny' ? 4 : 0);

        ctx.clearRect(0, 0, canvas.width, canvas.height);

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

        ctx.drawImage(baseImg, srcX, srcY, FRAME_SIZE, FRAME_SIZE, targetX, targetY, targetSize, targetSize);

        if (markingImg && markingImg.complete) {
          ctx.drawImage(markingImg, srcX, srcY, FRAME_SIZE, FRAME_SIZE, targetX, targetY, targetSize, targetSize);
        }
        ctx.restore();

        if (cat.mutation === 'angelic') {
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const haloBob = Math.sin((now % 1200) / 1200 * Math.PI * 2) * 1.5;
          ctx.ellipse(canvas.width / 2, targetY - 3 + haloBob, 9, 3, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (cat.mutation === 'stinky') {
          const puffPhase = (now % 1400) / 1400;
          ctx.fillStyle = 'rgba(74, 222, 128, 0.7)';
          ctx.beginPath();
          ctx.arc(canvas.width / 2 + Math.sin(puffPhase * 6.28) * 6, targetY - puffPhase * 12, 3 * (1 - puffPhase * 0.3), 0, Math.PI * 2);
          ctx.fill();
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
