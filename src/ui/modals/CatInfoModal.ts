import type { Cat, CatArea, SanctuaryArea, ToolType } from '../../data/types';
import { AREA_INFO_MAP, calculateRehomeLove } from '../../data/constants';
import { CAT_SKINS, CAT_MARKINGS } from '../../data/catAssets';
import { TRAITS } from '../../data/traits';
import { MUTATION_CATALOG } from '../../data/mutations';
import { sound } from '../../systems/SoundManager';
import { SVG_ICONS } from '../icons';
import { EventBus } from '../EventBus';
import { CatGlossaryModal } from '../CatGlossaryModal';
import { RosterModal } from './RosterModal';

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

interface AvatarAnimFrame {
  row: number; // Row in 32-col spritesheet
  col: number; // Col in 32-col spritesheet
  duration: number; // Duration in ms
}

const IDLE_LOOK_SEQUENCE: AvatarAnimFrame[] = [
  // Front sitting and breathing
  { row: 2, col: 0, duration: 420 },
  { row: 2, col: 1, duration: 420 },
  { row: 2, col: 0, duration: 420 },
  // Head tilt & look front
  { row: 1, col: 4, duration: 380 },
  { row: 1, col: 5, duration: 380 },
  { row: 1, col: 6, duration: 380 },
  { row: 1, col: 7, duration: 320 }, // Blink
  { row: 1, col: 5, duration: 340 },
  { row: 2, col: 0, duration: 400 },
  // Cute stroll right
  { row: 5, col: 12, duration: 160 },
  { row: 5, col: 13, duration: 160 },
  { row: 5, col: 14, duration: 160 },
  { row: 5, col: 15, duration: 160 },
  // Pause & look front
  { row: 1, col: 4, duration: 400 },
  { row: 1, col: 7, duration: 300 },
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
  { row: 2, col: 0, duration: 420 },
  { row: 2, col: 1, duration: 420 },
];

const PLAYFUL_SWAT_SEQUENCE: AvatarAnimFrame[] = [
  { row: 1, col: 16, duration: 110 },
  { row: 1, col: 17, duration: 110 },
  { row: 1, col: 18, duration: 140 },
  { row: 1, col: 19, duration: 150 },
  { row: 1, col: 18, duration: 130 },
  { row: 1, col: 17, duration: 110 },
  { row: 1, col: 5, duration: 260 },
];

const PURR_LAY_SEQUENCE: AvatarAnimFrame[] = [
  { row: 1, col: 8, duration: 180 },
  { row: 1, col: 9, duration: 240 },
  { row: 1, col: 10, duration: 340 },
  { row: 1, col: 11, duration: 340 },
  { row: 1, col: 10, duration: 340 },
  { row: 1, col: 9, duration: 240 },
];

const EATING_SEQUENCE: AvatarAnimFrame[] = [
  { row: 1, col: 0, duration: 140 },
  { row: 1, col: 1, duration: 140 },
  { row: 1, col: 2, duration: 180 },
  { row: 1, col: 3, duration: 220 },
  { row: 1, col: 2, duration: 180 },
  { row: 1, col: 1, duration: 140 },
  { row: 1, col: 0, duration: 140 },
];

const WASHING_SEQUENCE: AvatarAnimFrame[] = [
  { row: 1, col: 6, duration: 160 },
  { row: 1, col: 7, duration: 200 },
  { row: 1, col: 8, duration: 220 },
  { row: 1, col: 7, duration: 200 },
  { row: 1, col: 6, duration: 160 },
];

const SLEEPING_SEQUENCE: AvatarAnimFrame[] = [
  { row: 2, col: 8, duration: 480 },
  { row: 2, col: 9, duration: 480 },
  { row: 2, col: 10, duration: 520 },
  { row: 2, col: 11, duration: 520 },
  { row: 2, col: 10, duration: 480 },
  { row: 2, col: 9, duration: 480 },
];

export interface AvatarController {
  cancel: () => void;
  triggerReaction: (type: 'eat' | 'pet' | 'toy' | 'wash' | 'tap') => void;
}

export class CatInfoModal {
  private static avatarImageCache = new Map<string, HTMLImageElement>();

