import Phaser from 'phaser';

export class ToyBall extends Phaser.GameObjects.Container {
  private shadow: Phaser.GameObjects.Graphics;
  private ballGfx: Phaser.GameObjects.Graphics;
  private bounds: Phaser.Geom.Rectangle;

  vx = 0;
  vy = 0;
  isDragging = false;
  private velocityHistory: Array<{ x: number; y: number; time: number }> = [];
  private lastBatTime = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, bounds: Phaser.Geom.Rectangle) {
    super(scene, x, y);
    this.bounds = bounds;

    // 1. Soft Shadow
    this.shadow = scene.add.graphics();
    this.shadow.fillStyle(0x354a21, 0.28);
    this.shadow.fillEllipse(0, 10, 24, 10);
    this.add(this.shadow);

    // 2. Toy Yarn / Ball Graphics
    this.ballGfx = scene.add.graphics();
    this.drawBall();
    this.add(this.ballGfx);

    this.setSize(32, 32);
    this.setInteractive({ cursor: 'grab' });
    scene.input.setDraggable(this);

    this.on('dragstart', (_pointer: Phaser.Input.Pointer) => {
      this.isDragging = true;
      this.vx = 0;
      this.vy = 0;
      this.velocityHistory = [{ x: this.x, y: this.y, time: performance.now() }];
      scene.tweens.add({
        targets: this,
        scaleX: 1.25,
        scaleY: 1.25,
        duration: 100,
        ease: 'Back.easeOut',
      });
      this.shadow.setAlpha(0.15);
      this.shadow.setScale(0.8);
    });

    this.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      const boundedX = Phaser.Math.Clamp(dragX, this.bounds.left + 16, this.bounds.right - 16);
      const boundedY = Phaser.Math.Clamp(dragY, this.bounds.top + 16, this.bounds.bottom - 16);

      const now = performance.now();
      this.velocityHistory.push({ x: boundedX, y: boundedY, time: now });
      while (this.velocityHistory.length > 8 || (this.velocityHistory.length > 2 && now - this.velocityHistory[0].time > 120)) {
        this.velocityHistory.shift();
      }

      this.x = boundedX;
      this.y = boundedY;
      this.setDepth(this.y + 10);
    });

    this.on('dragend', () => {
      this.isDragging = false;
      const now = performance.now();
      const recent = this.velocityHistory.filter((p) => now - p.time < 140);

      if (recent.length >= 2) {
        const first = recent[0];
        const last = recent[recent.length - 1];
        const dt = Math.max(0.016, (last.time - first.time) / 1000);
        // Generous momentum multiplier for dynamic throwing
        this.vx = ((last.x - first.x) / dt) * 1.3;
        this.vy = ((last.y - first.y) / dt) * 1.3;
      }

      const maxSpeed = 1250;
      const speed = Math.hypot(this.vx, this.vy);
      if (speed > maxSpeed) {
        this.vx = (this.vx / speed) * maxSpeed;
        this.vy = (this.vy / speed) * maxSpeed;
      }

      scene.tweens.add({
        targets: this,
        scaleX: 1.0,
        scaleY: 1.0,
        duration: 120,
        ease: 'Quad.easeOut',
      });
      this.shadow.setAlpha(1);
      this.shadow.setScale(1);
    });

    this.setDepth(this.y + 10);
    scene.add.existing(this);
  }

  private drawBall(): void {
    this.ballGfx.clear();
    const radius = 12;

    // Outer yarn sphere (warm coral/rose)
    this.ballGfx.fillStyle(0xff477e, 1.0);
    this.ballGfx.fillCircle(0, 0, radius);

    // Decorative swirling yarn strands
    this.ballGfx.lineStyle(2.5, 0xffd166, 0.95);
    this.ballGfx.strokeCircle(0, 0, radius * 0.7);
    this.ballGfx.lineStyle(2, 0x06d6a0, 0.9);
    this.ballGfx.beginPath();
    this.ballGfx.arc(0, 0, radius * 0.85, -0.6, 1.8, false);
    this.ballGfx.strokePath();

    // Little cute yarn tufts
    this.ballGfx.fillStyle(0xffbe0b, 1);
    this.ballGfx.fillCircle(-4, -6, 3.5);
    this.ballGfx.fillCircle(-7, -4, 2.5);

    // Specular highlight
    this.ballGfx.fillStyle(0xffffff, 0.6);
    this.ballGfx.fillCircle(-3, -4, 2.5);
  }

  setBounds(bounds: Phaser.Geom.Rectangle): void {
    this.bounds = bounds;
  }

  kick(impulseX: number, impulseY: number): void {
    this.vx = impulseX;
    this.vy = impulseY;
    this.lastBatTime = Date.now();
    this.scene.tweens.add({
      targets: this,
      scaleX: 1.3,
      scaleY: 0.7,
      duration: 70,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  get canBeBatted(): boolean {
    return Date.now() - this.lastBatTime > 500;
  }

  update(deltaSeconds: number): void {
    if (this.isDragging) {
      this.setDepth(this.y + 20);
      return;
    }

    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 5) {
      this.x += this.vx * deltaSeconds;
      this.y += this.vy * deltaSeconds;

      this.ballGfx.rotation += (this.vx + this.vy) * 0.015 * deltaSeconds;

      // Smooth low rolling friction (retains momentum)
      const frictionFactor = Math.pow(0.975, deltaSeconds * 60);
      this.vx *= frictionFactor;
      this.vy *= frictionFactor;

      // Bounce off boundaries with high elasticity
      const minX = this.bounds.left + 16;
      const maxX = this.bounds.right - 16;
      const minY = this.bounds.top + 16;
      const maxY = this.bounds.bottom - 16;

      if (this.x < minX) {
        this.x = minX;
        this.vx = -this.vx * 0.85;
      } else if (this.x > maxX) {
        this.x = maxX;
        this.vx = -this.vx * 0.85;
      }

      if (this.y < minY) {
        this.y = minY;
        this.vy = -this.vy * 0.85;
      } else if (this.y > maxY) {
        this.y = maxY;
        this.vy = -this.vy * 0.85;
      }
    } else {
      this.vx = 0;
      this.vy = 0;
    }

    this.setDepth(this.y + 10);
  }
}
