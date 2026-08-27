import type { GameState } from '../data/types';
import { CAT_SKINS, CAT_MARKINGS, type CatSkinDef, type MarkingDef } from '../data/catAssets';
import { SVG_ICONS } from './icons';
import { sound } from '../systems/SoundManager';

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#039;';
      default: return m;
    }
  });
}

export type GlossaryTab = 'all' | 'standard' | 'rare';

export class CatGlossaryModal {
  private root: HTMLElement;
  private state: GameState;
  private backdrop: HTMLElement | null = null;
  private currentTab: GlossaryTab = 'all';
  private targetScrollSkinId: string | null = null;
  private static imageCache: Map<string, HTMLImageElement> = new Map();

  constructor(root: HTMLElement, state: GameState) {
    this.root = root;
    this.state = state;
  }

  open(initialTab: GlossaryTab = 'all', targetSkinId?: string): void {
    this.currentTab = initialTab;
    this.targetScrollSkinId = targetSkinId ?? null;
    this.close();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop glossary-modal-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        sound.playTap();
        this.close();
      }
    });

    const modal = document.createElement('div');
    modal.className = 'modal glossary-modal';
    backdrop.appendChild(modal);
    this.root.appendChild(backdrop);
    this.backdrop = backdrop;

    this.render(modal);
  }

  close(): void {
    if (this.backdrop) {
      this.backdrop.remove();
      this.backdrop = null;
    }
  }

  private getDiscoveredStats(): {
    unlockedSkins: Set<string>;
    unlockedCombos: Set<string>; // 'skinId:markingId'
    totalSkins: number;
    totalCombos: number;
    percent: number;
  } {
    const unlockedSkins = new Set<string>();
    const unlockedCombos = new Set<string>();

    for (const cat of this.state.cats) {
      if (cat.color) {
        unlockedSkins.add(cat.color);
        const pattern = cat.pattern || 'none';
        unlockedCombos.add(`${cat.color}:${pattern}`);
      }
    }

    let totalCombos = 0;
    for (const skin of CAT_SKINS) {
      const markings = this.getMarkingsForSkin(skin);
      totalCombos += markings.length;
    }

    const totalSkins = CAT_SKINS.length;
    const percent = Math.round((unlockedCombos.size / Math.max(1, totalCombos)) * 100);

    return {
      unlockedSkins,
      unlockedCombos,
      totalSkins,
      totalCombos,
      percent,
    };
  }

  private getMarkingsForSkin(skin: CatSkinDef): MarkingDef[] {
    if (skin.id.startsWith('hairless') || skin.id.startsWith('game_boy')) {
      return [CAT_MARKINGS[0]]; // 'none' (Natural solid pattern only)
    }
    return CAT_MARKINGS;
  }

  private render(modal: HTMLElement): void {
    const stats = this.getDiscoveredStats();

    modal.innerHTML = `
      <div class="glossary-header">
        <div class="glossary-title-row">
          <h2><span class="svg-inline">${SVG_ICONS.book}</span> Cat Coats & Markings Glossary</h2>
          <button class="modal-close-icon" id="glossary-x-btn" title="Close">${SVG_ICONS.close}</button>
        </div>
        <p class="glossary-subtitle">All cat coat options and their possible marking variations:</p>
        
        <div class="glossary-progress-card">
          <div class="glossary-progress-label-row">
            <span><b>Marking Variations Discovered:</b> ${stats.unlockedCombos.size} / ${stats.totalCombos} Combos</span>
            <span class="glossary-progress-pct">${stats.percent}% Collected</span>
          </div>
          <div class="progress-track glossary-track">
            <div class="progress-fill fill-affection" style="width: ${stats.percent}%;"></div>
          </div>
          <div class="glossary-stats-chips">
            <span class="glossary-chip">🐾 Coats: <b>${CAT_SKINS.length} Total</b></span>
            <span class="glossary-chip">🎨 Markings Found: <b>${stats.unlockedCombos.size}/${stats.totalCombos}</b></span>
          </div>
        </div>

        <div class="glossary-tabs">
          <button class="glossary-tab-btn ${this.currentTab === 'all' ? 'active' : ''}" data-tab="all">All Coats (${CAT_SKINS.length})</button>
          <button class="glossary-tab-btn ${this.currentTab === 'standard' ? 'active' : ''}" data-tab="standard">Cozy Standard (${CAT_SKINS.filter(s => !s.isRare).length})</button>
          <button class="glossary-tab-btn ${this.currentTab === 'rare' ? 'active' : ''}" data-tab="rare">Rare Breeds (${CAT_SKINS.filter(s => s.isRare).length})</button>
        </div>
      </div>

      <div class="glossary-cards-container" id="glossary-cards-container">
        ${this.renderCoatGroupsHtml(stats)}
      </div>

      <div class="glossary-footer">
        <button class="modal-close" id="glossary-close-btn">Done</button>
      </div>
    `;

    this.bindEvents(modal);
    this.drawAllPortraits(modal);

    // Scroll to target skin if requested
    if (this.targetScrollSkinId) {
      setTimeout(() => {
        const el = modal.querySelector(`[data-coat-group="${this.targetScrollSkinId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 50);
    }
  }

  private renderCoatGroupsHtml(stats: ReturnType<CatGlossaryModal['getDiscoveredStats']>): string {
    const groups: string[] = [];

    for (const skin of CAT_SKINS) {
      const isRare = !!skin.isRare;
      const markings = this.getMarkingsForSkin(skin);
      
      let unlockedMarkingsCount = 0;
      for (const m of markings) {
        if (stats.unlockedCombos.has(`${skin.id}:${m.id}`)) {
          unlockedMarkingsCount++;
        }
      }

      const isCompleted = unlockedMarkingsCount === markings.length;

      if (this.currentTab === 'standard' && isRare) continue;
      if (this.currentTab === 'rare' && !isRare) continue;

      const hexColor = `#${skin.hex.toString(16).padStart(6, '0')}`;
      const catsWithSkin = this.state.cats.filter((c) => c.color === skin.id);

      groups.push(`
        <div class="glossary-coat-group ${isRare ? 'rare-group' : ''}" style="border-left: 5px solid ${hexColor};" data-coat-group="${skin.id}">
          <!-- Base Coat Info Header -->
          <div class="glossary-coat-header">
            <div class="glossary-coat-preview-wrap">
              <canvas class="glossary-skin-canvas" data-skin-canvas="${skin.id}" width="48" height="48"></canvas>
            </div>
            <div class="glossary-coat-info">
              <div class="glossary-coat-title-row">
                <span class="glossary-coat-name">${escapeHtml(skin.label)}</span>
                ${isRare ? `<span class="glossary-tag rare-tag">✨ Rare Breed</span>` : `<span class="glossary-tag standard-tag">Cozy Coat</span>`}
                ${isCompleted ? `<span class="glossary-tag completed-tag">★ Completed</span>` : ''}
              </div>
              <div class="glossary-coat-desc">${escapeHtml(skin.description || 'A gentle, warm companion with a cozy patterned coat.')}</div>
            </div>
            <div class="glossary-coat-progress-pill">
              <span class="coat-progress-num"><b>${unlockedMarkingsCount}/${markings.length}</b></span>
              <span class="coat-progress-label">Markings Found</span>
              ${catsWithSkin.length > 0 ? `<span class="coat-sanctuary-count">(${catsWithSkin.length} in sanctuary)</span>` : ''}
            </div>
          </div>

          <!-- Marking Variation Portraits (Visible by default) -->
          <div class="glossary-markings-section">
            <div class="glossary-markings-grid">
              ${markings.map((m) => this.renderMarkingItemHtml(skin, m, stats)).join('')}
            </div>
          </div>
        </div>
      `);
    }

    if (groups.length === 0) {
      return `<div class="glossary-empty-msg">No cat coats found in this category.</div>`;
    }

    return groups.join('');
  }

  private renderMarkingItemHtml(
    skin: CatSkinDef,
    marking: MarkingDef,
    stats: ReturnType<CatGlossaryModal['getDiscoveredStats']>,
  ): string {
    const isUnlocked = stats.unlockedCombos.has(`${skin.id}:${marking.id}`);
    const catsWithCombo = this.state.cats.filter((c) => c.color === skin.id && (c.pattern || 'none') === marking.id);

    return `
      <div class="glossary-marking-card ${isUnlocked ? 'unlocked' : 'locked'}">
        <div class="glossary-marking-portrait-wrap">
          <canvas class="glossary-marking-canvas" data-skin="${skin.id}" data-marking="${marking.id}" data-unlocked="${isUnlocked ? 'true' : 'false'}" width="48" height="48"></canvas>
          ${!isUnlocked ? `<span class="glossary-lock-badge">🔒</span>` : ''}
        </div>
        <div class="glossary-marking-name"><b>${escapeHtml(marking.label || 'Solid Coat')}</b></div>
        <div class="glossary-marking-status ${isUnlocked ? 'status-unlocked' : 'status-locked'}">
          ${isUnlocked ? (catsWithCombo.length > 0 ? `✓ ${catsWithCombo.map(c=>c.name).slice(0,2).join(', ')}` : '✓ Unlocked') : '🔒 Locked'}
        </div>
      </div>
    `;
  }

  private bindEvents(modal: HTMLElement): void {
    modal.querySelector('#glossary-x-btn')?.addEventListener('click', () => {
      sound.playTap();
      this.close();
    });

    modal.querySelector('#glossary-close-btn')?.addEventListener('click', () => {
      sound.playTap();
      this.close();
    });

    modal.querySelectorAll('.glossary-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = (btn as HTMLElement).dataset.tab as GlossaryTab;
        if (tab && tab !== this.currentTab) {
          sound.playTap();
          this.currentTab = tab;
          this.targetScrollSkinId = null;
          this.render(modal);
        }
      });
    });
  }

  private drawAllPortraits(modal: HTMLElement): void {
    // 1. Draw All Coat Header Previews (Always full color)
    modal.querySelectorAll<HTMLCanvasElement>('canvas.glossary-skin-canvas').forEach((canvas) => {
      const skinId = canvas.dataset.skinCanvas;
      const skinDef = CAT_SKINS.find((s) => s.id === skinId);
      if (!skinDef) return;

      this.drawCatPortrait(canvas, skinDef, CAT_MARKINGS[0], true);
    });

    // 2. Draw Marking Dropdown Item Canvases
    modal.querySelectorAll<HTMLCanvasElement>('canvas.glossary-marking-canvas').forEach((canvas) => {
      const skinId = canvas.dataset.skin;
      const markingId = canvas.dataset.marking;
      const isUnlocked = canvas.dataset.unlocked === 'true';

      const skinDef = CAT_SKINS.find((s) => s.id === skinId);
      const markingDef = CAT_MARKINGS.find((m) => m.id === markingId) || CAT_MARKINGS[0];
      if (!skinDef) return;

      this.drawCatPortrait(canvas, skinDef, markingDef, isUnlocked);
    });
  }

  private drawCatPortrait(
    canvas: HTMLCanvasElement,
    skinDef: CatSkinDef,
    markingDef: MarkingDef,
    isUnlocked: boolean,
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const getOrLoad = (src: string, cb: (img: HTMLImageElement) => void) => {
      if (CatGlossaryModal.imageCache.has(src)) {
        const img = CatGlossaryModal.imageCache.get(src)!;
        if (img.complete && img.naturalWidth > 0) {
          cb(img);
        } else {
          img.addEventListener('load', () => cb(img), { once: true });
        }
      } else {
        const img = new Image();
        img.src = src;
        CatGlossaryModal.imageCache.set(src, img);
        img.addEventListener('load', () => cb(img), { once: true });
      }
    };

    const baseSrc = `assets/cats/${skinDef.file}`;
    getOrLoad(baseSrc, (baseImg) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Sitting / idle pose facing forward: sx=0, sy=32, width=32, height=32
      ctx.drawImage(baseImg, 0, 32, 32, 32, 0, 0, canvas.width, canvas.height);

      if (markingDef && markingDef.file) {
        const markSrc = `assets/cats/Markings/${encodeURIComponent(markingDef.file)}`;
        getOrLoad(markSrc, (markImg) => {
          ctx.drawImage(markImg, 0, 32, 32, 32, 0, 0, canvas.width, canvas.height);
          if (!isUnlocked) {
            this.applySilhouette(ctx, canvas);
          }
        });
      }

      if (!isUnlocked) {
        this.applySilhouette(ctx, canvas);
      }
    });
  }

  private applySilhouette(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(40, 30, 36, 0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
  }
}
