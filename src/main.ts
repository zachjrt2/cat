import Phaser from 'phaser';
import './ui/ui.css';
import splashUrl from './ui/splash.png';
import { BootScene } from './scenes/BootScene';
import { SanctuaryScene } from './scenes/SanctuaryScene';
import { UIManager } from './ui/UIManager';
import { EventBus } from './ui/EventBus';

// Initialize splash screen
const splashScreen = document.getElementById('splash-screen');
const splashLogo = document.getElementById('splash-logo') as HTMLImageElement | null;
if (splashLogo) {
  splashLogo.src = splashUrl;
}

const splashStartTime = Date.now();
let isGameReady = false;

function dismissSplash(): void {
  if (!splashScreen) return;
  const elapsed = Date.now() - splashStartTime;
  const remaining = Math.max(0, 1000 - elapsed);

  setTimeout(() => {
    splashScreen.classList.add('fade-out');
    setTimeout(() => {
      splashScreen.remove();
    }, 600);
  }, remaining);
}

EventBus.once('game-ready', () => {
  isGameReady = true;
  dismissSplash();
});

// Fallback in case event fires early or fails
setTimeout(() => {
  if (!isGameReady) {
    isGameReady = true;
    dismissSplash();
  }
}, 1200);

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
