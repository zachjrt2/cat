import Phaser from 'phaser';
import type { CatArea } from '../../data/types';
import { WeatherManager } from '../../systems/WeatherManager';

export interface AmbientEffectItem {
  type: 'ember' | 'steam' | 'mote' | 'ripple';
  x: number;
  y: number;
  speedX: number;
  speedY: number;
  alpha: number;
  size: number;
  life: number;
  maxLife: number;
  color: number;
}

export interface WeatherParticle {
  x: number;
  y: number;
  speedY: number;
  speedX: number;
  size: number;
  alpha: number;
  flakeType?: 'tiny' | 'fluff' | 'crystal' | 'sparkle';
  swayPhase?: number;
  swaySpeed?: number;
  swayAmp?: number;
  angle?: number;
  spinSpeed?: number;
}

export class WeatherAndLightingController {
  private weatherParticlesGfx!: Phaser.GameObjects.Graphics;
  private ambientLightingGfx!: Phaser.GameObjects.Graphics;
  private dynamicEffectsGfx!: Phaser.GameObjects.Graphics;
  private particles: WeatherParticle[] = [];
  private ambientEffects: AmbientEffectItem[] = [];

  private lastAmbientColor = -1;
  private lastAmbientAlpha = -1;
  private lastAmbientTimeOfDay = '';
  private lastAmbientBoundsKey = '';
  private weatherParticlesActive = false;
  private dynamicEffectsActive = false;
  private animTimer = 0;

  constructor(
    private scene: Phaser.Scene,
    private weatherManager: WeatherManager,
    private getAreaBounds: () => Phaser.Geom.Rectangle,
  ) {
    this.dynamicEffectsGfx = this.scene.add.graphics();
    this.dynamicEffectsGfx.setDepth(1200);

    this.weatherParticlesGfx = this.scene.add.graphics();
    this.weatherParticlesGfx.setDepth(1300);

    this.ambientLightingGfx = this.scene.add.graphics();
    this.ambientLightingGfx.setDepth(1400);

    this.resetWeatherParticles();
  }

  resetWeatherParticles(): void {
    const bounds = this.getAreaBounds();
    this.particles = [];
    const isRain = this.weatherManager.weather === 'rain';
    const isSnow = this.weatherManager.weather === 'snow';
    const count = isRain ? 65 : isSnow ? 55 : 0;

    for (let i = 0; i < count; i++) {
      if (isRain) {
        this.particles.push({
          x: Phaser.Math.Between(bounds.left, bounds.right),
          y: Phaser.Math.Between(bounds.top, bounds.bottom),
          speedY: Phaser.Math.Between(220, 320),
          speedX: -25,
          size: Phaser.Math.Between(8, 16),
          alpha: Phaser.Math.FloatBetween(0.35, 0.85),
        });
      } else if (isSnow) {
        const roll = Math.random();
        let flakeType: 'tiny' | 'fluff' | 'crystal' | 'sparkle' = 'tiny';
        let size = Phaser.Math.FloatBetween(1.2, 2.2);
        let speedY = Phaser.Math.Between(24, 45);
        let alpha = Phaser.Math.FloatBetween(0.4, 0.75);

        if (roll < 0.35) {
          flakeType = 'tiny';
          size = Phaser.Math.FloatBetween(1.2, 2.0);
          speedY = Phaser.Math.Between(22, 38);
          alpha = Phaser.Math.FloatBetween(0.45, 0.75);
        } else if (roll < 0.70) {
          flakeType = 'fluff';
          size = Phaser.Math.FloatBetween(2.6, 4.2);
          speedY = Phaser.Math.Between(34, 58);
          alpha = Phaser.Math.FloatBetween(0.7, 0.95);
        } else if (roll < 0.90) {
          flakeType = 'crystal';
          size = Phaser.Math.FloatBetween(4.0, 6.0);
          speedY = Phaser.Math.Between(28, 48);
          alpha = Phaser.Math.FloatBetween(0.75, 0.95);
        } else {
          flakeType = 'sparkle';
          size = Phaser.Math.FloatBetween(3.5, 5.5);
          speedY = Phaser.Math.Between(26, 44);
          alpha = Phaser.Math.FloatBetween(0.8, 1.0);
        }

        this.particles.push({
          x: Phaser.Math.Between(bounds.left - 10, bounds.right + 10),
          y: Phaser.Math.Between(bounds.top - 10, bounds.bottom + 10),
          speedY,
          speedX: Phaser.Math.FloatBetween(-6, 6),
          size,
          alpha,
          flakeType,
          swayPhase: Math.random() * Math.PI * 2,
          swaySpeed: Phaser.Math.FloatBetween(1.2, 2.4),
          swayAmp: Phaser.Math.FloatBetween(12, 28),
          angle: Math.random() * Math.PI * 2,
          spinSpeed: Phaser.Math.FloatBetween(-1.2, 1.2),
        });
      }
    }
  }

