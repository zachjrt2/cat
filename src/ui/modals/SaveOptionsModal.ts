import { sound } from '../../systems/SoundManager';
import { SVG_ICONS } from '../icons';
import { EventBus } from '../EventBus';

export class SaveOptionsModal {
  static open(root: HTMLElement): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        sound.playTap();
        backdrop.remove();
      }
    });

    const modal = document.createElement('div');
    modal.className = 'modal options-modal';
    modal.innerHTML = `
      <h2>⚙️ Sanctuary Options & Sound</h2>
      <div class="subtitle">Thanks to <a href="https://pop-shop-packs.itch.io/" target="_blank" rel="noopener noreferrer">Pop shop</a> packs for the cats that inspired this game.</div>

      <!-- Sound Settings Section -->
      <div class="options-section">
        <h3>🔊 Audio Settings</h3>
        <div class="sound-controls-group">
          <div class="sound-control-row">
            <label class="sound-toggle-label">
              <input type="checkbox" id="sfx-toggle" ${sound.isSfxEnabled() ? 'checked' : ''}>
              <b>Sound Effects (SFX)</b>
            </label>
            <div class="sound-slider-wrap">
              <span>🔇</span>
              <input type="range" id="sfx-volume" min="0" max="100" value="${Math.round(sound.getSfxVolume() * 100)}" class="options-slider">
              <span>🔊</span>
              <span id="sfx-vol-label" class="vol-label">${Math.round(sound.getSfxVolume() * 100)}%</span>
            </div>
          </div>

          <div class="sound-control-row">
            <label class="sound-toggle-label">
              <input type="checkbox" id="music-toggle" ${sound.isMusicEnabled() ? 'checked' : ''}>
              <b>Background Music</b>
            </label>
            <div class="sound-slider-wrap">
              <span>🔇</span>
              <input type="range" id="music-volume" min="0" max="100" value="${Math.round(sound.getMusicVolume() * 100)}" class="options-slider">
              <span>🔊</span>
              <span id="music-vol-label" class="vol-label">${Math.round(sound.getMusicVolume() * 100)}%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Display & Screen Section -->
      <div class="options-section" style="margin-top: 14px;">
        <h3>📱 Display & Screen</h3>
        <div class="sound-control-row" style="align-items:center;">
          <label class="sound-toggle-label">
            <input type="checkbox" id="options-fs-toggle" ${Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement) ? 'checked' : ''}>
            <b>Fullscreen Mode</b>
          </label>
          <button class="options-fullscreen-btn" id="options-fs-btn" type="button">
            <span class="svg-inline">${Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement) ? SVG_ICONS.exitFullscreen : SVG_ICONS.fullscreen}</span>
            <span>${Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement) ? 'Exit' : 'Enter'}</span>
          </button>
        </div>
      </div>

      <!-- Ambience & Environment Section -->
      <div class="options-section" style="margin-top: 14px;">
        <h3>🌤️ Sanctuary Ambience</h3>
        <p style="font-size:12px;color:var(--brown-light);margin:2px 0 10px;">Time of day and weather cycle naturally, but you can also test or shift them manually here.</p>
        <div style="display:flex;gap:8px;">
          <button class="modal-action-btn" id="cycle-time-btn" style="flex:1;margin-bottom:0;" type="button">
            🕒 Shift Time
          </button>
          <button class="modal-action-btn" id="cycle-weather-btn" style="flex:1;margin-bottom:0;" type="button">
            🌦️ Shift Weather
          </button>
        </div>
      </div>

      <!-- Save & Backup Section -->
      <div class="options-section" style="margin-top: 14px;">
        <h3>💾 Save File & Backup</h3>
        <p style="font-size:12px;color:var(--brown-light);margin:2px 0 10px;">Progress automatically autosaves to your browser every 30 seconds.</p>
        <div class="options-btn-grid">
          <button class="modal-action-btn" id="export-btn">
            Download savegame.json
          </button>
          <label class="modal-action-btn import-btn-label">
            Import savegame.json
            <input type="file" accept="application/json" id="import-input" style="display:none;" />
          </label>
        </div>
      </div>

      <button class="modal-close" id="close-menu" style="margin-top:18px;">Done</button>
    `;

    const sfxToggle = modal.querySelector('#sfx-toggle') as HTMLInputElement;
    const sfxSlider = modal.querySelector('#sfx-volume') as HTMLInputElement;
    const sfxLabel = modal.querySelector('#sfx-vol-label') as HTMLElement;
    const musicToggle = modal.querySelector('#music-toggle') as HTMLInputElement;
    const musicSlider = modal.querySelector('#music-volume') as HTMLInputElement;
    const musicLabel = modal.querySelector('#music-vol-label') as HTMLElement;

    const optionsFsToggle = modal.querySelector('#options-fs-toggle') as HTMLInputElement | null;
    const optionsFsBtn = modal.querySelector('#options-fs-btn') as HTMLButtonElement | null;

    const handleFullscreenToggle = async () => {
      sound.playTap();
      try {
        if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
          if (document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen();
          } else if ((document.documentElement as any).webkitRequestFullscreen) {
            await (document.documentElement as any).webkitRequestFullscreen();
          }
        } else {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if ((document as any).webkitExitFullscreen) {
            await (document as any).webkitExitFullscreen();
          }
        }
      } catch (err) {
        console.warn('Fullscreen toggle:', err);
      }
      const isFull = Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
      if (optionsFsToggle) optionsFsToggle.checked = isFull;
      if (optionsFsBtn) {
        optionsFsBtn.innerHTML = `
          <span class="svg-inline">${isFull ? SVG_ICONS.exitFullscreen : SVG_ICONS.fullscreen}</span>
          <span>${isFull ? 'Exit' : 'Enter'}</span>
        `;
      }
    };

    optionsFsToggle?.addEventListener('change', handleFullscreenToggle);
    optionsFsBtn?.addEventListener('click', handleFullscreenToggle);

    sfxToggle.addEventListener('change', () => {
      sound.setSfxEnabled(sfxToggle.checked);
    });
    sfxSlider.addEventListener('input', () => {
      const v = parseInt(sfxSlider.value) / 100;
      sound.setSfxVolume(v);
      sfxLabel.textContent = `${sfxSlider.value}%`;
    });

    musicToggle.addEventListener('change', () => {
      sound.setMusicEnabled(musicToggle.checked);
    });
    musicSlider.addEventListener('input', () => {
      const v = parseInt(musicSlider.value) / 100;
      sound.setMusicVolume(v);
      musicLabel.textContent = `${musicSlider.value}%`;
    });

    modal.querySelector('#cycle-time-btn')?.addEventListener('click', () => {
      sound.playTap();
      EventBus.emit('toggle-time', {});
    });
    modal.querySelector('#cycle-weather-btn')?.addEventListener('click', () => {
      sound.playTap();
      EventBus.emit('toggle-weather', {});
    });

    modal.querySelector('#export-btn')!.addEventListener('click', () => {
      sound.playTap();
      EventBus.emit('export-save-requested', {});
    });
    modal.querySelector('#import-input')!.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        sound.playTap();
        EventBus.emit('import-save-requested', { file });
        backdrop.remove();
      }
    });
    modal.querySelector('#close-menu')!.addEventListener('click', () => {
      sound.playTap();
      backdrop.remove();
    });

    backdrop.appendChild(modal);
    root.appendChild(backdrop);
  }
}
