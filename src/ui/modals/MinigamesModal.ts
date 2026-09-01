import { sound } from '../../systems/SoundManager';
import { EventBus } from '../EventBus';
import { SVG_ICONS } from '../icons';
import { CONQUEST_REGIONS } from '../../data/conquest/ConquestData';
import type { ConquestState, Cat, PyramidRecord } from '../../data/types';

export interface MinigamesModalData {
  love: number;
  tokens: number;
  cats: Cat[];
  conquestState: ConquestState;
  pyramidRecord?: PyramidRecord;
}


export type MinigameTab = 'conquest' | 'pyramid' | 'derby' | 'avalanche';

export class MinigamesModal {
  static open(root: HTMLElement, data: MinigamesModalData, initialTab: MinigameTab = 'conquest'): void {
    const existing = document.querySelector('.minigames-modal-backdrop');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop minigames-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'modal minigames-modal';

    let currentTab: MinigameTab = initialTab;

    const closeModal = () => {
      backdrop.classList.add('fade-out');
      setTimeout(() => backdrop.remove(), 200);
    };

    const render = () => {
      const cs = data.conquestState ?? {
        clearedRegions: [],
        pendingLove: 0,
        pendingStars: 0,
        totalInvasionsLaunched: 0,
        totalBattlesWon: 0,
        totalBattlesLost: 0,
      };

      modal.innerHTML = `
        <div class="modal-header">
          <h2>
            <span class="svg-inline" style="color: #ff758f; display: inline-flex; align-items: center;">${SVG_ICONS.minigames}</span>
            Cat Mini Games
          </h2>
          <div class="shop-balance-pill">
            <span class="hud-icon heart-icon">${SVG_ICONS.heart}</span>
            <span class="shop-love-val">${data.love.toLocaleString()}</span>
            <span style="opacity:0.4;margin:0 2px;">•</span>
            <span class="hud-icon star-icon">${SVG_ICONS.star}</span>
            <span class="shop-token-val">${(data.tokens ?? 0).toLocaleString()}</span>
          </div>
        </div>

        <div class="shop-tabs minigames-nav-tabs">
          <button class="shop-tab-btn ${currentTab === 'conquest' ? 'active' : ''}" id="mg-tab-conquest-btn">
            <span class="svg-inline" style="color: #ff758f;">${SVG_ICONS.conquest}</span> Conquest
          </button>
          <button class="shop-tab-btn ${currentTab === 'pyramid' ? 'active' : ''}" id="mg-tab-pyramid-btn">
            🏗️ Pyramid
          </button>
          <button class="shop-tab-btn ${currentTab === 'derby' ? 'active' : ''}" id="mg-tab-derby-btn">
            🏁 Derby
          </button>
          <button class="shop-tab-btn ${currentTab === 'avalanche' ? 'active' : ''}" id="mg-tab-avalanche-btn">
            🌀 Avalanche
          </button>
        </div>

        <div class="shop-content minigames-content">
          ${currentTab === 'conquest'
            ? MinigamesModal.renderConquestContent(data, cs)
            : currentTab === 'pyramid'
              ? MinigamesModal.renderPyramidPreview(data)
              : currentTab === 'derby'
                ? MinigamesModal.renderDerbyPreview(data)
                : MinigamesModal.renderAvalanchePreview(data)
          }
        </div>

        <button class="modal-close" id="minigames-close-btn">Done</button>
      `;

      // Bind Tab Navigation
      modal.querySelector('#mg-tab-conquest-btn')?.addEventListener('click', () => {
        sound.playTap();
        currentTab = 'conquest';
        render();
      });

      modal.querySelector('#mg-tab-pyramid-btn')?.addEventListener('click', () => {
        sound.playTap();
        currentTab = 'pyramid';
        render();
      });

      modal.querySelector('#mg-tab-derby-btn')?.addEventListener('click', () => {
        sound.playTap();
        currentTab = 'derby';
        render();
      });

      modal.querySelector('#mg-tab-avalanche-btn')?.addEventListener('click', () => {
        sound.playTap();
        currentTab = 'avalanche';
        render();
      });

      // Bind Conquest Launch Buttons
      modal.querySelectorAll<HTMLButtonElement>('.cq-shop-launch-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const regionIndex = parseInt(btn.dataset.region ?? '0', 10);
          sound.playTap();
          closeModal();
          EventBus.emit('launch-conquest', { regionIndex });
        });
      });

      // Bind Pyramid Launch Button
      modal.querySelector('#pyr-launch-btn')?.addEventListener('click', () => {
        sound.playTap();
        closeModal();
        EventBus.emit('launch-pyramid', {});
      });

      modal.querySelector('#minigames-close-btn')?.addEventListener('click', () => {
        sound.playTap();
        closeModal();
      });
    };

    render();
    backdrop.appendChild(modal);
    root.appendChild(backdrop);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        sound.playTap();
        closeModal();
      }
    });
  }

  // ── Conquest Campaign Content ─────────────────────────────────────────────

  private static renderConquestContent(data: MinigamesModalData, cs: ConquestState): string {
    let html = `
      <div style="padding:4px 0;">
        <div style="background:#fffaf2;border:2px solid #d4a373;border-radius:16px;padding:12px 14px;margin-bottom:14px;box-shadow:0 3px 8px rgba(77,56,39,0.06);">
          <div style="font-size:16px;font-weight:900;color:#4d3827;margin-bottom:4px;display:flex;align-items:center;gap:6px;">
            <span class="svg-inline" style="color:#ff758f;display:inline-flex;align-items:center;">${SVG_ICONS.conquest}</span> Cat Conquest Campaign
          </div>
          <div style="font-size:12px;color:#7c6855;line-height:1.4;font-weight:600;">
            Spend Care Points to launch your sanctuary cats on conquests across 10 territories! Your cats always return safely.
          </div>
          <div style="display:flex;gap:12px;margin-top:10px;font-size:12px;font-weight:800;">
            <span style="color:#529656;background:#e8f5df;padding:3px 8px;border-radius:999px;border:1px solid #68ad6c;">${cs.clearedRegions.length}/10 Territories Claimed</span>
            <span style="color:#ff758f;background:#ffe5ec;padding:3px 8px;border-radius:999px;border:1px solid #ff758f;">${cs.totalBattlesWon}W / ${cs.totalBattlesLost}L</span>
          </div>
        </div>
    `;

    for (const region of CONQUEST_REGIONS) {
      const cleared = cs.clearedRegions.includes(region.index);
      const isAvailable = region.index === 0 || cs.clearedRegions.includes(region.index - 1) || cleared;
      const canAfford = data.love >= region.invasionCost;

      html += `
        <div style="background:#fffaf2;border:2px solid ${cleared ? '#68ad6c' : isAvailable ? '#d4a373' : 'rgba(212,163,115,0.25)'};border-radius:16px;padding:12px 14px;margin-bottom:10px;opacity:${isAvailable ? 1 : 0.55};box-shadow:0 2px 6px rgba(77,56,39,0.05);">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
            <div style="flex:1;">
              <div style="font-size:15px;font-weight:900;color:#4d3827;">${region.name}</div>
              <div style="font-size:11px;color:#7c6855;font-weight:700;">${region.isBoss ? 'Boss Battle' : `${region.enemyCount} Enemy Cats`} · Reward: +${region.loveReward.toLocaleString()} 💗 +${region.starReward} ⭐</div>
            </div>
            <span>${cleared ? '<span style="color:#529656;font-size:12px;font-weight:900;">Claimed</span>' : isAvailable ? `<span class="svg-inline" style="color:#ff758f;display:inline-flex;align-items:center;">${SVG_ICONS.conquest}</span>` : '<span style="color:#9c8e7c;font-size:12px;font-weight:700;">Locked</span>'}</span>
          </div>
          ${isAvailable ? `<button
            class="cq-shop-launch-btn"
            data-region="${region.index}"
            ${!canAfford ? 'disabled' : ''}
            style="width:100%;padding:8px;border:none;border-radius:10px;background:${cleared ? 'linear-gradient(135deg, #529656, #3b703e)' : 'linear-gradient(135deg, #ff758f, #e05770)'};color:white;font-weight:900;font-size:13px;cursor:${canAfford ? 'pointer' : 'not-allowed'};opacity:${canAfford ? 1 : 0.6};"
          >
            ${cleared ? `Replay Conquest (-${region.invasionCost.toLocaleString()} 💗)` : `Launch Conquest (-${region.invasionCost.toLocaleString()} 💗)`}
          </button>` : ''}
        </div>
      `;
    }

    html += `</div>`;
    return html;
  }

  // ── Purrfect Pyramid Content ──────────────────────────────────────────────

  private static renderPyramidPreview(data: MinigamesModalData): string {
    const record = data.pyramidRecord ?? { maxHeight: 0, maxCats: 0, totalGames: 0, trophiesUnlocked: [] };

    return `
      <div style="padding:4px 0;text-align:center;">
        <div style="background:linear-gradient(135deg, #fff7ed, #ffedd5);border:2px solid #fb923c;border-radius:18px;padding:16px 14px;box-shadow:0 4px 12px rgba(251,146,60,0.14);margin-bottom:14px;">
          <div style="font-size:38px;margin-bottom:4px;">🏗️🐾</div>
          <h3 style="margin:0 0 6px;font-size:19px;color:#7c2d12;font-weight:900;">Purrfect Pyramid</h3>
          <p style="margin:0 0 12px;font-size:13px;color:#9a3412;line-height:1.45;font-weight:600;">
            Build the tallest, wobbliest tower of cats! Drop cats from your sanctuary onto the balancing cushion without tumbling over.
          </p>

          <div style="display:flex;justify-content:space-around;background:rgba(255,255,255,0.85);border:1.5px solid #fdba74;border-radius:12px;padding:10px;margin-bottom:14px;">
            <div>
              <div style="font-size:18px;font-weight:900;color:#c2410c;">${record.maxHeight.toFixed(1)} m</div>
              <div style="font-size:11px;font-weight:800;color:#9a3412;">Best Height</div>
            </div>
            <div style="border-left:1.5px solid #fdba74;"></div>
            <div>
              <div style="font-size:18px;font-weight:900;color:#c2410c;">${record.maxCats}</div>
              <div style="font-size:11px;font-weight:800;color:#9a3412;">Max Cats Stacked</div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;text-align:left;margin-bottom:14px;font-size:11.5px;color:#7c2d12;">
            <div style="background:rgba(255,255,255,0.7);padding:6px 8px;border-radius:8px;border:1px solid #fdba74;">
              <b>🦣 Giant Cats:</b> Ultra-wide stable base
            </div>
            <div style="background:rgba(255,255,255,0.7);padding:6px 8px;border-radius:8px;border:1px solid #fdba74;">
              <b>🐾 Kittens:</b> Lightweight gap-fillers
            </div>
            <div style="background:rgba(255,255,255,0.7);padding:6px 8px;border-radius:8px;border:1px solid #fdba74;">
              <b>🪽 Angelic Cats:</b> Wings dampen tower sway
            </div>
            <div style="background:rgba(255,255,255,0.7);padding:6px 8px;border-radius:8px;border:1px solid #fdba74;">
              <b>✨ Sparkly:</b> Bonus Stars on land
            </div>
          </div>

          <button
            id="pyr-launch-btn"
            style="width:100%;padding:12px;border:none;border-radius:14px;background:linear-gradient(135deg, #f97316, #ea580c);color:white;font-family:'Nunito',system-ui,sans-serif;font-weight:900;font-size:15.5px;cursor:pointer;box-shadow:0 4px 14px rgba(234,88,12,0.35);transition:transform 0.15s ease;"
          >
            🏗️ Start Stacking Tower!
          </button>
        </div>
      </div>
    `;
  }


  // ── Grand Kitty Derby Preview ─────────────────────────────────────────────

  private static renderDerbyPreview(_data: MinigamesModalData): string {
    return `
      <div style="padding:10px 0;text-align:center;">
        <div style="background:linear-gradient(135deg, #f0fdf4, #dcfce7);border:2px solid #4ade80;border-radius:18px;padding:18px 14px;box-shadow:0 4px 12px rgba(74,222,128,0.12);margin-bottom:14px;">
          <div style="font-size:36px;margin-bottom:6px;">🏁🐱</div>
          <h3 style="margin:0 0 6px;font-size:18px;color:#14532d;font-weight:900;">Grand Kitty Derby</h3>
          <p style="margin:0 0 12px;font-size:13px;color:#166534;line-height:1.45;font-weight:600;">
            Unleash 50–100 of your sanctuary cats into a massive obstacle sprint! Dodge cucumbers, wake sleepy cats in sunbeams, and jump yarn hurdles.
          </p>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:left;margin-bottom:14px;font-size:11.5px;color:#14532d;">
            <div style="background:rgba(255,255,255,0.7);padding:8px;border-radius:10px;border:1px solid #86efac;">
              <b>☀️ Sunbeams:</b> Lazy cats take naps unless cheered
            </div>
            <div style="background:rgba(255,255,255,0.7);padding:8px;border-radius:10px;border:1px solid #86efac;">
              <b>🥒 Cucumbers:</b> Cats leap into the air in surprise
            </div>
            <div style="background:rgba(255,255,255,0.7);padding:8px;border-radius:10px;border:1px solid #86efac;">
              <b>🧶 Yarn Hurdles:</b> Vault over bouncing balls
            </div>
            <div style="background:rgba(255,255,255,0.7);padding:8px;border-radius:10px;border:1px solid #86efac;">
              <b>🔴 Lasers:</b> Steer the stampede to victory
            </div>
          </div>

          <span class="unlocked-badge" style="background:#bbf7d0;color:#14532d;font-size:12px;padding:5px 14px;">
            ✨ Coming in Phase 3
          </span>
        </div>
      </div>
    `;
  }

  // ── Fluff-ball Avalanche Preview ──────────────────────────────────────────

  private static renderAvalanchePreview(_data: MinigamesModalData): string {

    return `
      <div style="padding:10px 0;text-align:center;">
        <div style="background:linear-gradient(135deg, #f5f3ff, #ede9fe);border:2px solid #a78bfa;border-radius:18px;padding:18px 14px;box-shadow:0 4px 12px rgba(167,139,250,0.12);margin-bottom:14px;">
          <div style="font-size:36px;margin-bottom:6px;">🌀🧶</div>
          <h3 style="margin:0 0 6px;font-size:18px;color:#4c1d95;font-weight:900;">Fluff-ball Avalanche</h3>
          <p style="margin:0 0 12px;font-size:13px;color:#5b21b6;line-height:1.45;font-weight:600;">
            Roll your cats into an unstoppable Katamari-style giant ball of fur! Sweep through sanctuary rooms collecting toys, cushions, and treasures.
          </p>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:left;margin-bottom:14px;font-size:11.5px;color:#4c1d95;">
            <div style="background:rgba(255,255,255,0.7);padding:8px;border-radius:10px;border:1px solid #c4b5fd;">
              <b>🐾 10 Cats:</b> Sweep up kibble pellets and mice
            </div>
            <div style="background:rgba(255,255,255,0.7);padding:8px;border-radius:10px;border:1px solid #c4b5fd;">
              <b>🐾 50 Cats:</b> Roll over yarn balls and cardboard
            </div>
            <div style="background:rgba(255,255,255,0.7);padding:8px;border-radius:10px;border:1px solid #c4b5fd;">
              <b>🐾 150+ Cats:</b> Absorb whole giant cat trees!
            </div>
            <div style="background:rgba(255,255,255,0.7);padding:8px;border-radius:10px;border:1px solid #c4b5fd;">
              <b>🏆 Rewards:</b> Huge Care Point & Token bursts
            </div>
          </div>

          <span class="unlocked-badge" style="background:#ddd6fe;color:#4c1d95;font-size:12px;padding:5px 14px;">
            ✨ Coming in Phase 4
          </span>
        </div>
      </div>
    `;
  }
}
