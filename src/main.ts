import Phaser from 'phaser';
import './ui/ui.css';
import { BootScene } from './scenes/BootScene';
import { SanctuaryScene } from './scenes/SanctuaryScene';
import { UIManager } from './ui/UIManager';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#eef7e6',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: [BootScene, SanctuaryScene],
  render: {
    pixelArt: true,
    roundPixels: true,
    antialias: false,
  },
};

new Phaser.Game(config);

const uiOverlay = document.getElementById('ui-overlay');
if (uiOverlay) {
  new UIManager(uiOverlay);
}