  static open(
    root: HTMLElement,
    catsList: Cat[],
    areasState: Record<CatArea, SanctuaryArea>,
    selectedCatId: string,
    currentLove: number,
  ): void {
    if (catsList.length === 0) return;

    let currentIndex = catsList.findIndex((c) => c.id === selectedCatId);
    if (currentIndex < 0) currentIndex = 0;

    let love = currentLove;
    let currentAvatarCtrl: AvatarController | null = null;

    const handleLoveChanged = ({ love: newLove }: { love: number }) => {
      love = Math.floor(newLove);
      const cat = catsList[currentIndex];
      if (cat) {
        const growBtn = modal.querySelector<HTMLButtonElement>('#instant-grow-btn');
        if (growBtn) {
          const isTeen = cat.stage === 'teen';
          const growCost = isTeen ? 300 : 500;
          growBtn.disabled = love < growCost;
        }
      }
    };
    EventBus.on('love-changed', handleLoveChanged);

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'modal cat-journal-modal';

    const navigateToCat = (targetIndex: number, direction: 'prev' | 'next') => {
      if (targetIndex === currentIndex || catsList.length <= 1) return;
      sound.playTap();

      const exitTransform = direction === 'next' ? 'translateX(-50px) rotate(-3deg)' : 'translateX(50px) rotate(3deg)';
      const enterStartTransform = direction === 'next' ? 'translateX(50px) rotate(3deg)' : 'translateX(-50px) rotate(-3deg)';

      modal.style.transition = 'transform 0.16s ease-in, opacity 0.16s ease-in';
      modal.style.transform = exitTransform;
      modal.style.opacity = '0';

      setTimeout(() => {
        currentIndex = targetIndex;
        renderCurrentCat();

        modal.style.transition = 'none';
        modal.style.transform = enterStartTransform;
        modal.style.opacity = '0';

        requestAnimationFrame(() => {
          modal.style.transition = 'transform 0.22s cubic-bezier(0.34, 1.35, 0.64, 1), opacity 0.2s ease-out';
          modal.style.transform = 'translateX(0px) rotate(0deg)';
          modal.style.opacity = '1';
        });
      }, 160);
    };

    const handleKeyNavigation = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        const nextIdx = (currentIndex - 1 + catsList.length) % catsList.length;
        navigateToCat(nextIdx, 'prev');
      } else if (e.key === 'ArrowRight') {
        const nextIdx = (currentIndex + 1) % catsList.length;
        navigateToCat(nextIdx, 'next');
      } else if (e.key === 'Escape') {
        sound.playTap();
        closeJournal();
      }
    };
    window.addEventListener('keydown', handleKeyNavigation);

    const closeJournal = () => {
      EventBus.off('love-changed', handleLoveChanged);
      currentAvatarCtrl?.cancel();
      window.removeEventListener('keydown', handleKeyNavigation);
      backdrop.remove();
    };

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        sound.playTap();
        closeJournal();
      }
    });

    const renderCurrentCat = () => {
      const cat = catsList[currentIndex];
      if (!cat) return;

      const skinDef = CAT_SKINS.find((s) => s.id === cat.color);
      const skinName = skinDef?.label || cat.color;
      const markingDef = CAT_MARKINGS.find((m) => m.id === cat.pattern);
      const markingName = markingDef?.label || (cat.pattern ? cap(cat.pattern) : 'Standard Tabby');

      const bestFriendCat = cat.journal.bestFriendId
        ? catsList.find((c) => c.id === cat.journal.bestFriendId)
        : null;
      const bestFriend = bestFriendCat
        ? `Best friends with ${bestFriendCat.name} 🐾`
        : 'Still making close friends';

      const majorDesc = TRAITS[cat.majorTrait]?.description || 'Curious and friendly nature';
      const minorDesc = TRAITS[cat.minorTrait]?.description || 'Loves cozy sanctuary spots';

      const rareBadge = cat.isRare
        ? `<div class="rare-badge-sparkle"><span class="svg-inline">${SVG_ICONS.sparkle}</span> Rare Sanctuary Guest</div>`
        : '';

      const mutationDef = cat.mutation ? MUTATION_CATALOG[cat.mutation] : null;
      const mutationBadge = mutationDef
        ? `
          <div class="mutation-badge-card" style="background:${mutationDef.tagBg};color:${mutationDef.tagColor};border:1.5px solid ${mutationDef.borderHex};border-radius:10px;padding:6px 10px;margin-top:6px;text-align:left;">
            <div style="font-size:12px;font-weight:900;letter-spacing:0.3px;margin-bottom:2px;">${escapeHtml(mutationDef.badgeLabel)}</div>
            <div style="font-size:11px;opacity:0.9;margin-bottom:3px;line-height:1.3;">${escapeHtml(mutationDef.description)}</div>
            <div style="font-size:11px;font-weight:700;line-height:1.3;"><b>Perk:</b> ${escapeHtml(mutationDef.perk)}</div>
          </div>
        `
        : '';

      const areaOptions = (['yard', 'shelter', 'sunroom', 'cafe'] as CatArea[])
        .map((areaKey) => {
          const area = areasState[areaKey];
          const info = AREA_INFO_MAP[areaKey];
          if (!area || !area.unlocked) return '';
          const count = catsList.filter((c) => c.area === areaKey).length;
          const isSelected = cat.area === areaKey;
          const disabled = !isSelected && count >= area.capacity;
          return `<option value="${areaKey}" ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}>
            ${info.emoji} ${info.label} (${count}/${area.capacity}${disabled ? ' - Full' : ''})
          </option>`;
        })
        .join('');

      const stageLabel =
        cat.stage === 'kitten'
          ? 'Kitten 🍼'
          : cat.stage === 'teen'
            ? 'Teen 🧶'
            : 'Adult 🐾';

      const nextStageText =
        cat.stage === 'kitten'
          ? 'Teenager (At 100% Growth)'
          : cat.stage === 'teen'
            ? 'Adult (At 100% Growth)'
            : 'Fully Grown';

      const growCost = cat.stage === 'kitten' ? 500 : 1500;
      const avgCare = ((cat.hunger + cat.cleanliness + cat.affection + cat.fun) / 4);
      const growthMultiplier = cat.stage === 'adult' ? 1.0 : Math.max(0.2, (avgCare / 100) * 10);
      const growthPaused = cat.stage !== 'adult' && (cat.hunger < 20 || cat.cleanliness < 20);
      const growthPct = Math.round(cat.growthProgress || 0);
      const growthNearFull = growthPct >= 95;

      const growthHtml =
        cat.stage === 'adult'
          ? ''
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
              <button class="instant-grow-btn" id="instant-grow-btn" ${love < growCost ? 'disabled' : ''}>
                <span class="svg-inline">${SVG_ICONS.sparkle}</span>
                <span>Grow to ${cat.stage === 'kitten' ? 'Teen' : 'Adult'} (${growCost.toLocaleString()} 💗)</span>
              </button>
            </div>
          `;

      const rehomeVal = calculateRehomeLove(cat);

      modal.innerHTML = `
        <!-- Carousel Header Bar -->
        <div class="carousel-header-bar">
          <button class="carousel-nav-btn prev-cat-btn" id="prev-cat-btn" title="Previous Cat (Left Arrow)" ${catsList.length <= 1 ? 'disabled' : ''}>
            ${SVG_ICONS.arrowLeft}
          </button>
          <div class="carousel-cat-counter">
            <span class="counter-text">Cat <b>${currentIndex + 1}</b> of <b>${catsList.length}</b></span>
          </div>
          <button class="carousel-nav-btn next-cat-btn" id="next-cat-btn" title="Next Cat (Right Arrow)" ${catsList.length <= 1 ? 'disabled' : ''}>
            ${SVG_ICONS.arrowRight}
          </button>
        </div>

        <div class="journal-header">
          <div class="journal-avatar-wrapper clickable-avatar" id="avatar-interactive-wrapper" title="Tap ${escapeHtml(cat.name)} to play! 🐾">
            <canvas id="journal-cat-canvas" width="64" height="64" class="journal-avatar-canvas"></canvas>
          </div>
          <div class="journal-title-box">
            <div class="name-edit-row" id="name-display-row">
              <h2 id="cat-name-display">${escapeHtml(cat.name)}</h2>
              <button class="rename-cat-btn" id="rename-cat-btn" title="Rename Cat (200 💗)">
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
          <div class="area-reassign-row">
            <label for="cat-area-select" class="area-reassign-label">
              <b>Sanctuary Area:</b>
            </label>
            <select id="cat-area-select" class="area-select-dropdown">
              ${areaOptions}
            </select>
          </div>
          <div class="area-actions-row">
            <button class="goto-cat-action-btn" id="goto-cat-btn" title="Go directly to this cat in the sanctuary">
              📍 Go To Cat
            </button>
            <button class="sort-all-cats-btn" id="sort-all-cats-btn" title="Sort & Reassign All Cats">
              <span class="svg-inline">${SVG_ICONS.paw}</span> Manage Roster
            </button>
          </div>
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
            <span class="need-label">⚡ Energy</span>
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
          <button class="rehome-compact-btn" id="rehome-cat-btn" title="Adopt out ${escapeHtml(cat.name)} for +${rehomeVal.total.toLocaleString()} Love and +${rehomeVal.stars} Stars">
            <span>+${rehomeVal.total.toLocaleString()} 💗 · +${rehomeVal.stars} ⭐</span>
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

      modal.querySelector('#prev-cat-btn')?.addEventListener('click', () => {
        const nextIdx = (currentIndex - 1 + catsList.length) % catsList.length;
        navigateToCat(nextIdx, 'prev');
      });

      modal.querySelector('#next-cat-btn')?.addEventListener('click', () => {
        const nextIdx = (currentIndex + 1) % catsList.length;
        navigateToCat(nextIdx, 'next');
      });

      modal.querySelector('#open-cat-glossary-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        sound.playTap();
        new CatGlossaryModal(root, { cats: catsList } as any).open('all', cat.color);
      });

      modal.querySelector('#open-coat-tag-glossary-btn')?.addEventListener('click', () => {
        sound.playTap();
        new CatGlossaryModal(root, { cats: catsList } as any).open('all', cat.color);
      });

      modal.querySelector('#open-glossary-action-btn')?.addEventListener('click', () => {
        sound.playTap();
        new CatGlossaryModal(root, { cats: catsList } as any).open('all', cat.color);
      });

      modal.querySelector('#goto-cat-btn')?.addEventListener('click', () => {
        sound.playSparkle();
        closeJournal();
        EventBus.emit('switch-area', { area: cat.area });
        setTimeout(() => {
          EventBus.emit('focus-cat', { catId: cat.id });
        }, 120);
      });

      modal.querySelector('#instant-grow-btn')?.addEventListener('click', () => {
        if (love < growCost) return;
        sound.playSparkle();
        love -= growCost;
        if (cat.stage === 'kitten') {
          cat.stage = 'teen';
          cat.growthProgress = 0;
        } else if (cat.stage === 'teen') {
          cat.stage = 'adult';
          cat.growthProgress = 100;
        }
        EventBus.emit('instant-grow-cat', { catId: cat.id, cost: growCost });
        renderCurrentCat();
      });

      // Rename Cat
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

          if (love < 200) {
            sound.playTap();
            EventBus.emit('toast', { message: 'Not enough Care Points. Need 200 💗 to rename.' });
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
        closeJournal();
        RosterModal.open(root, catsList, areasState, cat.id, love);
      });

      // Quick Care Action Buttons
      modal.querySelectorAll('.quick-care-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tool = (btn as HTMLElement).dataset.tool as ToolType;
          if (!tool) return;
          sound.playTap();
          EventBus.emit('direct-care-cat', { catId: cat.id, tool });

          // Trigger corresponding reaction on the profile avatar!
          if (tool === 'food') currentAvatarCtrl?.triggerReaction('eat');
          else if (tool === 'pet') currentAvatarCtrl?.triggerReaction('pet');
          else if (tool === 'toy') currentAvatarCtrl?.triggerReaction('toy');
          else if (tool === 'wash') currentAvatarCtrl?.triggerReaction('wash');

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

      // Interactive Avatar Click Reaction
      const avatarWrap = modal.querySelector('#avatar-interactive-wrapper') as HTMLElement | null;
      if (avatarWrap) {
        avatarWrap.addEventListener('click', () => {
          if (cat.stage === 'kitten') {
            sound.playKittenMeow();
          } else {
            sound.playMeow(cat.stage === 'teen' ? 1.06 : 1.0);
          }
          currentAvatarCtrl?.triggerReaction('tap');

          // Spawn cute floating heart emoji over the avatar
          const heartEl = document.createElement('div');
          heartEl.className = 'avatar-click-heart';
          heartEl.textContent = cat.stage === 'kitten' ? '🐾' : '❤️';
          heartEl.style.position = 'absolute';
          heartEl.style.left = '50%';
          heartEl.style.top = '20%';
          heartEl.style.transform = 'translate(-50%, -50%)';
          heartEl.style.pointerEvents = 'none';
          heartEl.style.fontSize = '20px';
          heartEl.style.zIndex = '100';
          heartEl.style.animation = 'avatarHeartFloat 0.75s ease-out forwards';
          avatarWrap.appendChild(heartEl);
          setTimeout(() => heartEl.remove(), 750);
        });
      }

      modal.querySelector('#rehome-cat-btn')?.addEventListener('click', () => {
        sound.playTap();
        CatInfoModal.openRehomeConfirmModal(root, cat, rehomeVal, () => {
          closeJournal();
        });
      });

      modal.querySelector('#export-card-btn')?.addEventListener('click', () => {
        sound.playTap();
        EventBus.emit('export-cat-card', { catId: cat.id });
      });

      modal.querySelector('#journal-close-btn')?.addEventListener('click', () => {
        sound.playTap();
        closeJournal();
      });

      currentAvatarCtrl?.cancel();
      currentAvatarCtrl = CatInfoModal.startCatAvatarAnimation(modal.querySelector('#journal-cat-canvas') as HTMLCanvasElement, cat);
    };

    // Touch swipe handling
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
          if (Math.abs(dx) > Math.abs(dy) * 2.0 && Math.abs(dx) > DEADZONE_PX) {
            gestureLock = 'horizontal';
          } else {
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
        if (currentDx <= -SWIPE_TRIGGER_PX && catsList.length > 1) {
          const nextIdx = (currentIndex + 1) % catsList.length;
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
        } else if (currentDx >= SWIPE_TRIGGER_PX && catsList.length > 1) {
          const prevIdx = (currentIndex - 1 + catsList.length) % catsList.length;
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
          modal.style.transition = 'transform 0.24s cubic-bezier(0.34, 1.35, 0.64, 1), opacity 0.2s ease-out';
          modal.style.transform = 'translateX(0px) rotate(0deg)';
          modal.style.opacity = '1';
        }
      }
    };

    modal.addEventListener('touchstart', onTouchStart, { passive: true });
    modal.addEventListener('touchmove', onTouchMove, { passive: false });
    modal.addEventListener('touchend', onTouchEnd, { passive: true });

    renderCurrentCat();
    backdrop.appendChild(modal);
    root.appendChild(backdrop);
  }

  static openRehomeConfirmModal(
    root: HTMLElement,
    cat: Cat,
    reward: { base: number; happinessBonus: number; total: number; stars: number },
    onCloseParent: () => void,
  ): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        sound.playTap();
        backdrop.remove();
      }
    });

    const modal = document.createElement('div');
    modal.className = 'modal rehome-confirm-modal';
    modal.innerHTML = `
      <div class="rehome-modal-content">
        <div class="rehome-heart-icon">${SVG_ICONS.lovingHome}</div>
        <h2>Adopt Out ${escapeHtml(cat.name)}?</h2>

        <div class="rehome-reward-pill">
          <span class="rehome-reward-love">+${reward.total.toLocaleString()} 💗</span>
          ${reward.stars > 0 ? `<span class="rehome-reward-stars">+${reward.stars} ⭐</span>` : ''}
        </div>

        <div class="rehome-btn-group">
          <button class="rehome-confirm-btn" id="confirm-rehome-btn">Adopt Out</button>
          <button class="rehome-cancel-btn" id="cancel-rehome-btn">Cancel</button>
        </div>
      </div>
    `;

    modal.querySelector('#confirm-rehome-btn')?.addEventListener('click', () => {
      sound.playSparkle();
      EventBus.emit('rehome-cat', { catId: cat.id });
      backdrop.remove();
      onCloseParent();
    });

    modal.querySelector('#cancel-rehome-btn')?.addEventListener('click', () => {
      sound.playTap();
      backdrop.remove();
    });

    backdrop.appendChild(modal);
    root.appendChild(backdrop);
  }

  private static startCatAvatarAnimation(canvas: HTMLCanvasElement | null, cat: Cat): AvatarController | null {
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.imageSmoothingEnabled = false;

    const skinDef = CAT_SKINS.find((s) => s.id === cat.color);
    const skinSrc = skinDef?.file ? `./assets/cats/${skinDef.file}` : './assets/cats/orange_0.png';

    const markingDef = CAT_MARKINGS.find((m) => m.id === cat.pattern);
    const markingSrc = markingDef?.file ? `./assets/cats/Markings/${markingDef.file}` : null;

    let isRunning = true;
    let animFrameId = 0;

    let currentSequence: AvatarAnimFrame[] =
      cat.animationState === 'sleep' || cat.energy < 20 ? SLEEPING_SEQUENCE : IDLE_LOOK_SEQUENCE;
    let frameIndex = 0;
    let frameStartTime = performance.now();
    let reactionTimeout: any = null;

    const FRAME_SIZE = 32;

    const getImage = (src: string): Promise<HTMLImageElement> => {
      const cached = CatInfoModal.avatarImageCache.get(src);
      if (cached && cached.complete) return Promise.resolve(cached);
      return new Promise((resolve) => {
        const img = new Image();
        img.src = src;
        img.onload = () => {
          CatInfoModal.avatarImageCache.set(src, img);
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
        const currentFrame = currentSequence[frameIndex] || currentSequence[0];
        const elapsed = now - frameStartTime;

        if (elapsed >= currentFrame.duration) {
          frameStartTime = now;
          frameIndex = (frameIndex + 1) % currentSequence.length;
        }

        const activeFrame = currentSequence[frameIndex] || currentSequence[0];
        const srcX = activeFrame.col * FRAME_SIZE;
        const srcY = activeFrame.row * FRAME_SIZE;
        const targetSize = cat.mutation === 'tiny' ? canvas.width * 0.68 : cat.mutation === 'giant' ? canvas.width : canvas.width * 0.90;
        const targetX = (canvas.width - targetSize) / 2;
        const targetY = (canvas.height - targetSize) / 2 + (cat.mutation === 'tiny' ? 5 : 0);

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

        // Draw Base Skin Frame
        ctx.drawImage(baseImg, srcX, srcY, FRAME_SIZE, FRAME_SIZE, targetX, targetY, targetSize, targetSize);

        // Draw Marking Overlay Frame
        if (markingImg && markingImg.complete) {
          ctx.drawImage(markingImg, srcX, srcY, FRAME_SIZE, FRAME_SIZE, targetX, targetY, targetSize, targetSize);
        }
        ctx.restore();

        // Draw Mutation Special Visual Overlays
        if (cat.mutation === 'angelic') {
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = 2;
          ctx.beginPath();
          const haloBob = Math.sin((now % 1200) / 1200 * Math.PI * 2) * 2;
          ctx.ellipse(canvas.width / 2, targetY - 4 + haloBob, 12, 4, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (cat.mutation === 'stinky') {
          const puffPhase = (now % 1400) / 1400;
          ctx.fillStyle = 'rgba(74, 222, 128, 0.75)';
          ctx.beginPath();
          ctx.arc(canvas.width / 2 + Math.sin(puffPhase * 6.28) * 8, targetY - puffPhase * 16, 4 * (1 - puffPhase * 0.3), 0, Math.PI * 2);
          ctx.fill();
        } else if (cat.mutation === 'sparkly') {
          ctx.fillStyle = 'rgba(240, 171, 252, 0.85)';
          const starPhase = (now % 1000) / 1000;
          ctx.fillRect(8 + Math.sin(starPhase * 6.28) * 4, 8, 3, 3);
          ctx.fillRect(52 - Math.sin(starPhase * 6.28) * 4, 12, 2.5, 2.5);
        } else if (cat.mutation === 'gilded') {
          ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
          const goldPhase = (now % 1200) / 1200;
          ctx.fillRect(50, 48 - Math.sin(goldPhase * 6.28) * 3, 3, 3);
          ctx.fillRect(10, 50 + Math.sin(goldPhase * 6.28) * 3, 3, 3);
        }
      }

      animFrameId = requestAnimationFrame(render);
    };

    animFrameId = requestAnimationFrame(render);

    const triggerReaction = (type: 'eat' | 'pet' | 'toy' | 'wash' | 'tap') => {
      if (reactionTimeout) clearTimeout(reactionTimeout);

      let seq = IDLE_LOOK_SEQUENCE;
      let durationMs = 2400;

      if (type === 'eat') {
        seq = EATING_SEQUENCE;
        durationMs = 2000;
      } else if (type === 'pet') {
        seq = PURR_LAY_SEQUENCE;
        durationMs = 2400;
      } else if (type === 'toy' || type === 'tap') {
        seq = PLAYFUL_SWAT_SEQUENCE;
        durationMs = 1600;
      } else if (type === 'wash') {
        seq = WASHING_SEQUENCE;
        durationMs = 2000;
      }

      currentSequence = seq;
      frameIndex = 0;
      frameStartTime = performance.now();

      reactionTimeout = setTimeout(() => {
        currentSequence =
          cat.animationState === 'sleep' || cat.energy < 20 ? SLEEPING_SEQUENCE : IDLE_LOOK_SEQUENCE;
        frameIndex = 0;
        frameStartTime = performance.now();
      }, durationMs);
    };

    return {
      cancel: () => {
        isRunning = false;
        if (reactionTimeout) clearTimeout(reactionTimeout);
        if (animFrameId) cancelAnimationFrame(animFrameId);
      },
      triggerReaction,
    };
  }
}
