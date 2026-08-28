import Phaser from 'phaser';
import type { Cat, GameState } from '../../data/types';
import { CatSprite } from '../../entities/CatSprite';
import { BreedingSystem } from '../../systems/BreedingSystem';
import { GrowthSystem } from '../../systems/GrowthSystem';
import { LoveManager } from '../../systems/LoveManager';
import { sound } from '../../systems/SoundManager';
import { EventBus } from '../../ui/EventBus';

export interface DragCandidate {
  cat: Cat;
  sprite: CatSprite;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  startTime: number;
}

export interface CatDragDropCallbacks {
  getWalkableBounds: () => Phaser.Geom.Rectangle;
  getAreaBounds: () => Phaser.Geom.Rectangle;
  getPartitions: () => Phaser.Geom.Rectangle[];
  findPartitionForPoint: (x: number, y: number) => Phaser.Geom.Rectangle;
  getAdoptionBoxContainer: () => Phaser.GameObjects.Container | null;
  getAdoptionBoxGlow: () => Phaser.GameObjects.Graphics | null;
  getInspectContainer: () => Phaser.GameObjects.Container | null;
  getInspectGlow: () => Phaser.GameObjects.Graphics | null;
  getCatSprites: () => Map<string, CatSprite>;
  createHeartBurst: (x: number, y: number) => void;
  saveGame: () => void;
  notifyUi: () => void;
}

export class CatDragDropManager {
  private dragCandidate: DragCandidate | null = null;
  private isDraggingCat = false;
  private currentDropTarget: CatSprite | null = null;
  private isHoveringAdoptionBox = false;
  private isHoveringCatInspect = false;

  constructor(
    private scene: Phaser.Scene,
    private state: GameState,
    private breeding: BreedingSystem,
    private growth: GrowthSystem,
    private love: LoveManager,
    private callbacks: CatDragDropCallbacks,
  ) {}

  onCatPointerDown(cat: Cat, sprite: CatSprite, pointer: Phaser.Input.Pointer): void {
    this.dragCandidate = {
      cat,
      sprite,
      startX: pointer.worldX,
      startY: pointer.worldY,
      offsetX: pointer.worldX - sprite.x,
      offsetY: pointer.worldY - sprite.y,
      startTime: this.scene.time.now,
    };
    this.isDraggingCat = false;
    this.currentDropTarget = null;
    this.isHoveringAdoptionBox = false;
    this.isHoveringCatInspect = false;
  }

  onScenePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.dragCandidate) return;

    const dx = pointer.worldX - this.dragCandidate.startX;
    const dy = pointer.worldY - this.dragCandidate.startY;
    const dist = Math.hypot(dx, dy);

    if (!this.isDraggingCat && dist > 6) {
      this.isDraggingCat = true;
      this.dragCandidate.sprite.setDragged(true);
      sound.playTap();

      if (this.dragCandidate.cat.stage === 'adult') {
        this.showBreedingPartnersFor(this.dragCandidate.cat);
      }
    }

    if (this.isDraggingCat) {
      const bounds = this.callbacks.getAreaBounds();
      const newX = Phaser.Math.Clamp(pointer.worldX - this.dragCandidate.offsetX, bounds.left + 20, bounds.right - 20);
      const newY = Phaser.Math.Clamp(pointer.worldY - this.dragCandidate.offsetY, bounds.top + 20, bounds.bottom - 20);
      this.dragCandidate.sprite.setPosition(newX, newY);

      // Check hover over Adoption Box
      const adoptionBoxContainer = this.callbacks.getAdoptionBoxContainer();
      const adoptionBoxGlow = this.callbacks.getAdoptionBoxGlow();
      if (adoptionBoxContainer) {
        const boxX = adoptionBoxContainer.x;
        const boxY = adoptionBoxContainer.y;
        const distToBox = Phaser.Math.Distance.Between(newX, newY, boxX, boxY);
        const isNearBox = distToBox < 58;

        if (isNearBox !== this.isHoveringAdoptionBox) {
          this.isHoveringAdoptionBox = isNearBox;
          if (isNearBox) {
            adoptionBoxGlow?.setAlpha(1);
            this.scene.tweens.add({
              targets: adoptionBoxContainer,
              scaleX: 1.16,
              scaleY: 1.16,
              duration: 140,
              ease: 'Back.easeOut',
            });
            this.dragCandidate.sprite.showEmote('🏡');
          } else {
            adoptionBoxGlow?.setAlpha(0);
            this.scene.tweens.add({
              targets: adoptionBoxContainer,
              scaleX: 1.0,
              scaleY: 1.0,
              duration: 140,
              ease: 'Quad.easeOut',
            });
          }
        }
      }

      // Check hover over Cat Inspect Magnifying Glass
      const inspectContainer = this.callbacks.getInspectContainer();
      const inspectGlow = this.callbacks.getInspectGlow();
      if (inspectContainer) {
        const insX = inspectContainer.x;
        const insY = inspectContainer.y;
        const distToIns = Phaser.Math.Distance.Between(newX, newY, insX, insY);
        const isNearIns = distToIns < 58;

        if (isNearIns !== this.isHoveringCatInspect) {
          this.isHoveringCatInspect = isNearIns;
          if (isNearIns) {
            inspectGlow?.setAlpha(1);
            this.scene.tweens.add({
              targets: inspectContainer,
              scaleX: 1.18,
              scaleY: 1.18,
              duration: 140,
              ease: 'Back.easeOut',
            });
            this.dragCandidate.sprite.showEmote('🔍');
          } else {
            inspectGlow?.setAlpha(0);
            this.scene.tweens.add({
              targets: inspectContainer,
              scaleX: 1.0,
              scaleY: 1.0,
              duration: 140,
              ease: 'Quad.easeOut',
            });
          }
        }
      }

      let closestTarget: CatSprite | null = null;
      let closestDist = 65;

      const catSprites = this.callbacks.getCatSprites();
      for (const otherSprite of catSprites.values()) {
        if (otherSprite.cat.id === this.dragCandidate.cat.id) continue;
        const d = Phaser.Math.Distance.Between(newX, newY, otherSprite.x, otherSprite.y);
        if (d < closestDist) {
          closestDist = d;
          closestTarget = otherSprite;
        }
      }

      if (this.currentDropTarget && this.currentDropTarget !== closestTarget) {
        this.currentDropTarget.highlightAsDropTarget(false);
      }
      this.currentDropTarget = closestTarget;
      if (this.currentDropTarget) {
        this.currentDropTarget.highlightAsDropTarget(true);
      }
    }
  }

  onScenePointerUp(): void {
    if (!this.dragCandidate) return;

    const { cat, sprite } = this.dragCandidate;
    const target = this.currentDropTarget;

    if (target) {
      target.highlightAsDropTarget(false);
    }

    this.clearAllBreedingPartners();

    if (this.isDraggingCat) {
      sprite.setDragged(false);

      if (this.isHoveringCatInspect) {
        this.isHoveringCatInspect = false;
        const inspectGlow = this.callbacks.getInspectGlow();
        const inspectContainer = this.callbacks.getInspectContainer();
        inspectGlow?.setAlpha(0);
        if (inspectContainer) {
          this.scene.tweens.add({
            targets: inspectContainer,
            scaleX: 1.0,
            scaleY: 1.0,
            duration: 140,
            ease: 'Quad.easeOut',
          });
        }
        sound.playSparkle();
        EventBus.emit('cat-info', { cat });

        this.clampCatToPartition(cat, sprite);
        this.callbacks.saveGame();
      } else if (this.isHoveringAdoptionBox) {
        this.isHoveringAdoptionBox = false;
        const adoptionBoxGlow = this.callbacks.getAdoptionBoxGlow();
        const adoptionBoxContainer = this.callbacks.getAdoptionBoxContainer();
        adoptionBoxGlow?.setAlpha(0);
        if (adoptionBoxContainer) {
          this.scene.tweens.add({
            targets: adoptionBoxContainer,
            scaleX: 1.0,
            scaleY: 1.0,
            duration: 140,
            ease: 'Quad.easeOut',
          });
        }
        sound.playPop();
        EventBus.emit('prompt-rehome-modal', { cat });
      } else if (target) {
        this.handleCatPairDrop(sprite, target);
        this.clampCatToPartition(cat, sprite);
        this.callbacks.saveGame();
      } else {
        this.clampCatToPartition(cat, sprite);
        this.callbacks.saveGame();

        this.scene.tweens.add({
          targets: sprite,
          y: sprite.y + 4,
          duration: 120,
          yoyo: true,
          ease: 'Quad.easeOut',
        });
      }
    } else {
      const pitchOffset = cat.stage === 'kitten' ? 5 : cat.stage === 'teen' ? 2 : Phaser.Math.Between(-2, 2);
      sound.playMeow(pitchOffset);
      sprite.showEmote(cat.stage === 'kitten' ? '🐾' : '❤️');
    }

    this.dragCandidate = null;
    this.isDraggingCat = false;
    this.currentDropTarget = null;
  }

  private clampCatToPartition(cat: Cat, sprite: CatSprite): void {
    const areaWalkable = this.callbacks.getWalkableBounds();
    const targetPartition = this.callbacks.findPartitionForPoint(sprite.x, sprite.y);
    sprite.setAreaBounds(targetPartition);
    sprite.x = Phaser.Math.Clamp(sprite.x, targetPartition.left + 20, targetPartition.right - 20);
    sprite.y = Phaser.Math.Clamp(sprite.y, targetPartition.top + 20, targetPartition.bottom - 20);
    cat.xPercent = Phaser.Math.Clamp((sprite.x - areaWalkable.left) / areaWalkable.width, 0, 1);
    cat.yPercent = Phaser.Math.Clamp((sprite.y - areaWalkable.top) / areaWalkable.height, 0, 1);
  }

  private handleCatPairDrop(spriteA: CatSprite, spriteB: CatSprite): void {
    const catA = spriteA.cat;
    const catB = spriteB.cat;
    const midX = (spriteA.x + spriteB.x) / 2;
    const midY = (spriteA.y + spriteB.y) / 2;

    // 1. Two Adult Cats: Breeding Attempt (generates Stars)!
    if (catA.stage === 'adult' && catB.stage === 'adult') {
      const check = this.breeding.canBreed(catA, catB);
      if (check.eligible) {
        sound.playAdoptFanfare();
        spriteA.showEmote('💖');
        spriteB.showEmote('💖');
        this.callbacks.createHeartBurst(midX, midY);

        const result = this.breeding.breed(catA, catB);
        if (result) {
          this.callbacks.saveGame();
          this.callbacks.notifyUi();
        }
      } else {
        sound.playPurr();
        spriteA.showEmote('💕');
        spriteB.showEmote('💕');
        EventBus.emit('toast', {
          message: `🐾 ${catA.name} and ${catB.name} are cuddling! (${check.reason || 'Breeding on cooldown'})`,
        });
      }
      return;
    }

    // 2. Adult + Kitten / Teen: Grooming & Comfort!
    if ((catA.stage === 'adult' && catB.stage !== 'adult') || (catB.stage === 'adult' && catA.stage !== 'adult')) {
      const adult = catA.stage === 'adult' ? catA : catB;
      const young = catA.stage === 'adult' ? catB : catA;
      const youngSprite = catA.stage === 'adult' ? spriteB : spriteA;
      const adultSprite = catA.stage === 'adult' ? spriteA : spriteB;

      young.cleanliness = Math.min(100, young.cleanliness + 30);
      young.affection = Math.min(100, young.affection + 25);
      young.happiness = Math.min(100, young.happiness + 15);
      this.growth.addGrowth(young, 8);

      adult.affection = Math.min(100, adult.affection + 15);
      adult.happiness = Math.min(100, adult.happiness + 10);

      this.love.add(5);
      this.state.totalLoveEarned += 5;
      EventBus.emit('love-changed', { love: this.love.love });

      sound.playPurr();
      adultSprite.showEmote('🧼');
      youngSprite.showEmote('🥰');
      youngSprite.refreshVisuals();

      this.callbacks.saveGame();
      this.callbacks.notifyUi();
      EventBus.emit('toast', {
        message: `✨ ${adult.name} gently groomed little ${young.name}! (+5 💗 Care Points)`,
      });
      return;
    }

    // 3. Two Young Cats: Playtime tag!
    if (catA.stage !== 'adult' && catB.stage !== 'adult') {
      catA.fun = Math.min(100, catA.fun + 30);
      catB.fun = Math.min(100, catB.fun + 30);
      catA.happiness = Math.min(100, catA.happiness + 12);
      catB.happiness = Math.min(100, catB.happiness + 12);
      this.growth.addGrowth(catA, 6);
      this.growth.addGrowth(catB, 6);

      this.love.add(4);
      this.state.totalLoveEarned += 4;
      EventBus.emit('love-changed', { love: this.love.love });

      sound.playPop();
      spriteA.showEmote('🧶');
      spriteB.showEmote('🧶');
      spriteA.triggerPlayState(1.5);
      spriteB.triggerPlayState(1.5);

      this.callbacks.saveGame();
      this.callbacks.notifyUi();
      EventBus.emit('toast', {
        message: `🐾 ${catA.name} & ${catB.name} started a fun kitten tag game! (+4 💗 Care Points)`,
      });
    }
  }

  private showBreedingPartnersFor(cat: Cat): void {
    const catSprites = this.callbacks.getCatSprites();
    for (const sprite of catSprites.values()) {
      if (sprite.cat.id === cat.id) continue;
      if (sprite.cat.stage === 'adult') {
        const progress = this.breeding.getPairCooldownProgress(cat, sprite.cat);
        sprite.showBreedingReadinessBar(progress.ratio, progress.isReady);
      }
    }
  }

  private clearAllBreedingPartners(): void {
    const catSprites = this.callbacks.getCatSprites();
    for (const sprite of catSprites.values()) {
      sprite.clearBreedingReadinessBar();
    }
  }

  isDragging(): boolean {
    return this.isDraggingCat;
  }
}
