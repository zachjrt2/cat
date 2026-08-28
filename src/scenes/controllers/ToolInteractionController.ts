import Phaser from 'phaser';
import type { Cat, ToolType } from '../../data/types';
import { CatSprite } from '../../entities/CatSprite';
import { ToyBall } from '../../entities/ToyBall';
import { KibbleBag, KibblePiece } from '../../entities/KibbleBag';
import { GrowthSystem } from '../../systems/GrowthSystem';
import { InteractionSystem } from '../../systems/InteractionSystem';
import { LoveManager } from '../../systems/LoveManager';
import { sound } from '../../systems/SoundManager';
import { EventBus } from '../../ui/EventBus';

export interface ToolControllerCallbacks {
  getWalkableBounds: () => Phaser.Geom.Rectangle;
  getCatSprites: () => Map<string, CatSprite>;
  saveGame: () => void;
  notifyUi: () => void;
}

export class ToolInteractionController {
  private selectedTool: ToolType | null = null;
  private toyBall: ToyBall | null = null;
  private kibbleBag: KibbleBag | null = null;
  private kibblePieces: KibblePiece[] = [];
  private washBrushFollower: Phaser.GameObjects.Container | null = null;

  private lastPetLoveTime = 0;
  private lastWashLoveTime = 0;
  private lastBubbleSpawnTime = 0;
  private kibbleSearchTimer = 0;

  constructor(
    private scene: Phaser.Scene,
    private love: LoveManager,
    private growth: GrowthSystem,
    private interactions: InteractionSystem,
    private callbacks: ToolControllerCallbacks,
  ) {}

  setSelectedTool(tool: ToolType | null): void {
    this.selectedTool = tool;
    if (this.selectedTool) sound.playTap();

    const catSprites = this.callbacks.getCatSprites();
    for (const sprite of catSprites.values()) {
      sprite.setSelectedTool(this.selectedTool);
    }

    if (this.selectedTool === 'food') {
      if (!this.kibbleBag) {
        const bounds = this.callbacks.getWalkableBounds();
        this.kibbleBag = new KibbleBag(this.scene, bounds.centerX, bounds.centerY, bounds);
        this.kibbleBag.onDropFood = (x, y) => this.spawnKibblePiece(x, y);
        this.kibbleBag.setScale(0);
        this.scene.tweens.add({
          targets: this.kibbleBag,
          scaleX: 1,
          scaleY: 1,
          duration: 250,
          ease: 'Back.easeOut',
        });
        sound.playPop();
        EventBus.emit('toast', { message: '🥣 Kibble Bag ready! Drag it around to drop food for hungry cats!' });
      }
    } else {
      if (this.kibbleBag) {
        this.scene.tweens.add({
          targets: this.kibbleBag,
          scaleX: 0,
          scaleY: 0,
          alpha: 0,
          duration: 150,
          ease: 'Quad.easeIn',
          onComplete: () => {
            this.kibbleBag?.destroy();
            this.kibbleBag = null;
          },
        });
      }
    }

    if (this.selectedTool === 'toy') {
      if (!this.toyBall) {
        const bounds = this.callbacks.getWalkableBounds();
        this.toyBall = new ToyBall(this.scene, bounds.centerX, bounds.centerY, bounds);
        this.toyBall.setScale(0);
        this.scene.tweens.add({
          targets: this.toyBall,
          scaleX: 1,
          scaleY: 1,
          duration: 250,
          ease: 'Back.easeOut',
        });
        sound.playPop();
        EventBus.emit('toast', { message: '🧶 Threw a Toy Ball! Drag and toss it around for cats to chase!' });
      }
    } else {
      if (this.toyBall) {
        const dyingToy = this.toyBall;
        this.toyBall = null;
        for (const sprite of catSprites.values()) {
          sprite.clearChaseTarget();
        }
        this.scene.tweens.add({
          targets: dyingToy,
          scaleX: 0,
          scaleY: 0,
          alpha: 0,
          duration: 150,
          ease: 'Quad.easeIn',
          onComplete: () => {
            dyingToy.destroy();
          },
        });
      }
    }

    if (this.selectedTool === 'wash') {
      if (!this.washBrushFollower) {
        const container = this.scene.add.container(400, 300);
        container.setDepth(99999);

        const gfx = this.scene.add.graphics();
        gfx.fillStyle(0xd4a373, 1);
        gfx.fillRoundedRect(-6, -28, 12, 22, 4);
        gfx.fillStyle(0xbc6c25, 1);
        gfx.fillCircle(0, -22, 3);

        gfx.fillStyle(0x48cae4, 0.95);
        gfx.fillRoundedRect(-16, -6, 32, 20, 7);
        gfx.fillStyle(0x90e0ef, 1);
        gfx.fillRoundedRect(-14, -4, 28, 16, 5);

        gfx.fillStyle(0xffffff, 0.95);
        gfx.fillCircle(-10, 14, 5);
        gfx.fillCircle(-4, 15, 6);
        gfx.fillCircle(4, 15, 6);
        gfx.fillCircle(10, 14, 5);

        gfx.fillStyle(0x72efdd, 0.85);
        gfx.fillCircle(12, -8, 4);
        gfx.fillStyle(0xffffff, 0.95);
        gfx.fillCircle(11, -9, 1.5);

        container.add(gfx);
        container.setScale(1.25);
        this.washBrushFollower = container;

        EventBus.emit('toast', { message: '🫧 Wash brush active! Drag it over cats to scrub and clean them!' });
      }
    } else {
      if (this.washBrushFollower) {
        this.washBrushFollower.destroy();
        this.washBrushFollower = null;
      }
    }
  }