  update(deltaSeconds: number, currentArea: CatArea): void {
    this.animTimer += deltaSeconds;
    this.updateAmbientAtmosphere(deltaSeconds, currentArea);
    this.updateWeatherAndLighting(deltaSeconds);
  }

  private updateAmbientAtmosphere(deltaSeconds: number, currentArea: CatArea): void {
    const bounds = this.getAreaBounds();

    if (currentArea === 'shelter' && Math.random() < 0.25) {
      const fpX = bounds.x + bounds.width * 0.5;
      const wallHeight = Math.min(84, bounds.height * 0.28);
      const fpY = bounds.y + wallHeight - 12;
      this.ambientEffects.push({
        type: 'ember',
        x: fpX + Phaser.Math.Between(-12, 12),
        y: fpY - 8,
        speedX: Phaser.Math.FloatBetween(-15, 15),
        speedY: Phaser.Math.FloatBetween(-30, -60),
        alpha: 0.9,
        size: Phaser.Math.FloatBetween(2, 3.5),
        life: 0,
        maxLife: Phaser.Math.FloatBetween(1.0, 1.8),
        color: Phaser.Math.RND.pick([0xff5400, 0xffbe0b, 0xff0054]),
      });
    } else if (currentArea === 'cafe' && Math.random() < 0.2) {
      const barX = bounds.x + bounds.width * 0.5;
      const wallH = Math.min(88, bounds.height * 0.28);
      const barY = bounds.y + wallH - 14;
      this.ambientEffects.push({
        type: 'steam',
        x: barX - 44 + Phaser.Math.Between(4, 30),
        y: barY - 48,
        speedX: Phaser.Math.FloatBetween(-8, 8),
        speedY: Phaser.Math.FloatBetween(-20, -40),
        alpha: 0.6,
        size: Phaser.Math.FloatBetween(3, 6),
        life: 0,
        maxLife: Phaser.Math.FloatBetween(1.2, 2.0),
        color: 0xffffff,
      });
    } else if ((currentArea === 'sunroom' || currentArea === 'yard') && Math.random() < 0.15) {
      this.ambientEffects.push({
        type: 'mote',
        x: Phaser.Math.Between(bounds.left + 20, bounds.right - 20),
        y: Phaser.Math.Between(bounds.top + 20, bounds.bottom - 20),
        speedX: Phaser.Math.FloatBetween(-10, 10),
        speedY: Phaser.Math.FloatBetween(-10, 10),
        alpha: 0.7,
        size: Phaser.Math.FloatBetween(1.5, 3.0),
        life: 0,
        maxLife: Phaser.Math.FloatBetween(2.0, 3.5),
        color: 0xfffa80,
      });
    }

    if (this.ambientEffects.length > 0) {
      this.dynamicEffectsActive = true;
      this.dynamicEffectsGfx.clear();
      for (let i = this.ambientEffects.length - 1; i >= 0; i--) {
        const e = this.ambientEffects[i];
        e.life += deltaSeconds;
        if (e.life >= e.maxLife) {
          this.ambientEffects.splice(i, 1);
          continue;
        }

        e.x += e.speedX * deltaSeconds;
        e.y += e.speedY * deltaSeconds;
        const progress = e.life / e.maxLife;
        const currentAlpha = e.alpha * (1 - progress);

        this.dynamicEffectsGfx.fillStyle(e.color, currentAlpha);
        this.dynamicEffectsGfx.fillCircle(e.x, e.y, e.size * (e.type === 'steam' ? 1 + progress : 1));
      }
    } else if (this.dynamicEffectsActive) {
      this.dynamicEffectsActive = false;
      this.dynamicEffectsGfx.clear();
    }
  }

  private updateWeatherAndLighting(deltaSeconds: number): void {
    const bounds = this.getAreaBounds();
    const boundsKey = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;

    const ambient = this.weatherManager.getAmbientOverlayColor();
    const timeOfDay = this.weatherManager.timeOfDay;
    const needsAmbientRedraw =
      ambient.color !== this.lastAmbientColor ||
      Math.abs(ambient.alpha - this.lastAmbientAlpha) > 0.005 ||
      timeOfDay !== this.lastAmbientTimeOfDay ||
      boundsKey !== this.lastAmbientBoundsKey;

    if (needsAmbientRedraw) {
      this.lastAmbientColor = ambient.color;
      this.lastAmbientAlpha = ambient.alpha;
      this.lastAmbientTimeOfDay = timeOfDay;
      this.lastAmbientBoundsKey = boundsKey;

      this.ambientLightingGfx.clear();
      if (ambient.alpha > 0) {
        this.ambientLightingGfx.fillStyle(ambient.color, ambient.alpha);
        this.ambientLightingGfx.fillRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, 22);

        if (timeOfDay === 'night') {
          this.ambientLightingGfx.fillStyle(0xffffff, 0.7);
          const starSeeds = [
            [bounds.left + 40, bounds.top + 30],
            [bounds.left + 120, bounds.top + 50],
            [bounds.right - 80, bounds.top + 35],
            [bounds.right - 140, bounds.top + 65],
            [bounds.left + bounds.width * 0.5, bounds.top + 25],
          ];
          starSeeds.forEach(([sx, sy]) => {
            this.ambientLightingGfx.fillCircle(sx, sy, 1.5);
          });
        }
      }
    }

