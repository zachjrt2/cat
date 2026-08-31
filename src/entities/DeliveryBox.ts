import Phaser from 'phaser';
import { sound } from '../systems/SoundManager';
import { isAnyModalOpen } from '../ui/EventBus';

export type DeliveryItemType =
  | 'machine'
  | 'furniture'
  | 'perfume'
  | 'conga_whistle'
  | 'snowflake_wand'
  | 'heart_wand'
  | 'infinity_metronome'
  | 'solar_prism'
  | 'star_compass';

export interface DeliveryData {
  type: DeliveryItemType;
  id: string;
  name: string;
  emoji: string;
  area?: string;
  onOpen: () => void;
}

export class DeliveryBox extends Phaser.GameObjects.Container {
  private tapsRemaining = 3;
  private isOpening = false;
  private shadow: Phaser.GameObjects.Graphics;
  private boxGfx: Phaser.GameObjects.Graphics;
  private parachuteGfx: Phaser.GameObjects.Graphics | null = null;
  private tapZone: Phaser.GameObjects.Zone;
  private idleTween: Phaser.Tweens.Tween | null = null;

  constructor(
    scene: Phaser.Scene,
    public readonly targetX: number,
    public readonly targetY: number,
    public readonly delivery: DeliveryData,
  ) {
    super(scene, targetX, targetY - 150);

    // 1. Soft Ground Shadow
    this.shadow = scene.add.graphics();
    this.shadow.fillStyle(0x2d1f14, 0.25);
    this.shadow.fillEllipse(0, 18, 52, 16);
    this.add(this.shadow);

    // 2. Parachute (floating above on drop descent)
    this.parachuteGfx = scene.add.graphics();
    this.drawParachute(this.parachuteGfx);
    this.add(this.parachuteGfx);

    // 3. Cardboard Parcel Box Graphics
    this.boxGfx = scene.add.graphics();
    this.drawBox(this.boxGfx);
    this.add(this.boxGfx);

    // 4. Interactive Hit Zone
    this.tapZone = scene.add.zone(0, 0, 56, 56).setInteractive({ cursor: 'pointer' });
    this.add(this.tapZone);

    this.tapZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (isAnyModalOpen() || this.isOpening) return;
      pointer.event.stopPropagation();
      this.handleTap();
    });

    const isConsumable = delivery.type !== 'machine' && delivery.type !== 'furniture';

    // Consumable parcels deliver and open extra fast (1 tap, 380ms drop)
    if (isConsumable) {
      this.tapsRemaining = 1;
    }

    scene.add.existing(this);
    this.setDepth(targetY + 25);

    // Parachute descent drop animation
    const dropDuration = isConsumable ? 380 : 680;
    scene.tweens.add({
      targets: this,
      y: targetY,
      duration: dropDuration,
      ease: 'Bounce.easeOut',
      onComplete: () => {
        if (this.parachuteGfx && this.scene) {
          this.scene.tweens.add({
            targets: this.parachuteGfx,
            alpha: 0,
            y: -50,
            duration: 320,
            onComplete: () => {
              this.parachuteGfx?.destroy();
              this.parachuteGfx = null;
            },
          });
        }
        this.startIdleBob();
      },
    });
  }

  private drawBox(g: Phaser.GameObjects.Graphics): void {
    g.clear();

    // Box main body
    g.fillStyle(0xd4a373, 1);
    g.fillRoundedRect(-22, -18, 44, 36, 6);
    g.lineStyle(2, 0xbc6c25, 0.95);
    g.strokeRoundedRect(-22, -18, 44, 36, 6);

    // Box top flap highlight
    g.fillStyle(0xddb892, 0.9);
    g.fillRoundedRect(-20, -16, 40, 10, 3);

    // Red Gift Ribbon
    g.fillStyle(0xe63946, 1);
    g.fillRect(-5, -18, 10, 36);
    g.fillRect(-22, -2, 44, 6);

    // Golden ribbon knot / bow
    g.fillStyle(0xffb703, 1);
    g.fillCircle(0, -2, 5);
    g.fillEllipse(-7, -5, 10, 6);
    g.fillEllipse(7, -5, 10, 6);

    // Postage Stamp with Pawprint
    g.fillStyle(0xffffff, 0.95);
    g.fillRect(8, -14, 11, 10);
    g.fillStyle(0x3d291a, 0.85);
    g.fillCircle(13.5, -9, 2);
    g.fillCircle(11, -12, 1);
    g.fillCircle(13.5, -13, 1);
    g.fillCircle(16, -12, 1);
  }

  private drawParachute(g: Phaser.GameObjects.Graphics): void {
    g.clear();

    // Canopy
    g.fillStyle(0xff758f, 0.95);
    g.beginPath();
    g.arc(0, -60, 26, Math.PI, 0, false);
    g.closePath();
    g.fillPath();

    // White stripes
    g.fillStyle(0xffffff, 0.9);
    g.beginPath();
    g.arc(0, -60, 13, Math.PI, 0, false);
    g.closePath();
    g.fillPath();

    // Suspension cords
    g.lineStyle(1.2, 0x7f5539, 0.6);
    g.lineBetween(-24, -60, -12, -18);
    g.lineBetween(-12, -60, -4, -18);
    g.lineBetween(12, -60, 4, -18);
    g.lineBetween(24, -60, 12, -18);
  }

  private startIdleBob(): void {
    if (!this.scene || this.isOpening) return;
    this.idleTween = this.scene.tweens.add({
      targets: this,
      scaleX: 1.05,
      scaleY: 0.95,
      y: this.targetY - 3,
      duration: 650,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private handleTap(): void {
    this.tapsRemaining--;

    if (this.idleTween) {
      this.idleTween.stop();
      this.idleTween = null;
    }

    if (this.tapsRemaining === 2) {
      sound.playPop();
      this.spawnTapSparks(6);

      this.scene.tweens.add({
        targets: this,
        scaleX: 1.25,
        scaleY: 0.78,
        duration: 110,
        yoyo: true,
        ease: 'Quad.easeOut',
        onComplete: () => this.startIdleBob(),
      });
    } else if (this.tapsRemaining === 1) {
      sound.playPop();
      this.spawnTapSparks(10);

      this.scene.tweens.add({
        targets: this,
        angle: 12,
        scaleX: 1.28,
        scaleY: 0.75,
        duration: 90,
        yoyo: true,
        repeat: 1,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          this.angle = 0;
          this.startIdleBob();
        },
      });
    } else {
      this.openBox();
    }
  }

  private spawnTapSparks(count: number): void {
    const colors = [0xffb703, 0xff758f, 0x4ade80, 0x38bdf8, 0xffffff];
    for (let i = 0; i < count; i++) {
      const spark = this.scene.add.graphics();
      spark.setDepth(this.depth + 10);
      const color = Phaser.Math.RND.pick(colors);
      spark.fillStyle(color, 1);
      spark.fillCircle(0, 0, Phaser.Math.FloatBetween(2, 4));
      const px = this.x + Phaser.Math.Between(-16, 16);
      const py = this.y + Phaser.Math.Between(-14, 10);
      spark.setPosition(px, py);

      const angle = Math.random() * Math.PI * 2;
      const dist = Phaser.Math.Between(18, 38);
      this.scene.tweens.add({
        targets: spark,
        x: px + Math.cos(angle) * dist,
        y: py + Math.sin(angle) * dist - 8,
        scale: 0.2,
        alpha: 0,
        duration: 400,
        ease: 'Quad.easeOut',
        onComplete: () => spark.destroy(),
      });
    }
  }

  private openBox(): void {
    this.isOpening = true;
    sound.playAdoptFanfare();

    // 1. Confetti & Starburst explosion
    const colors = [0xffb703, 0xff758f, 0x4ade80, 0x38bdf8, 0xa855f7, 0xfde047, 0xffffff];
    for (let i = 0; i < 28; i++) {
      const conf = this.scene.add.graphics();
      conf.setDepth(this.depth + 20);
      const color = Phaser.Math.RND.pick(colors);
      conf.fillStyle(color, 1);
      const size = Phaser.Math.FloatBetween(3, 6);
      if (Math.random() < 0.5) {
        conf.fillCircle(0, 0, size);
      } else {
        conf.fillRect(-size / 2, -size / 2, size, size);
      }
      conf.setPosition(this.x, this.y);

      const angle = (Math.PI * 2 * i) / 28 + (Math.random() - 0.5) * 0.4;
      const speed = Phaser.Math.Between(45, 95);
      this.scene.tweens.add({
        targets: conf,
        x: this.x + Math.cos(angle) * speed,
        y: this.y + Math.sin(angle) * speed - 20,
        angle: Phaser.Math.Between(-180, 180),
        alpha: 0,
        duration: 800,
        ease: 'Cubic.easeOut',
        onComplete: () => conf.destroy(),
      });
    }

    // 2. Floating Unboxed Item Banner
    const banner = this.scene.add.container(this.x, this.y - 10);
    banner.setDepth(this.depth + 30);

    const bannerBg = this.scene.add.graphics();
    bannerBg.fillStyle(0x2d1f14, 0.85);
    bannerBg.fillRoundedRect(-110, -22, 220, 44, 14);
    bannerBg.lineStyle(2, 0xffb703, 1);
    bannerBg.strokeRoundedRect(-110, -22, 220, 44, 14);
    banner.add(bannerBg);

    const bannerText = this.scene.add.text(0, 0, `✨ ${this.delivery.emoji} ${this.delivery.name}! ✨`, {
      fontFamily: 'Outfit, Inter, sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#fff8e1',
    });
    bannerText.setOrigin(0.5);
    banner.add(bannerText);

    this.scene.tweens.add({
      targets: banner,
      y: this.y - 65,
      scaleX: { from: 0.6, to: 1.1 },
      scaleY: { from: 0.6, to: 1.1 },
      alpha: { from: 1, to: 0 },
      duration: 1800,
      ease: 'Back.easeOut',
      onComplete: () => banner.destroy(),
    });

    // 3. Poof box away
    this.scene.tweens.add({
      targets: this,
      scaleX: 1.5,
      scaleY: 1.5,
      alpha: 0,
      duration: 200,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.delivery.onOpen();
        this.destroy();
      },
    });
  }

  destroy(fromScene?: boolean): void {
    if (this.idleTween) {
      this.idleTween.stop();
      this.idleTween = null;
    }
    super.destroy(fromScene);
  }
}
