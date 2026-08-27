import Phaser from 'phaser';
import { sound } from '../systems/SoundManager';

export class KibblePiece extends Phaser.GameObjects.Container {
  readonly createdAt: number;
  isEaten = false;
  targetedByCatId: string | null = null;
  noHungryTimer = 0;
  private shadow: Phaser.GameObjects.Graphics;
  private pieceGfx: Phaser.GameObjects.Graphics;
  private decayTimer?: Phaser.Time.TimerEvent;

  constructor(scene: Phaser.Scene, startX: number, startY: number, targetX: number, targetY: number) {
    super(scene, startX, startY);
    this.createdAt = Date.now();

    // 1. Soft Floor Shadow
    this.shadow = scene.add.graphics();
    this.shadow.fillStyle(0x354a21, 0.25);
    this.shadow.fillEllipse(0, 4, 14, 7);
    this.add(this.shadow);

    // 2. Kibble Pellets (Crunchy cluster of 3 yummy shapes)
    this.pieceGfx = scene.add.graphics();
    this.drawKibble();
    this.add(this.pieceGfx);

    this.setDepth(targetY);
    scene.add.existing(this);

    // Parabolic drop arc & bounce tween from bag opening to ground
    this.setScale(0.4);
    this.alpha = 0.8;

    scene.tweens.add({
      targets: this,
      x: targetX,
      y: targetY,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      duration: 320,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        // Little soft bounce on landing
        if (this.scene) {
          this.scene.tweens.add({
            targets: this.pieceGfx,
            scaleX: 1.25,
            scaleY: 0.75,
            duration: 70,
            yoyo: true,
            ease: 'Quad.easeOut',
          });
        }
      },
    });

    // Auto despawn after 60 seconds if untouched to keep sanctuary clean
    this.decayTimer = scene.time.delayedCall(60000, () => {
      if (!this.isEaten && this.scene) {
        this.despawn();
      }
    });
  }

  private drawKibble(): void {
    this.pieceGfx.clear();

    // Kibble pellet 1: Main golden-brown heart / fish morsel
    this.pieceGfx.fillStyle(0x8c4f1c, 1);
    this.pieceGfx.fillRoundedRect(-5, -4, 8, 7, 2.5);
    this.pieceGfx.fillStyle(0xbc6c25, 1);
    this.pieceGfx.fillRoundedRect(-4, -5, 6, 6, 2);
    this.pieceGfx.fillStyle(0xdda15e, 0.85);
    this.pieceGfx.fillCircle(-2, -3, 1.5); // highlight

    // Kibble pellet 2: Crispy small nugget (right)
    this.pieceGfx.fillStyle(0x7f4f24, 1);
    this.pieceGfx.fillCircle(3, 1, 3.2);
    this.pieceGfx.fillStyle(0xa6632e, 1);
    this.pieceGfx.fillCircle(2.5, 0.5, 2.5);
    this.pieceGfx.fillStyle(0xfefae0, 0.6);
    this.pieceGfx.fillCircle(2, -0.5, 1);

    // Kibble pellet 3: Tiny crunchy morsel (top left)
    this.pieceGfx.fillStyle(0x6b4f2c, 1);
    this.pieceGfx.fillCircle(-2, 3, 2.2);
    this.pieceGfx.fillStyle(0xb07d4f, 1);
    this.pieceGfx.fillCircle(-2, 2.5, 1.8);
  }

  eat(): void {
    if (this.isEaten) return;
    this.isEaten = true;
    if (this.decayTimer) {
      this.decayTimer.remove();
    }

    // Crumb burst particles
    const scene = this.scene;
    if (scene) {
      const crumbGfx = scene.add.graphics();
      crumbGfx.setDepth(this.y + 10);
      const crumbs: Array<{ x: number; y: number; vx: number; vy: number; color: number; size: number }> = [];
      const colors = [0xdda15e, 0xbc6c25, 0x8c4f1c, 0xfefae0];

      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI * 2 * i) / 6 + (Math.random() - 0.5);
        const spd = Phaser.Math.Between(30, 75);
        crumbs.push({
          x: this.x,
          y: this.y,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd - 30,
          color: colors[i % colors.length],
          size: Phaser.Math.Between(1.5, 2.5),
        });
      }

      let elapsed = 0;
      scene.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 350,
        onUpdate: (tw) => {
          const progress = Number(tw.getValue() ?? 0);
          const dt = (tw.elapsed - elapsed) / 1000;
          elapsed = tw.elapsed;
          crumbGfx.clear();
          for (const c of crumbs) {
            c.x += c.vx * dt;
            c.y += c.vy * dt;
            c.vy += 160 * dt; // gravity
            crumbGfx.fillStyle(c.color, Math.max(0, 1 - progress));
            crumbGfx.fillCircle(c.x, c.y, c.size * (1 - progress * 0.5));
          }
        },
        onComplete: () => {
          crumbGfx.destroy();
        },
      });
    }

    // Shrink & pop out
    if (this.scene) {
      this.scene.tweens.add({
        targets: this,
        scaleX: 0,
        scaleY: 0,
        alpha: 0,
        duration: 160,
        ease: 'Back.easeIn',
        onComplete: () => {
          this.destroy();
        },
      });
    } else {
      this.destroy();
    }
  }

  updateNoHungry(deltaSeconds: number, anyCatHungry: boolean): void {
    if (this.isEaten) return;
    if (anyCatHungry) {
      this.noHungryTimer = 0;
    } else {
      this.noHungryTimer += deltaSeconds;
      if (this.noHungryTimer >= 5.0) {
        this.despawn();
      }
    }
  }

  despawn(): void {
    if (this.isEaten) return;
    this.isEaten = true;
    if (this.decayTimer) {
      this.decayTimer.remove();
    }
    if (this.scene) {
      this.scene.tweens.add({
        targets: this,
        alpha: 0,
        scaleX: 0.6,
        scaleY: 0.6,
        duration: 800,
        ease: 'Quad.easeOut',
        onComplete: () => this.destroy(),
      });
    } else {
      this.destroy();
    }
  }
}

