import Phaser from 'phaser';
import './ui/ui.css';
import { BootScene } from './scenes/BootScene';
import { SanctuaryScene } from './scenes/SanctuaryScene';
import { UIManager } from './ui/UIManager';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#eef7e6',
  autoFocus: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  fps: {
    min: 30,
    target: 60,
    smoothStep: true,
  },
  scene: [BootScene, SanctuaryScene],
  render: {
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    transparent: false,
    powerPreference: 'high-performance',
    batchSize: 4096,
  },
};

const game = new Phaser.Game(config);

// Mobile & Tab Sleep Resumption Safeguards
const ensureGameRunning = () => {
  if (game && game.isPaused) {
    game.isPaused = false;
    game.events.emit(Phaser.Core.Events.RESUME);
  }
};

window.addEventListener('focus', ensureGameRunning);
window.addEventListener('pageshow', ensureGameRunning);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    ensureGameRunning();
  }
});

const uiOverlay = document.getElementById('ui-overlay');
if (uiOverlay) {
  new UIManager(uiOverlay);
}
