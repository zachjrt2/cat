import Phaser from 'phaser';
import type { Cat, ToolType } from '../../data/types';
import { CatSprite } from '../../entities/CatSprite';
import { ToyBall } from '../../entities/ToyBall';
import { KibbleBag, KibblePiece } from '../../entities/KibbleBag';
import { GrowthSystem } from '../../systems/GrowthSystem';
import { InteractionSystem } from '../../systems/InteractionSystem';
import { LoveManager } from '../../systems/LoveManager';
import { sound } from '../../systems/SoundManager';
import { EventBus, isAnyModalOpen } from '../../ui/EventBus';

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
  private lastPointerX = 0;
  private lastPointerY = 0;
  private isPointerDown = false;
  private uiNotifyCooldown = 0;

  constructor(
    private scene: Phaser.Scene,
    private love: LoveManager,
    private growth: GrowthSystem,
    private interactions: InteractionSystem,
    private callbacks: ToolControllerCallbacks,
  ) {}

  setSelectedTool(tool: ToolType | null): void {
    const wasToolActive = this.selectedTool !== null;
    this.selectedTool = tool;
    if (this.selectedTool) sound.playTap();

    const catSprites = this.callbacks.getCatSprites();
    for (const sprite of catSprites.values()) {
      sprite.setSelectedTool(this.selectedTool);
    }

    if (wasToolActive && !this.selectedTool) {
      // Signal all cats to resume natural wandering AI
      for (const sprite of catSprites.values()) {
        sprite.resumeNormalBehavior();
      }
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
      if (this.kibblePieces.length > 0) {
        for (const piece of this.kibblePieces) {
          piece.destroy();
        }
        this.kibblePieces = [];
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

        // 1. Natural Hardwood Base Block (Horizontal)
        gfx.fillStyle(0x7f4f24, 1); // Drop shadow base
        gfx.fillRoundedRect(-24, -8, 48, 14, 4);

        gfx.fillStyle(0xbc6c25, 1); // Warm hardwood block
        gfx.fillRoundedRect(-24, -11, 48, 13, 4);

        gfx.fillStyle(0xdda15e, 1); // Top highlight bevel
        gfx.fillRoundedRect(-22, -11, 44, 3.5, 2);

        // 2. Curved Ergonomic Grip Handle on top
        gfx.fillStyle(0x583110, 1); // Grip shadow
        gfx.fillRoundedRect(-15, -19, 30, 9, 4);
        gfx.fillStyle(0xd4a373, 1); // Grip bar
        gfx.fillRoundedRect(-14, -19, 28, 7, 3);
        gfx.fillStyle(0xfaedcd, 1); // Grip highlight
        gfx.fillRoundedRect(-12, -19, 24, 2.5, 1);

        // 3. Dense Vertical Scrub Bristles
        gfx.fillStyle(0xfaedcd, 1); // Bristle bed
        gfx.fillRect(-22, 2, 44, 9);

        gfx.fillStyle(0xd4a373, 0.95);
        for (let bx = -21; bx <= 21; bx += 3) {
          gfx.fillRect(bx, 2, 1.5, 9);
        }

        // 4. Frothy Soap Bubbles & Suds on bristles
        gfx.fillStyle(0xffffff, 0.95);
        gfx.fillCircle(-18, 11, 4);
        gfx.fillCircle(-10, 12, 5);
        gfx.fillCircle(-2, 11.5, 4.5);
        gfx.fillCircle(6, 12, 5);
        gfx.fillCircle(14, 11, 4);
        gfx.fillCircle(20, 10, 3);

        gfx.fillStyle(0x90e0ef, 0.85);
        gfx.fillCircle(-12, 14, 2.5);
        gfx.fillCircle(2, 14, 3);
        gfx.fillCircle(16, 13, 2.5);

        gfx.fillStyle(0xffffff, 1);
        gfx.fillCircle(-1, 10, 1.5);
        gfx.fillCircle(7, 11, 1.5);

        container.add(gfx);
        container.setScale(1.2);
        this.washBrushFollower = container;
      }
      this.washBrushFollower.setVisible(true);
    } else {
      if (this.washBrushFollower) {
        this.washBrushFollower.setVisible(false);
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

    if (this.kibblePieces.length >= 24) {
      const oldest = this.kibblePieces.shift();
      oldest?.despawn();
    }

    const piece = new KibblePiece(this.scene, startX, startY, targetX, targetY);
    this.kibblePieces.push(piece);
  }

  onScenePointerMove(pointer: Phaser.Input.Pointer, animTimer: number): void {
    if (isAnyModalOpen()) {
      if (this.washBrushFollower) this.washBrushFollower.setVisible(false);
      return;
    }

    this.lastPointerX = pointer.worldX;
    this.lastPointerY = pointer.worldY;
    this.isPointerDown = pointer.isDown;

    if (this.washBrushFollower) {
      if (this.selectedTool === 'wash') {
        this.washBrushFollower.setVisible(true);
        this.washBrushFollower.setPosition(pointer.worldX, pointer.worldY);
        if (pointer.isDown || Math.hypot(pointer.velocity.x, pointer.velocity.y) > 15) {
          this.washBrushFollower.rotation = Math.sin(animTimer * 16) * 0.22;
        } else {
          this.washBrushFollower.rotation = 0;
        }
      } else {
        this.washBrushFollower.setVisible(false);
      }
    }
  }

  interactWithCat(cat: Cat, sprite: CatSprite, tool: ToolType): void {
    if (isAnyModalOpen()) return;
    const result = this.interactions.applyTool(cat, tool);
    if (result.loveEarned > 0) {
      this.growth.addGrowth(cat, 10);
    }

    if (tool === 'pet') {
      sound.playPurr();
      sprite.showEmote(result.loveEarned > 0 ? '❤️' : '🥰');
      sprite.triggerKneadBiscuits(6.0);
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

      // Small AOE splash: clean any nearby cats within 115px
      const catSprites = this.callbacks.getCatSprites();
      const splash2 = 115 * 115;
      for (const otherSprite of catSprites.values()) {
        if (otherSprite !== sprite && otherSprite.active && !otherSprite.isCurrentlyDragged()) {
          const dx = sprite.x - otherSprite.x;
          const dy = sprite.y - otherSprite.y;
          if (dx * dx + dy * dy <= splash2) {
            otherSprite.cat.cleanliness = Math.min(100, otherSprite.cat.cleanliness + 45);
            otherSprite.showEmote('🫧');
            this.spawnSoapBubbles(otherSprite.x, otherSprite.y);
            otherSprite.refreshVisuals();
          }
        }
      }
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
    this.updateToolInteractions(deltaSeconds);
  }

  private updateToolInteractions(dt: number): void {
    if (isAnyModalOpen() || !this.selectedTool) return;
    if (this.selectedTool !== 'pet' && this.selectedTool !== 'wash') return;

    this.uiNotifyCooldown -= dt;
    const catSprites = this.callbacks.getCatSprites();
    const px = this.lastPointerX;
    const py = this.lastPointerY;
    const now = this.scene.time.now;
    let shouldNotifyUi = false;

    // Pet tool active drag
    if (this.selectedTool === 'pet' && this.isPointerDown) {
      if (!this.lastPetLoveTime || now - this.lastPetLoveTime > 120) {
        let pettedAny = false;
        const petRadius2 = 85 * 85;

        for (const sprite of catSprites.values()) {
          if (sprite.isCurrentlyDragged()) continue;
          const dx = px - sprite.x;
          const dy = py - sprite.y;
          if (dx * dx + dy * dy < petRadius2) {
            pettedAny = true;
            const wasNeedy = sprite.cat.affection < 98;
            sprite.cat.affection = Math.min(100, sprite.cat.affection + 4.0);
            sprite.cat.happiness = Math.min(100, sprite.cat.happiness + 1.2);
            sprite.cat.energy = Math.min(100, sprite.cat.energy + 0.4);

            sprite.triggerKneadBiscuits(5.5);
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
          shouldNotifyUi = true;
        }
      }
    }

    // Wash tool active: cats autonomously flee and get scrubbed in a small AOE
    if (this.selectedTool === 'wash') {
      const fleeRadius2 = 135 * 135;
      const scrubRadius2 = 115 * 115;

      for (const sprite of catSprites.values()) {
        if (sprite.isCurrentlyDragged() || sprite.cat.animationState === 'sleep') continue;
        const dx = px - sprite.x;
        const dy = py - sprite.y;
        const d2 = dx * dx + dy * dy;

        // Autonomous fleeing: cats spot the brush and sprint away on their own!
        if (d2 < fleeRadius2) {
          sprite.triggerFleeFromBrush(px, py);
        }

        // Active scrubbing contact with a generous small AOE radius (115px) & faster cleaning
        if (this.isPointerDown && d2 < scrubRadius2) {
          this.spawnSoapBubbles(sprite.x + Phaser.Math.Between(-14, 14), sprite.y + Phaser.Math.Between(-10, 10));

          const wasDirty = sprite.cat.cleanliness < 98;
          sprite.cat.cleanliness = Math.min(100, sprite.cat.cleanliness + 85 * dt);
          sprite.cat.happiness = Math.min(100, sprite.cat.happiness + 1.8 * dt);

          if (wasDirty && (!this.lastWashLoveTime || now - this.lastWashLoveTime > 260)) {
            this.lastWashLoveTime = now;
            this.love.add(3);
            this.growth.addGrowth(sprite.cat, 2);
            EventBus.emit('love-changed', { love: this.love.love });
            sound.playBubble();
            sprite.showEmote('🫧');
          }

          sprite.refreshVisuals();
          shouldNotifyUi = true;
        }
      }
    }

    if (shouldNotifyUi && this.uiNotifyCooldown <= 0) {
      this.uiNotifyCooldown = 0.28;
      this.callbacks.notifyUi();
    }
  }

  private updateKibblePieces(deltaSeconds: number): void {
    if (this.kibblePieces.length === 0) return;

    for (let i = this.kibblePieces.length - 1; i >= 0; i--) {
      const piece = this.kibblePieces[i];
      if (!piece.active) {
        this.kibblePieces.splice(i, 1);
      }
    }

    if (this.kibblePieces.length === 0) return;

    this.kibbleSearchTimer += deltaSeconds;
    const shouldRecalculateTarget = this.kibbleSearchTimer >= 0.25;
    if (shouldRecalculateTarget) {
      this.kibbleSearchTimer = 0;
    }

    const catSprites = this.callbacks.getCatSprites();
    const eatRadius2 = 24 * 24;
    const pounceRadius2 = 55 * 55;
    const chaseRadius2 = 650 * 650;

    for (const sprite of catSprites.values()) {
      if (!sprite.active || sprite.isCurrentlyDragged() || sprite.cat.animationState === 'sleep') continue;

      let nearestPiece: KibblePiece | null = null;
      let minD2 = 99999999;

      for (let i = 0; i < this.kibblePieces.length; i++) {
        const piece = this.kibblePieces[i];
        if (!piece.active || piece.isEaten) continue;
        const dx = piece.x - sprite.x;
        const dy = piece.y - sprite.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD2) {
          minD2 = d2;
          nearestPiece = piece;
        }
      }

      if (nearestPiece) {
        if (minD2 <= eatRadius2) {
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
        } else if (minD2 <= pounceRadius2 && !sprite.isPounceActive() && Math.random() < 0.35) {
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
            }
          });
        } else if (shouldRecalculateTarget && minD2 < chaseRadius2 && !sprite.isPounceActive()) {
          sprite.setChaseTarget(nearestPiece.x, nearestPiece.y);
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