export class KibbleBag extends Phaser.GameObjects.Container {
  private shadow: Phaser.GameObjects.Graphics;
  private bagGfx: Phaser.GameObjects.Graphics;
  private bounds: Phaser.Geom.Rectangle;

  isDragging = false;
  private lastDropPos: { x: number; y: number } = { x: 0, y: 0 };
  private lastDropTime = 0;
  private dragStartPos: { x: number; y: number } = { x: 0, y: 0 };
  private velocityHistory: Array<{ x: number; y: number; time: number }> = [];
  private idleTween?: Phaser.Tweens.Tween;

  onDropFood?: (x: number, y: number) => void;

  constructor(scene: Phaser.Scene, x: number, y: number, bounds: Phaser.Geom.Rectangle) {
    super(scene, x, y);
    this.bounds = bounds;

    // 1. Dynamic Drop Shadow
    this.shadow = scene.add.graphics();
    this.shadow.fillStyle(0x354a21, 0.3);
    this.shadow.fillEllipse(0, 22, 42, 16);
    this.add(this.shadow);

    // 2. Kibble Sack Bag Graphics
    this.bagGfx = scene.add.graphics();
    this.drawBag();
    this.add(this.bagGfx);

    // Hit Area & Interactivity
    this.setSize(44, 54);
    this.setInteractive({ cursor: 'grab' });
    scene.input.setDraggable(this);

    this.lastDropPos = { x, y };

    this.on('dragstart', (_pointer: Phaser.Input.Pointer) => {
      this.isDragging = true;
      this.dragStartPos = { x: this.x, y: this.y };
      this.lastDropPos = { x: this.x, y: this.y };
      this.velocityHistory = [{ x: this.x, y: this.y, time: performance.now() }];

      if (this.idleTween) {
        this.idleTween.stop();
        this.idleTween = undefined;
      }

      scene.tweens.add({
        targets: this,
        scaleX: 1.15,
        scaleY: 1.15,
        duration: 120,
        ease: 'Back.easeOut',
      });
      this.shadow.setAlpha(0.18);
      this.shadow.setScale(0.85);
    });

    this.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      const boundedX = Phaser.Math.Clamp(dragX, this.bounds.left + 24, this.bounds.right - 24);
      const boundedY = Phaser.Math.Clamp(dragY, this.bounds.top + 24, this.bounds.bottom - 24);

      const now = performance.now();
      this.velocityHistory.push({ x: boundedX, y: boundedY, time: now });
      while (this.velocityHistory.length > 6 || (this.velocityHistory.length > 2 && now - this.velocityHistory[0].time > 100)) {
        this.velocityHistory.shift();
      }

      // Calculate recent velocity for tilt angle
      let vx = 0;
      if (this.velocityHistory.length >= 2) {
        const first = this.velocityHistory[0];
        const last = this.velocityHistory[this.velocityHistory.length - 1];
        const dt = Math.max(0.016, (last.time - first.time) / 1000);
        vx = (last.x - first.x) / dt;
      }

      // Tilt according to drag direction
      const targetRotation = Phaser.Math.Clamp(vx * 0.0008, -0.35, 0.35);
      this.rotation = Phaser.Math.Linear(this.rotation, targetRotation, 0.3);

      this.x = boundedX;
      this.y = boundedY;
      this.setDepth(this.y + 100);

      // Check distance & throttle for dropping kibble
      const distFromLast = Phaser.Math.Distance.Between(this.x, this.y, this.lastDropPos.x, this.lastDropPos.y);
      if (distFromLast >= 28 && now - this.lastDropTime >= 120) {
        this.dispenseKibble(1 + (Math.random() < 0.35 ? 1 : 0));
        this.lastDropPos = { x: this.x, y: this.y };
        this.lastDropTime = now;
      }
    });

    this.on('dragend', () => {
      this.isDragging = false;
      scene.tweens.add({
        targets: this,
        scaleX: 1.0,
        scaleY: 1.0,
        rotation: 0,
        duration: 200,
        ease: 'Bounce.easeOut',
      });
      this.shadow.setAlpha(1);
      this.shadow.setScale(1);
      this.setDepth(this.y + 15);
      this.startIdleAnimation();
    });

    // Tap/Click on bag directly to drop a small heap of food
    this.on('pointerup', (_pointer: Phaser.Input.Pointer) => {
      if (this.isDragging) return;
      const movedDist = Phaser.Math.Distance.Between(this.x, this.y, this.dragStartPos.x, this.dragStartPos.y);
      if (movedDist < 10) {
        this.hopAndDispense();
      }
    });

    this.setDepth(this.y + 15);
    scene.add.existing(this);
    this.startIdleAnimation();
  }

  private startIdleAnimation(): void {
    if (this.idleTween) this.idleTween.stop();
    this.idleTween = this.scene.tweens.add({
      targets: this.bagGfx,
      y: -2,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private drawBag(): void {
    this.bagGfx.clear();

    const g = this.bagGfx;

    // ── 1. Main Sack Body (Warm Kraft Paper / Burlap) ─────────────────────
    // Darker outline / back
    g.fillStyle(0x8c4f1c, 1);
    g.fillRoundedRect(-19, -18, 38, 38, 7);

    // Warm kraft front pouch
    g.fillStyle(0xd4a373, 1);
    g.fillRoundedRect(-18, -17, 36, 36, 6);

    // Sack gradient bottom shadow
    g.fillStyle(0xbc6c25, 0.4);
    g.fillRoundedRect(-18, 5, 36, 14, 5);

    // ── 2. Decorative Top Ribbon Band & Stitches ──────────────────────────
    // Teal/emerald fresh ribbon trim
    g.fillStyle(0x2a9d8f, 1);
    g.fillRoundedRect(-20, -18, 40, 9, 3);
    g.fillStyle(0x264653, 1);
    g.fillRect(-20, -10, 40, 2);

    // Golden ribbon stitch dots
    g.fillStyle(0xe9c46a, 0.95);
    for (let x = -16; x <= 16; x += 5.5) {
      g.fillRect(x, -15, 2.5, 3);
    }

    // ── 3. Open Sack Top / Fold with Peeking Kibble Pellets ───────────────
    // Folded crumpled sack top
    g.fillStyle(0xb58451, 1);
    g.beginPath();
    g.moveTo(-18, -18);
    g.lineTo(-14, -26);
    g.lineTo(-6, -23);
    g.lineTo(0, -27);
    g.lineTo(8, -24);
    g.lineTo(14, -26);
    g.lineTo(18, -18);
    g.closePath();
    g.fillPath();

    // Dark cavity opening
    g.fillStyle(0x4a2810, 0.9);
    g.fillEllipse(0, -20, 26, 6);

    // Peeking crunchy kibbles at the mouth
    g.fillStyle(0xdda15e, 1);
    g.fillCircle(-7, -20, 3);
    g.fillCircle(1, -21, 3.5);
    g.fillCircle(8, -20, 2.8);
    g.fillStyle(0x8c4f1c, 1);
    g.fillCircle(-3, -19, 2.2);
    g.fillCircle(5, -19, 2.4);

    // ── 4. Front Cute Label Sticker (White Card with Paw / Fish) ──────────
    g.fillStyle(0xfefae0, 0.96);
    g.fillRoundedRect(-13, -7, 26, 22, 4);
    g.lineStyle(1, 0xe9c46a, 0.6);
    g.strokeRoundedRect(-13, -7, 26, 22, 4);

    // Cute Fish Silhouette on Label
    g.fillStyle(0xe76f51, 1);
    // Fish body
    g.fillEllipse(0, 1, 13, 7);
    // Fish tail
    g.fillTriangle(6, 1, 11, -3, 11, 5);
    // Fish eye dot
    g.fillStyle(0xffffff, 1);
    g.fillCircle(-3.5, 0, 1.2);

    // "KIBBLE" / Star accent
    g.fillStyle(0x2a9d8f, 1);
    g.fillCircle(-8, 9, 1.2);
    g.fillCircle(8, 9, 1.2);
    g.fillRect(-5, 8, 10, 2);
  }

  setBounds(bounds: Phaser.Geom.Rectangle): void {
    this.bounds = bounds;
  }

  dispenseKibble(count = 1): void {
    sound.playPop();

    // Subtle jiggle squeeze when dispensing
    this.scene.tweens.add({
      targets: this.bagGfx,
      scaleX: 1.18,
      scaleY: 0.88,
      duration: 65,
      yoyo: true,
      ease: 'Quad.easeOut',
    });

    for (let i = 0; i < count; i++) {
      const scatterDist = Phaser.Math.Between(16, 52);
      const scatterAngle = Phaser.Math.FloatBetween(0.2, Math.PI - 0.2); // Scatter generally downwards/sideways
      const targetX = Phaser.Math.Clamp(
        this.x + Math.cos(scatterAngle) * scatterDist * (Math.random() < 0.5 ? 1 : -1),
        this.bounds.left + 20,
        this.bounds.right - 20
      );
      const targetY = Phaser.Math.Clamp(
        this.y + Math.sin(scatterAngle) * scatterDist + 12,
        this.bounds.top + 20,
        this.bounds.bottom - 20
      );

      if (this.onDropFood) {
        this.onDropFood(targetX, targetY);
      }
    }
  }

  hopAndDispense(): void {
    this.scene.tweens.add({
      targets: this,
      y: this.y - 16,
      duration: 120,
      yoyo: true,
      ease: 'Back.easeOut',
      onYoyo: () => {
        this.dispenseKibble(2);
      },
    });
  }

  update(): void {
    if (!this.isDragging) {
      this.setDepth(this.y + 15);
    }
  }
}
