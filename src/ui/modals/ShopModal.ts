import type { Cat, CatArea, FenceLayout, Milestone, SanctuaryArea } from '../../data/types';
import { AREA_INFO_MAP, AUTOMATION_CATALOG, FURNITURE_CATALOG, OFFLINE_STAR_UPGRADES, getAreaCapacityUpgradeCost, CAT_PERFUME_COST } from '../../data/constants';
import { SVG_ICONS } from '../icons';
import { sound } from '../../systems/SoundManager';
import { EventBus } from '../EventBus';

const AREA_KEYS: CatArea[] = ['yard', 'shelter', 'sunroom', 'cafe'];

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

export interface ShopModalData {
  love: number;
  tokens: number;
  catCount: number;
  areas: Record<CatArea, SanctuaryArea>;
  cats: Cat[];
  furniture: string[];
  machines: Record<string, number>;
  milestones: Milestone[];
  offlineStarLevel: number;
  catPerfumeCount: number;
  fenceLayout: FenceLayout;
}

export class ShopModal {
  static open(
    root: HTMLElement,
    data: ShopModalData,
    defaultTab: 'areas' | 'machines' | 'furniture' | 'milestones' | 'upgrades' = 'areas',
  ): void {
    let currentActiveTab = defaultTab;
    let currentFence = data.fenceLayout;
    const pendingPurchases = new Set<string>();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'modal shop-modal';

    const updateBalances = () => {
      const loveBalVal = modal.querySelector('.shop-love-pill .shop-bal-val');
      if (loveBalVal) {
        loveBalVal.textContent = data.love.toLocaleString();
      }
      const starsBalVal = modal.querySelector('.shop-stars-pill .shop-bal-val');
      if (starsBalVal) {
        starsBalVal.textContent = `${data.tokens}`;
      }
    };

    const updateButtonAffordability = () => {
      modal.querySelectorAll<HTMLButtonElement>('.unlock-area-btn').forEach((btn) => {
        const areaKey = btn.dataset.area as CatArea;
        const meta = AREA_INFO_MAP[areaKey];
        if (meta) {
          const canAfford = data.love >= meta.unlockCostLove;
          const meetsThreshold = data.catCount >= meta.unlockThresholdCats;
          btn.disabled = !canAfford || !meetsThreshold;
        }
      });

      modal.querySelectorAll<HTMLButtonElement>('.upgrade-cap-btn').forEach((btn) => {
        const areaKey = btn.dataset.area as CatArea;
        const meta = AREA_INFO_MAP[areaKey];
        const areaState = data.areas[areaKey];
        if (meta && areaState) {
          const cost = getAreaCapacityUpgradeCost(areaState, meta.baseCapacity);
          btn.disabled = data.love < cost;
        }
      });

      modal.querySelectorAll<HTMLButtonElement>('.buy-machine-btn').forEach((btn) => {
        const machineId = btn.dataset.machineId;
        const m = AUTOMATION_CATALOG.find((item) => item.id === machineId);
        if (m) {
          if (pendingPurchases.has(m.id)) {
            btn.disabled = true;
          } else {
            btn.disabled = data.love < m.baseCost;
          }
        }
      });

      modal.querySelectorAll<HTMLButtonElement>('.upgrade-machine-btn').forEach((btn) => {
        const machineId = btn.dataset.machineId;
        const m = AUTOMATION_CATALOG.find((item) => item.id === machineId);
        const lvl = data.machines[machineId || ''] || 0;
        if (m && lvl > 0 && lvl < 3) {
          const cost = lvl === 1 ? m.upgradeCostLvl2 : m.upgradeCostLvl3;
          btn.disabled = data.love < cost;
        }
      });

      modal.querySelectorAll<HTMLButtonElement>('.buy-furniture-btn').forEach((btn) => {
        const furnitureId = btn.dataset.furnitureId;
        const item = FURNITURE_CATALOG.find((f) => f.id === furnitureId);
        if (item) {
          if (pendingPurchases.has(item.id)) {
            btn.disabled = true;
          } else {
            btn.disabled = data.love < item.loveCost;
          }
        }
      });

      const offlineBtn = modal.querySelector<HTMLButtonElement>('.upgrade-offline-stars-btn');
      if (offlineBtn) {
        const lvl = data.offlineStarLevel || 1;
        const nextDef = OFFLINE_STAR_UPGRADES[lvl];
        if (nextDef) {
          offlineBtn.disabled = data.love < nextDef.costCarePoints;
        }
      }

      modal.querySelectorAll<HTMLButtonElement>('.buy-perfume-btn').forEach((btn) => {
        btn.disabled = data.love < CAT_PERFUME_COST;
      });
    };

    const handleLoveChanged = ({ love }: { love: number }) => {
      data.love = Math.floor(love);
      updateBalances();
      updateButtonAffordability();
    };

    const handleTokensChanged = ({ tokens }: { tokens: number }) => {
      data.tokens = tokens;
      updateBalances();
    };

    const handleCatsChanged = ({ count }: { count: number }) => {
      data.catCount = count;
      updateButtonAffordability();
    };

    const handleSanctuaryState = (payload: {
      areas: Record<CatArea, SanctuaryArea>;
      currentArea: CatArea;
      cats: Cat[];
      furniture: string[];
      machines?: Record<string, number>;
      milestones: Milestone[];
      tokens: number;
      offlineStarLevel?: number;
      catPerfumeCount?: number;
      fenceLayout?: FenceLayout;
    }) => {
      data.areas = payload.areas;
      data.cats = payload.cats;
      data.catCount = payload.cats.length;
      if (payload.furniture) {
        data.furniture = payload.furniture;
        payload.furniture.forEach((id) => pendingPurchases.delete(id));
      }
      if (payload.machines) {
        data.machines = payload.machines;
        Object.keys(payload.machines).forEach((id) => pendingPurchases.delete(id));
      }
      if (payload.milestones) data.milestones = payload.milestones;
      if (payload.tokens !== undefined) data.tokens = payload.tokens;
      if (payload.offlineStarLevel !== undefined) data.offlineStarLevel = payload.offlineStarLevel;
      if (payload.catPerfumeCount !== undefined) data.catPerfumeCount = payload.catPerfumeCount;
      if (payload.fenceLayout) {
        data.fenceLayout = payload.fenceLayout;
        currentFence = payload.fenceLayout;
      }
      renderTabs(currentActiveTab, true);
    };

    EventBus.on('love-changed', handleLoveChanged);
    EventBus.on('tokens-changed', handleTokensChanged);
    EventBus.on('cats-changed', handleCatsChanged);
    EventBus.on('sanctuary-state', handleSanctuaryState);

    const closeModal = () => {
      EventBus.off('love-changed', handleLoveChanged);
      EventBus.off('tokens-changed', handleTokensChanged);
      EventBus.off('cats-changed', handleCatsChanged);
      EventBus.off('sanctuary-state', handleSanctuaryState);
      modal.remove();
      backdrop.remove();
    };

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        sound.playTap();
        closeModal();
      }
    });

    const renderTabs = (activeTab: 'areas' | 'machines' | 'furniture' | 'milestones' | 'upgrades', preserveScroll = true) => {
      currentActiveTab = activeTab;
      const savedModalScroll = preserveScroll ? modal.scrollTop : 0;
      const contentEl = modal.querySelector('.shop-content');
      const savedContentScroll = preserveScroll && contentEl ? contentEl.scrollTop : 0;

      modal.innerHTML = `
        <div class="shop-header">
          <h2 class="shop-title">Sanctuary Emporium</h2>
          <div class="shop-balances">
            <div class="shop-balance-pill shop-love-pill" title="Care Points">
              <span class="svg-inline">${SVG_ICONS.heart}</span>
              <span class="shop-bal-val">${data.love.toLocaleString()}</span>
            </div>
            <div class="shop-balance-pill shop-stars-pill" title="Stars (Plinko)">
              <span class="svg-inline">${SVG_ICONS.star}</span>
              <span class="shop-bal-val">${data.tokens}</span>
            </div>
          </div>
        </div>

        <div class="shop-tabs">
          <button class="shop-tab-btn ${activeTab === 'areas' ? 'active' : ''}" id="tab-areas-btn" title="Sanctuary Areas & Expansion"><span class="shop-tab-icon">${SVG_ICONS.yard}</span></button>
          <button class="shop-tab-btn ${activeTab === 'machines' ? 'active' : ''}" id="tab-machines-btn" title="Automation Care Stations"><span class="shop-tab-icon">${SVG_ICONS.machine}</span></button>
          <button class="shop-tab-btn ${activeTab === 'furniture' ? 'active' : ''}" id="tab-furniture-btn" title="Furniture & Decor"><span class="shop-tab-icon">${SVG_ICONS.shop}</span></button>
          <button class="shop-tab-btn ${activeTab === 'milestones' ? 'active' : ''}" id="tab-milestones-btn" title="Sanctuary Milestone Goals"><span class="shop-tab-icon">${SVG_ICONS.star}</span></button>
          <button class="shop-tab-btn ${activeTab === 'upgrades' ? 'active' : ''}" id="tab-upgrades-btn" title="Upgrades & Sorting Fences"><span class="shop-tab-icon">${SVG_ICONS.sparkle}</span></button>
        </div>

        <div class="shop-content">
          ${activeTab === 'areas'
            ? ShopModal.renderShopAreasContent(data)
            : activeTab === 'machines'
              ? ShopModal.renderShopMachinesContent(data, pendingPurchases)
              : activeTab === 'furniture'
                ? ShopModal.renderShopFurnitureContent(data, pendingPurchases)
                : activeTab === 'milestones'
                  ? ShopModal.renderShopMilestonesContent(data)
                  : ShopModal.renderShopUpgradesContent(data, currentFence)
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
        closeModal();
      });

      // Bind Area Unlock buttons
      modal.querySelectorAll('.unlock-area-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const areaKey = (btn as HTMLElement).dataset.area as CatArea;
          EventBus.emit('unlock-area', { area: areaKey });
        });
      });

      // Bind Capacity Upgrade buttons
      modal.querySelectorAll('.upgrade-cap-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const areaKey = (btn as HTMLElement).dataset.area as CatArea;
          EventBus.emit('upgrade-capacity', { area: areaKey });
        });
      });

      // Bind Automation Machine Buy & Upgrade buttons
      modal.querySelectorAll('.buy-machine-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const machineId = (btn as HTMLElement).dataset.machineId;
          if (machineId && !pendingPurchases.has(machineId)) {
            const m = AUTOMATION_CATALOG.find((item) => item.id === machineId);
            if (m && data.love >= m.baseCost) {
              pendingPurchases.add(machineId);
              data.love -= m.baseCost;
              updateBalances();
              updateButtonAffordability();
              btn.classList.add('delivering-btn');
              (btn as HTMLButtonElement).disabled = true;
              btn.innerHTML = `📦 Delivering...`;
              const card = btn.closest('.shop-card');
              const badge = card?.querySelector('.machine-unowned-badge');
              if (badge) {
                badge.className = 'machine-unowned-badge delivering-badge';
                badge.textContent = '📦 Delivering';
              }
              EventBus.emit('buy-machine', { machineId });
            }
          }
        });
      });

      modal.querySelectorAll('.upgrade-machine-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const machineId = (btn as HTMLElement).dataset.machineId;
          if (machineId) {
            const m = AUTOMATION_CATALOG.find((item) => item.id === machineId);
            const lvl = data.machines[machineId] || 0;
            const cost = lvl === 1 ? m?.upgradeCostLvl2 : m?.upgradeCostLvl3;
            if (cost && data.love >= cost) {
              btn.classList.add('delivering-btn');
              btn.innerHTML = `✨ Upgrading...`;
              (btn as HTMLButtonElement).disabled = true;
              EventBus.emit('upgrade-machine', { machineId });
            }
          }
        });
      });

      // Bind Furniture Purchase buttons
      modal.querySelectorAll('.buy-furniture-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const furnitureId = (btn as HTMLElement).dataset.furnitureId;
          if (furnitureId && !pendingPurchases.has(furnitureId)) {
            const item = FURNITURE_CATALOG.find((f) => f.id === furnitureId);
            if (item && data.love >= item.loveCost) {
              pendingPurchases.add(furnitureId);
              data.love -= item.loveCost;
              updateBalances();
              updateButtonAffordability();
              btn.classList.add('delivering-btn');
              (btn as HTMLButtonElement).disabled = true;
              btn.innerHTML = `📦 Delivering...`;
              EventBus.emit('buy-furniture', { furnitureId });
            }
          }
        });
      });

      // Bind Milestone Claim buttons
      modal.querySelectorAll('.claim-milestone-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const milestoneId = (btn as HTMLElement).dataset.milestoneId;
          if (milestoneId) {
            EventBus.emit('claim-milestone', { milestoneId });
          }
        });
      });

      // Bind Upgrade Offline Stars button
      modal.querySelector('.upgrade-offline-stars-btn')?.addEventListener('click', () => {
        EventBus.emit('upgrade-offline-stars', {});
      });

      // Bind Buy Cat Perfume button
      modal.querySelectorAll('.buy-perfume-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (data.love >= CAT_PERFUME_COST) {
            data.love -= CAT_PERFUME_COST;
            updateBalances();
            updateButtonAffordability();
            const prevText = btn.innerHTML;
            btn.classList.add('delivering-btn');
            btn.innerHTML = `📦 Delivering...`;
            (btn as HTMLButtonElement).disabled = true;
            EventBus.emit('buy-cat-perfume', {});
            setTimeout(() => {
              btn.classList.remove('delivering-btn');
              btn.innerHTML = prevText;
              updateButtonAffordability();
            }, 350);
          }
        });
      });

      // Bind Fence Layout Selector buttons
      modal.querySelectorAll('.fence-option-card').forEach((card) => {
        card.addEventListener('click', () => {
          const layout = (card as HTMLElement).dataset.fenceLayout as FenceLayout;
          if (layout) {
            currentFence = layout;
            data.fenceLayout = layout;
            EventBus.emit('fence-layout-changed', { layout });
            EventBus.emit('toast', {
              message: `🏡 Sanctuary Fence Layout updated to ${layout === 'none' ? 'Open' : layout === 'horizontal' ? 'Horizontal Split' : layout === 'vertical' ? 'Vertical Split' : '4-Quadrant Cross'}!`,
            });
            renderTabs('upgrades', true);
          }
        });
      });
    };

    renderTabs(defaultTab, false);
    backdrop.appendChild(modal);
    root.appendChild(backdrop);
  }

  private static renderShopAreasContent(data: ShopModalData): string {
    return AREA_KEYS.map((k) => {
      const meta = AREA_INFO_MAP[k];
      const areaState = data.areas[k];
      const count = data.cats.filter((c) => c.area === k).length;
      const isUnlocked = areaState?.unlocked;

      if (!isUnlocked) {
        const canAfford = data.love >= meta.unlockCostLove;
        const meetsThreshold = data.catCount >= meta.unlockThresholdCats;
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
      const canUpgrade = data.love >= capacityCost;

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

  private static renderShopMachinesContent(data: ShopModalData, pendingPurchases: Set<string> = new Set()): string {
    return `
      <div class="machines-intro">
        Automated stations passively maintain cats' needs (T1: 50% · T2: 80% · T3: 100%).
      </div>
      <div class="machines-catalog-grid">
        ${AUTOMATION_CATALOG.map((m) => {
          const areaUnlocked = data.areas[m.area]?.unlocked;
          const currentLevel = data.machines[m.id] || 0;
          const isPending = pendingPurchases.has(m.id);
          const areaMeta = AREA_INFO_MAP[m.area];

          let statusBadge = '';
          let actionBtn = '';

          if (!areaUnlocked) {
            statusBadge = `<span class="lock-badge">Locked</span>`;
            actionBtn = `<button class="shop-action-btn" disabled>Unlock ${areaMeta.label}</button>`;
          } else if (isPending) {
            statusBadge = `<span class="machine-unowned-badge delivering-badge">📦 Delivering</span>`;
            actionBtn = `
              <button class="shop-action-btn delivering-btn" disabled>
                📦 Delivering...
              </button>
            `;
          } else if (currentLevel === 0) {
            const canAfford = data.love >= m.baseCost;
            statusBadge = `<span class="machine-unowned-badge">Unowned</span>`;
            actionBtn = `
              <button class="shop-action-btn buy-machine-btn" data-machine-id="${m.id}" ${!canAfford ? 'disabled' : ''}>
                Install (${m.baseCost.toLocaleString()} 💗)
              </button>
            `;
          } else if (currentLevel < 3) {
            const upgradeCost = currentLevel === 1 ? m.upgradeCostLvl2 : m.upgradeCostLvl3;
            const canAfford = data.love >= upgradeCost;
            statusBadge = `<span class="unlocked-badge">T${currentLevel} (${currentLevel === 1 ? '50%' : '80%'})</span>`;
            actionBtn = `
              <button class="shop-action-btn upgrade-machine-btn" data-machine-id="${m.id}" ${!canAfford ? 'disabled' : ''}>
                Tier ${currentLevel + 1} (${upgradeCost.toLocaleString()} 💗)
              </button>
            `;
          } else {
            statusBadge = `<span class="unlocked-badge tier-max-badge">T3 Max</span>`;
            actionBtn = `<span class="claimed-badge">Max</span>`;
          }

          const needSvg = SVG_ICONS[m.needType] || SVG_ICONS.food;

          return `
            <div class="shop-card machine-card ${currentLevel > 0 ? 'machine-active-card' : ''}">
              <div class="shop-card-info">
                <div class="machine-title-row">
                  <h3><span class="svg-inline">${needSvg}</span> ${m.name}</h3>
                  ${statusBadge}
                </div>
                <div class="shop-card-meta">
                  <b>${areaMeta.label}</b> · ${cap(m.needType)} · ${m.description}
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

  private static renderShopFurnitureContent(data: ShopModalData, pendingPurchases: Set<string> = new Set()): string {
    return FURNITURE_CATALOG.map((item) => {
      const isOwned = data.furniture.includes(item.id);
      const isPending = pendingPurchases.has(item.id);
      const canAfford = data.love >= item.loveCost;
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

      if (isPending) {
        return `
          <div class="shop-card">
            <div class="shop-card-info">
              <h3>${item.name} <span class="machine-unowned-badge delivering-badge">📦 Delivering</span></h3>
              <p>${item.description}</p>
              <div class="shop-card-meta">Location: <b>${areaMeta.label}</b> · <span class="bonus-tag">${item.bonusText}</span></div>
            </div>
            <button class="shop-action-btn delivering-btn" disabled>
              📦 Delivering...
            </button>
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

  private static renderShopMilestonesContent(data: ShopModalData): string {
    return `
      <div class="milestones-intro">Complete sanctuary goals to earn Stars ⭐ for Cat Plinko!</div>
      <div class="milestones-list">
        ${data.milestones.map((m) => {
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

  private static renderShopUpgradesContent(data: ShopModalData, fenceLayout: FenceLayout): string {
    const currentLvl = data.offlineStarLevel || 1;
    const isMax = currentLvl >= 5;
    const nextDef = OFFLINE_STAR_UPGRADES[currentLvl];

    return `
      <div class="milestones-intro">Upgrade passive Star generation while offline:</div>
      <div class="shop-card ${isMax ? 'unlocked-card' : ''}" style="margin-top:10px;">
        <div class="shop-card-info">
          <h3>⭐ Passive Star Generation (Level ${currentLvl} / 5)</h3>
          <p>Generates <b>${currentLvl} Star${currentLvl > 1 ? 's' : ''} per hour</b> while offline (no accumulation limit).</p>
          ${isMax
            ? `<div class="shop-card-meta"><span class="unlocked-badge">Maximum Level Reached (5 Stars/hr)</span></div>`
            : `<div class="shop-card-meta">Next Level: <b>${nextDef?.ratePerHour} Stars/hr</b> · Cost: <b>${nextDef?.costCarePoints.toLocaleString()} 💗</b></div>`
          }
        </div>
        ${!isMax && nextDef
          ? `<button class="shop-action-btn upgrade-offline-stars-btn" ${data.love < nextDef.costCarePoints ? 'disabled' : ''}>
              Upgrade Rate (${nextDef.costCarePoints.toLocaleString()} 💗)
            </button>`
          : ''
        }
      </div>

      <!-- Consumable: Cat Perfume -->
      <div class="shop-card" style="margin-top:10px;border-left: 4px solid #ec4899;">
        <div class="shop-card-info">
          <div class="machine-title-row">
            <h3><span class="svg-inline">${SVG_ICONS.perfume}</span> Cat Perfume</h3>
            <span class="unlocked-badge" style="background:#fce7f3;color:#be185d;font-weight:bold;">Stock: <b>${data.catPerfumeCount}</b></span>
          </div>
          <p>Triggers a 10s Breeding Frenzy on an adult cat to earn ⭐ Stars.</p>
        </div>
        <div class="machine-action-wrap">
          <button class="shop-action-btn buy-perfume-btn" ${data.love < CAT_PERFUME_COST ? 'disabled' : ''}>
            Buy (${CAT_PERFUME_COST} 💗)
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
          <button type="button" class="fence-option-card ${fenceLayout === 'none' ? 'active' : ''}" data-fence-layout="none">
            <div class="fence-diagram fence-diag-none"></div>
            <span class="fence-card-title">None</span>
            <span class="fence-card-sub">Open Room</span>
          </button>

          <button type="button" class="fence-option-card ${fenceLayout === 'horizontal' ? 'active' : ''}" data-fence-layout="horizontal">
            <div class="fence-diagram fence-diag-h"></div>
            <span class="fence-card-title">Horizontal</span>
            <span class="fence-card-sub">Top / Bottom</span>
          </button>

          <button type="button" class="fence-option-card ${fenceLayout === 'vertical' ? 'active' : ''}" data-fence-layout="vertical">
            <div class="fence-diagram fence-diag-v"></div>
            <span class="fence-card-title">Vertical</span>
            <span class="fence-card-sub">Left / Right</span>
          </button>

          <button type="button" class="fence-option-card ${fenceLayout === 'both' ? 'active' : ''}" data-fence-layout="both">
            <div class="fence-diagram fence-diag-both"></div>
            <span class="fence-card-title">Cross</span>
            <span class="fence-card-sub">4 Quadrants</span>
          </button>
        </div>
      </div>
    `;
  }
}
