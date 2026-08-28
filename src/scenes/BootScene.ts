import Phaser from 'phaser';
import { CAT_SKINS, CAT_MARKINGS } from '../data/catAssets';
import { EventBus } from '../ui/EventBus';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // 1. Load all 27 Cat Color Sheets (32x32 frames)
    for (const skin of CAT_SKINS) {
      this.load.spritesheet(`cat_${skin.id}`, `assets/cats/${skin.file}`, {
        frameWidth: 32,
        frameHeight: 32,
      });
    }

    // 2. Load all 14 Marking Overlays (32x32 frames)
    for (const marking of CAT_MARKINGS) {
      if (marking.file) {
        this.load.spritesheet(`marking_${marking.file}`, `assets/cats/Markings/${marking.file}`, {
          frameWidth: 32,
          frameHeight: 32,
        });
      }
    }
  }

  create(): void {
    // Pre-warm the starter coat animations immediately (takes <2ms)
    ensureSpriteAnimations(this.anims, 'cat_orange_0');
    ensureSpriteAnimations(this.anims, 'cat_grey_0');
    ensureSpriteAnimations(this.anims, 'cat_white_0');
    this.scene.start('Sanctuary');
    EventBus.emit('game-ready');
  }
}

const registeredTextures = new Set<string>();