  getSelectedTool(): ToolType | null {
    return this.selectedTool;
  }

  getToyBall(): ToyBall | null {
    return this.toyBall;
  }

  getKibbleBag(): KibbleBag | null {
    return this.kibbleBag;
  }

  spawnKibblePiece(targetX: number, targetY: number, fromX?: number, fromY?: number): void {
    const startX = fromX ?? (this.kibbleBag ? this.kibbleBag.x : targetX);
    const startY = fromY ?? (this.kibbleBag ? this.kibbleBag.y - 14 : targetY - 10);

    if (this.kibblePieces.length >= 30) {
      const oldest = this.kibblePieces.shift();
      oldest?.despawn();
    }

    const piece = new KibblePiece(this.scene, startX, startY, targetX, targetY);
    this.kibblePieces.push(piece);
  }

  onScenePointerMove(pointer: Phaser.Input.Pointer, animTimer: number): void {
    if (this.washBrushFollower) {
      this.washBrushFollower.setPosition(pointer.worldX, pointer.worldY);
      if (pointer.isDown || Math.hypot(pointer.velocity.x, pointer.velocity.y) > 15) {
        this.washBrushFollower.rotation = Math.sin(animTimer * 16) * 0.22;
      } else {
        this.washBrushFollower.rotation = 0;
      }
    }

    const catSprites = this.callbacks.getCatSprites();

    // Pet tool active drag
    if (this.selectedTool === 'pet' && pointer.isDown) {
      const px = pointer.worldX;
      const py = pointer.worldY;
      const now = this.scene.time.now;

      if (!this.lastPetLoveTime || now - this.lastPetLoveTime > 120) {
        let pettedAny = false;
        for (const sprite of catSprites.values()) {
          if (sprite.isCurrentlyDragged()) continue;
          const dist = Phaser.Math.Distance.Between(px, py, sprite.x, sprite.y);
          if (dist < 85) {
            pettedAny = true;
            const wasNeedy = sprite.cat.affection < 98;
            sprite.cat.affection = Math.min(100, sprite.cat.affection + 4.0);
            sprite.cat.happiness = Math.min(100, sprite.cat.happiness + 1.2);
            sprite.cat.energy = Math.min(100, sprite.cat.energy + 0.4);

            sprite.triggerLayDown(5.5);
            this.spawnPetHeart(sprite.x, sprite.y - 10);

            if (wasNeedy) {
              this.love.add(2);
              this.growth.addGrowth(sprite.cat, 1);
              EventBus.emit('love-changed', { love: this.love.love });
            }

            sprite.showEmote(wasNeedy ? '❤️' : '🥰');
            sprite.refreshVisuals();
          }
        }

        if (pettedAny) {
          this.lastPetLoveTime = now;
          sound.playPurr();
          this.callbacks.notifyUi();
        }
      }
    }

    // Wash tool active drag
    if (this.selectedTool === 'wash') {
      const px = pointer.worldX;
      const py = pointer.worldY;
      const now = this.scene.time.now;
      const dt = Math.max(0.016, (this.scene.game.loop.delta || 16) / 1000);

      for (const sprite of catSprites.values()) {
        if (sprite.isCurrentlyDragged()) continue;
        const dist = Phaser.Math.Distance.Between(px, py, sprite.x, sprite.y);

        if (dist < 55) {
          this.spawnSoapBubbles(px, py);

          const wasDirty = sprite.cat.cleanliness < 98;
          sprite.cat.cleanliness = Math.min(100, sprite.cat.cleanliness + 34 * dt);
          sprite.cat.happiness = Math.min(100, sprite.cat.happiness + 0.5 * dt);

          if (wasDirty && (!this.lastWashLoveTime || now - this.lastWashLoveTime > 450)) {
            this.lastWashLoveTime = now;
            this.love.add(2);
            this.growth.addGrowth(sprite.cat, 1);
            EventBus.emit('love-changed', { love: this.love.love });
            sound.playBubble();
            sprite.showEmote('🫧');
          }

          sprite.refreshVisuals();
          this.callbacks.notifyUi();
        }
      }
    }
  }