    const isRaining = this.weatherManager.weather === 'rain';
    const isSnowing = this.weatherManager.weather === 'snow';

    if (isRaining || isSnowing) {
      this.weatherParticlesActive = true;
      this.weatherParticlesGfx.clear();
      if (isRaining) {
        this.weatherParticlesGfx.lineStyle(1.5, 0x90caf9, 0.7);
        for (const p of this.particles) {
          p.y += p.speedY * deltaSeconds;
          p.x += p.speedX * deltaSeconds;

          if (p.y > bounds.bottom - 10) {
            p.y = bounds.top + 10;
            p.x = Phaser.Math.Between(bounds.left + 10, bounds.right - 10);
          }

          this.weatherParticlesGfx.beginPath();
          this.weatherParticlesGfx.moveTo(p.x, p.y);
          this.weatherParticlesGfx.lineTo(p.x - 3, p.y + p.size);
          this.weatherParticlesGfx.strokePath();
        }
      } else if (isSnowing) {
        for (const p of this.particles) {
          p.y += p.speedY * deltaSeconds;
          const sway = Math.sin(this.animTimer * (p.swaySpeed || 1.5) + (p.swayPhase || 0)) * (p.swayAmp || 16);
          p.x += (p.speedX + sway) * deltaSeconds;
          if (p.spinSpeed) {
            p.angle = (p.angle || 0) + p.spinSpeed * deltaSeconds;
          }

          if (p.y > bounds.bottom + 12) {
            p.y = bounds.top - 8;
            p.x = Phaser.Math.Between(bounds.left - 10, bounds.right + 10);
          }
          if (p.x < bounds.left - 20) p.x = bounds.right + 10;
          else if (p.x > bounds.right + 20) p.x = bounds.left - 10;

          const flakeType = p.flakeType || 'fluff';
          if (flakeType === 'crystal') {
            const r = p.size;
            const ang = p.angle || 0;
            this.weatherParticlesGfx.lineStyle(1.2, 0xffffff, p.alpha);
            for (let arm = 0; arm < 3; arm++) {
              const theta = ang + (arm * Math.PI) / 3;
              const cos = Math.cos(theta);
              const sin = Math.sin(theta);
              this.weatherParticlesGfx.lineBetween(
                p.x - cos * r,
                p.y - sin * r,
                p.x + cos * r,
                p.y + sin * r,
              );
              const barbR = r * 0.45;
              const barbTheta = theta + Math.PI / 6;
              const bCos = Math.cos(barbTheta) * barbR;
              const bSin = Math.sin(barbTheta) * barbR;
              this.weatherParticlesGfx.lineBetween(
                p.x + cos * r * 0.5 - bCos,
                p.y + sin * r * 0.5 - bSin,
                p.x + cos * r * 0.5 + bCos,
                p.y + sin * r * 0.5 + bSin,
              );
            }
          } else if (flakeType === 'sparkle') {
            const s = p.size;
            this.weatherParticlesGfx.fillStyle(0xf0fdf4, p.alpha);
            this.weatherParticlesGfx.beginPath();
            this.weatherParticlesGfx.moveTo(p.x, p.y - s);
            this.weatherParticlesGfx.lineTo(p.x + s * 0.28, p.y - s * 0.28);
            this.weatherParticlesGfx.lineTo(p.x + s, p.y);
            this.weatherParticlesGfx.lineTo(p.x + s * 0.28, p.y + s * 0.28);
            this.weatherParticlesGfx.lineTo(p.x, p.y + s);
            this.weatherParticlesGfx.lineTo(p.x - s * 0.28, p.y + s * 0.28);
            this.weatherParticlesGfx.lineTo(p.x - s, p.y);
            this.weatherParticlesGfx.lineTo(p.x - s * 0.28, p.y - s * 0.28);
            this.weatherParticlesGfx.closePath();
            this.weatherParticlesGfx.fillPath();
          } else if (flakeType === 'fluff') {
            this.weatherParticlesGfx.fillStyle(0xe0f2fe, p.alpha * 0.35);
            this.weatherParticlesGfx.fillCircle(p.x, p.y, p.size * 1.35);
            this.weatherParticlesGfx.fillStyle(0xffffff, p.alpha);
            this.weatherParticlesGfx.fillCircle(p.x, p.y, p.size * 0.85);
          } else {
            this.weatherParticlesGfx.fillStyle(0xffffff, p.alpha);
            this.weatherParticlesGfx.fillCircle(p.x, p.y, p.size);
          }
        }
      }
    } else if (this.weatherParticlesActive) {
      this.weatherParticlesActive = false;
      this.weatherParticlesGfx.clear();
    }
  }
}