export function ensureSpriteAnimations(anims: Phaser.Animations.AnimationManager, textureKey: string): void {
  if (registeredTextures.has(textureKey)) return;
  registeredTextures.add(textureKey);

  const colsPerRow = 32;

    // 8 directions: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW
    for (let dir = 0; dir < 8; dir++) {
      const rowTop = 1 + dir * 2;
      const rowBot = 2 + dir * 2;

      // 1a. Sit down transition (frames 0 -> 1 -> 2 -> 3)
      const sitDownAnimKey = `${textureKey}_sit_down_${dir}`;
      if (!anims.exists(sitDownAnimKey)) {
        anims.create({
          key: sitDownAnimKey,
          frames: anims.generateFrameNumbers(textureKey, {
            frames: [
              rowTop * colsPerRow + 0,
              rowTop * colsPerRow + 1,
              rowTop * colsPerRow + 2,
              rowTop * colsPerRow + 3,
            ],
          }),
          frameRate: 6,
          repeat: 0,
        });
      }

      // 1b. Sit idle loop (alternates between the last two frames in the sequence)
      const sitAnimKey = `${textureKey}_sit_${dir}`;
      if (!anims.exists(sitAnimKey)) {
        anims.create({
          key: sitAnimKey,
          frames: anims.generateFrameNumbers(textureKey, {
            frames: [
              rowBot * colsPerRow + 0,
              rowBot * colsPerRow + 1,
            ],
          }),
          frameRate: 2,
          repeat: -1,
        });
      }

      // 2. Look around (curious)
      const lookAnimKey = `${textureKey}_look_${dir}`;
      if (!anims.exists(lookAnimKey)) {
        anims.create({
          key: lookAnimKey,
          frames: anims.generateFrameNumbers(textureKey, {
            frames: [
              rowTop * colsPerRow + 4,
              rowTop * colsPerRow + 5,
              rowTop * colsPerRow + 6,
              rowTop * colsPerRow + 7,
              rowTop * colsPerRow + 6,
              rowTop * colsPerRow + 5,
            ],
          }),
          frameRate: 3.5,
          repeat: -1,
        });
      }

      // 3. Lay down (relaxed)
      const layAnimKey = `${textureKey}_lay_${dir}`;
      if (!anims.exists(layAnimKey)) {
        anims.create({
          key: layAnimKey,
          frames: anims.generateFrameNumbers(textureKey, {
            frames: [
              rowTop * colsPerRow + 8,
              rowTop * colsPerRow + 9,
              rowTop * colsPerRow + 10,
              rowTop * colsPerRow + 11,
            ],
          }),
          frameRate: 3,
          repeat: -1,
        });
      }

      // 4. Sleep (curled sleeping breathing loop)
      const sleepAnimKey = `${textureKey}_sleep_${dir}`;
      if (!anims.exists(sleepAnimKey)) {
        anims.create({
          key: sleepAnimKey,
          frames: anims.generateFrameNumbers(textureKey, {
            frames: [
              rowBot * colsPerRow + 8,
              rowBot * colsPerRow + 9,
              rowBot * colsPerRow + 10,
              rowBot * colsPerRow + 11,
              rowBot * colsPerRow + 10,
              rowBot * colsPerRow + 9,
            ],
          }),
          frameRate: 2,
          repeat: -1,
        });
      }

      // 5. Walk (4 frames wander loop)
      const walkAnimKey = `${textureKey}_walk_${dir}`;
      if (!anims.exists(walkAnimKey)) {
        anims.create({
          key: walkAnimKey,
          frames: anims.generateFrameNumbers(textureKey, {
            frames: [
              rowTop * colsPerRow + 12,
              rowTop * colsPerRow + 13,
              rowTop * colsPerRow + 14,
              rowTop * colsPerRow + 15,
            ],
          }),
          frameRate: 6,
          repeat: -1,
        });
      }

      // 6. Run (Zoomies fast cycle)
      const runAnimKey = `${textureKey}_run_${dir}`;
      if (!anims.exists(runAnimKey)) {
        anims.create({
          key: runAnimKey,
          frames: anims.generateFrameNumbers(textureKey, {
            frames: [
              rowTop * colsPerRow + 20,
              rowTop * colsPerRow + 21,
              rowTop * colsPerRow + 22,
              rowTop * colsPerRow + 23,
              rowBot * colsPerRow + 20,
              rowBot * colsPerRow + 21,
              rowBot * colsPerRow + 22,
              rowBot * colsPerRow + 23,
            ],
          }),
          frameRate: 10,
          repeat: -1,
        });
      }

      // 7. Play (Toy interaction)
      const playAnimKey = `${textureKey}_play_${dir}`;
      if (!anims.exists(playAnimKey)) {
        anims.create({
          key: playAnimKey,
          frames: anims.generateFrameNumbers(textureKey, {
            frames: [
              rowTop * colsPerRow + 16,
              rowTop * colsPerRow + 17,
              rowTop * colsPerRow + 18,
              rowTop * colsPerRow + 19,
              rowTop * colsPerRow + 5,
              rowTop * colsPerRow + 6,
            ],
          }),
          frameRate: 7,
          repeat: -1,
        });
      }

      // 8. Pounce (Leap attack: 3rd frame start/prep, 4th/5th ascent, 1st descent, 2nd landing)
      const pounceAnimKey = `${textureKey}_pounce_${dir}`;
      if (!anims.exists(pounceAnimKey)) {
        anims.create({
          key: pounceAnimKey,
          frames: anims.generateFrameNumbers(textureKey, {
            frames: [
              rowTop * colsPerRow + 22, // 3rd running frame: start crouch prep
              rowTop * colsPerRow + 23, // 4th running frame: ascent launch
              rowBot * colsPerRow + 20, // 5th running frame: ascent apex
              rowTop * colsPerRow + 20, // 1st running frame: descent
              rowTop * colsPerRow + 21, // 2nd running frame: landing impact
            ],
          }),
          frameRate: 7,
          repeat: 0,
        });
      }

      const pouncePrepKey = `${textureKey}_pounce_prep_${dir}`;
      if (!anims.exists(pouncePrepKey)) {
        anims.create({
          key: pouncePrepKey,
          frames: anims.generateFrameNumbers(textureKey, {
            frames: [rowTop * colsPerRow + 22],
          }),
          frameRate: 1,
          repeat: -1,
        });
      }

      const pounceAscentKey = `${textureKey}_pounce_ascent_${dir}`;
      if (!anims.exists(pounceAscentKey)) {
        anims.create({
          key: pounceAscentKey,
          frames: anims.generateFrameNumbers(textureKey, {
            frames: [rowTop * colsPerRow + 23, rowBot * colsPerRow + 20],
          }),
          frameRate: 8,
          repeat: -1,
        });
      }

      const pounceDescentKey = `${textureKey}_pounce_descent_${dir}`;
      if (!anims.exists(pounceDescentKey)) {
        anims.create({
          key: pounceDescentKey,
          frames: anims.generateFrameNumbers(textureKey, {
            frames: [rowTop * colsPerRow + 20],
          }),
          frameRate: 1,
          repeat: -1,
        });
      }

      const pounceLandKey = `${textureKey}_pounce_land_${dir}`;
      if (!anims.exists(pounceLandKey)) {
        anims.create({
          key: pounceLandKey,
          frames: anims.generateFrameNumbers(textureKey, {
            frames: [rowTop * colsPerRow + 21],
          }),
          frameRate: 1,
          repeat: -1,
        });
      }
    }
  }