  interactWithCat(cat: Cat, sprite: CatSprite, tool: ToolType): void {
    const result = this.interactions.applyTool(cat, tool);
    if (result.loveEarned > 0) {
      this.growth.addGrowth(cat, 10);
    }

    if (tool === 'pet') {
      sound.playPurr();
      sprite.showEmote(result.loveEarned > 0 ? '❤️' : '🥰');
      sprite.triggerLayDown(6.0);
      this.spawnPetHeart(sprite.x, sprite.y - 12);
    } else if (tool === 'food') {
      sound.playCrunch();
      sprite.showEmote(result.loveEarned > 0 ? '🐟' : '😋');
      sprite.triggerPlayState(1.5);
      this.spawnKibblePiece(sprite.x, sprite.y + 10, sprite.x, sprite.y - 25);
    } else if (tool === 'toy') {
      sound.playPop();
      sprite.showEmote(result.loveEarned > 0 ? '🧶' : '😺');
      sprite.triggerPlayState(2.5);
    } else if (tool === 'wash') {
      sound.playBubble();
      sprite.showEmote('🫧');
      this.spawnSoapBubbles(sprite.x, sprite.y);
    }

    sprite.refreshVisuals();
    const toastMsg = result.loveEarned > 0
      ? `${result.message} (+${result.loveEarned} 💗)`
      : result.message;
    EventBus.emit('toast', { message: toastMsg });
    EventBus.emit('love-changed', { love: this.love.love });

    this.callbacks.saveGame();
    this.callbacks.notifyUi();
  }

  update(deltaSeconds: number): void {
    if (this.toyBall && this.toyBall.active) {
      this.toyBall.update(deltaSeconds);
    }
    if (this.kibbleBag && this.kibbleBag.active) {
      this.kibbleBag.update();
    }

    this.updateKibblePieces(deltaSeconds);
  }

  private updateKibblePieces(deltaSeconds: number): void {
    this.kibbleSearchTimer += deltaSeconds;
    const shouldRecalculateTarget = this.kibbleSearchTimer >= 0.25;
    if (shouldRecalculateTarget) {
      this.kibbleSearchTimer = 0;
    }

    const catSprites = this.callbacks.getCatSprites();

    for (let i = this.kibblePieces.length - 1; i >= 0; i--) {
      const piece = this.kibblePieces[i];
      if (!piece.active) {
        this.kibblePieces.splice(i, 1);
        continue;
      }
    }

    if (this.kibblePieces.length > 0) {
      for (const sprite of catSprites.values()) {
        if (!sprite.active || sprite.isCurrentlyDragged() || sprite.cat.animationState === 'sleep') continue;

        let nearestPiece: KibblePiece | null = null;
        let minDist = 999999;

        for (const piece of this.kibblePieces) {
          if (!piece.active || piece.isEaten) continue;
          const d = Phaser.Math.Distance.Between(sprite.x, sprite.y, piece.x, piece.y);
          if (d < minDist) {
            minDist = d;
            nearestPiece = piece;
          }
        }

        if (nearestPiece) {
          if (minDist <= 24) {
            nearestPiece.eat();
            sound.playCrunch();

            const wasVeryHungry = sprite.cat.hunger < 50;
            sprite.cat.hunger = Math.min(100, sprite.cat.hunger + 32);
            sprite.cat.happiness = Math.min(100, sprite.cat.happiness + 8);
            sprite.cat.affection = Math.min(100, sprite.cat.affection + 4);
            this.growth.addGrowth(sprite.cat, 6);

            this.love.add(3);
            EventBus.emit('love-changed', { love: this.love.love });

            sprite.triggerPlayState(1.4);
            sprite.showEmote(wasVeryHungry ? '🐟' : '😋');
            sprite.refreshVisuals();
            this.callbacks.notifyUi();
          } else if (minDist <= 55 && !sprite.isPounceActive() && Math.random() < 0.45) {
            const targetPiece = nearestPiece;
            sprite.clearChaseTarget();
            sprite.executePounce(targetPiece.x, targetPiece.y, () => {
              if (targetPiece.active && !targetPiece.isEaten) {
                targetPiece.eat();
                sound.playCrunch();

                const wasVeryHungry = sprite.cat.hunger < 50;
                sprite.cat.hunger = Math.min(100, sprite.cat.hunger + 32);
                sprite.cat.happiness = Math.min(100, sprite.cat.happiness + 8);
                sprite.cat.affection = Math.min(100, sprite.cat.affection + 4);
                this.growth.addGrowth(sprite.cat, 6);

                this.love.add(3);
                EventBus.emit('love-changed', { love: this.love.love });

                sprite.triggerPlayState(1.4);
                sprite.showEmote(wasVeryHungry ? '🐟' : '😋');
                sprite.refreshVisuals();
                this.callbacks.notifyUi();
              }
            });
          } else if (shouldRecalculateTarget && minDist < 650 && !sprite.isPounceActive()) {
            sprite.setChaseTarget(nearestPiece.x, nearestPiece.y);
          }
        }
      }
    }
  }

  private spawnPetHeart(x: number, y: number): void {
    const emojis = ['❤️', '💖', '💕', '✨', '🐾'];
    const emoji = emojis[Phaser.Math.Between(0, emojis.length - 1)];
    const text = this.scene.add.text(
      x + Phaser.Math.Between(-12, 12),
      y + Phaser.Math.Between(-8, 8),
      emoji,
      { fontSize: `${Phaser.Math.Between(16, 22)}px` },
    ).setOrigin(0.5).setDepth(y + 150);

    this.scene.tweens.add({
      targets: text,
      y: text.y - Phaser.Math.Between(28, 48),
      x: text.x + Phaser.Math.Between(-10, 10),
      alpha: { from: 1, to: 0 },
      scale: { from: 0.7, to: 1.25 },
      duration: 650,
      ease: 'Cubic.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  private spawnSoapBubbles(x: number, y: number): void {
    if (this.lastBubbleSpawnTime && this.scene.time.now - this.lastBubbleSpawnTime < 50) return;
    this.lastBubbleSpawnTime = this.scene.time.now;

    for (let i = 0; i < 2; i++) {
      const bubble = this.scene.add.graphics();
      const r = Phaser.Math.Between(4, 10);
      const offsetX = Phaser.Math.Between(-14, 14);
      const offsetY = Phaser.Math.Between(-12, 12);

      bubble.setPosition(x + offsetX, y + offsetY);
      bubble.setDepth(y + 120);

      bubble.fillStyle(0x70d6ff, 0.45);
      bubble.fillCircle(0, 0, r);
      bubble.lineStyle(1.5, 0xff99c8, 0.75);
      bubble.strokeCircle(0, 0, r);
      bubble.fillStyle(0xffffff, 0.85);
      bubble.fillCircle(-r * 0.35, -r * 0.35, r * 0.28);

      this.scene.tweens.add({
        targets: bubble,
        y: bubble.y - Phaser.Math.Between(25, 50),
        x: bubble.x + Phaser.Math.Between(-12, 12),
        alpha: { from: 0.9, to: 0 },
        scaleX: { from: 0.7, to: 1.25 },
        scaleY: { from: 0.7, to: 1.25 },
        duration: Phaser.Math.Between(400, 650),
        ease: 'Cubic.easeOut',
        onComplete: () => bubble.destroy(),
      });
    }
  }

  onAreaSwitched(newAreaWalkable: Phaser.Geom.Rectangle): void {
    if (this.toyBall) {
      this.toyBall.setBounds(newAreaWalkable);
      this.toyBall.setPosition(newAreaWalkable.centerX, newAreaWalkable.centerY);
      this.toyBall.vx = 0;
      this.toyBall.vy = 0;
    }

    if (this.kibbleBag) {
      this.kibbleBag.setBounds(newAreaWalkable);
      this.kibbleBag.setPosition(newAreaWalkable.centerX, newAreaWalkable.centerY);
    }
    for (const piece of this.kibblePieces) {
      piece.destroy();
    }
    this.kibblePieces = [];
  }
}
