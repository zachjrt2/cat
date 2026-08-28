import Phaser from 'phaser';
import type { CatArea, FenceLayout, GameState } from '../../data/types';
import { FURNITURE_CATALOG } from '../../data/constants';
import { sound } from '../../systems/SoundManager';
import { EventBus } from '../../ui/EventBus';

export const TOOLBAR_RESERVED_PX = 100;
export const TOP_BAR_RESERVED_PX = 110;

export interface AreaRendererCallbacks {
  onAdoptionBoxCreated?: (container: Phaser.GameObjects.Container, glow: Phaser.GameObjects.Graphics) => void;
  onInspectTargetCreated?: (container: Phaser.GameObjects.Container, glow: Phaser.GameObjects.Graphics) => void;
}

export class AreaRenderer {
  private adoptionBoxContainer: Phaser.GameObjects.Container | null = null;
  private adoptionBoxGlow: Phaser.GameObjects.Graphics | null = null;
  private catInspectContainer: Phaser.GameObjects.Container | null = null;
  private catInspectGlow: Phaser.GameObjects.Graphics | null = null;

  constructor(
    private scene: Phaser.Scene,
    private callbacks: AreaRendererCallbacks = {},
  ) {}

  areaBounds(): Phaser.Geom.Rectangle {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    return new Phaser.Geom.Rectangle(
      16,
      TOP_BAR_RESERVED_PX,
      Math.max(280, w - 32),
      Math.max(300, h - TOP_BAR_RESERVED_PX - TOOLBAR_RESERVED_PX - 16),
    );
  }

  walkableBounds(area: CatArea): Phaser.Geom.Rectangle {
    const bounds = this.areaBounds();
    switch (area) {
      case 'shelter': {
        const wallHeight = Math.min(84, bounds.height * 0.28);
        const topOffset = wallHeight + 18;
        const sidePadding = 32;
        const bottomPadding = 24;
        return new Phaser.Geom.Rectangle(
          bounds.x + sidePadding,
          bounds.y + topOffset,
          Math.max(200, bounds.width - sidePadding * 2),
          Math.max(180, bounds.height - topOffset - bottomPadding),
        );
      }
      case 'sunroom': {
        const winH = Math.min(100, bounds.height * 0.32);
        const topOffset = winH + 16;
        const sidePadding = 28;
        const bottomPadding = 22;
        return new Phaser.Geom.Rectangle(
          bounds.x + sidePadding,
          bounds.y + topOffset,
          Math.max(200, bounds.width - sidePadding * 2),
          Math.max(180, bounds.height - topOffset - bottomPadding),
        );
      }
      case 'cafe': {
        const wallH = Math.min(88, bounds.height * 0.28);
        const topOffset = wallH + 20;
        const sidePadding = 28;
        const bottomPadding = 22;
        return new Phaser.Geom.Rectangle(
          bounds.x + sidePadding,
          bounds.y + topOffset,
          Math.max(200, bounds.width - sidePadding * 2),
          Math.max(180, bounds.height - topOffset - bottomPadding),
        );
      }
      case 'yard':
      default: {
        const topOffset = 36;
        const sidePadding = 22;
        const bottomPadding = 22;
        return new Phaser.Geom.Rectangle(
          bounds.x + sidePadding,
          bounds.y + topOffset,
          Math.max(200, bounds.width - sidePadding * 2),
          Math.max(180, bounds.height - topOffset - bottomPadding),
        );
      }
    }
  }

  getPartitionBounds(layout: FenceLayout, area: CatArea): Phaser.Geom.Rectangle[] {
    const fullBounds = this.walkableBounds(area);
    const fencePad = 10;

    switch (layout) {
      case 'horizontal': {
        const midY = fullBounds.centerY;
        const topH = Math.max(70, midY - fullBounds.top - fencePad);
        const botH = Math.max(70, fullBounds.bottom - midY - fencePad);
        return [
          new Phaser.Geom.Rectangle(fullBounds.x, fullBounds.top, fullBounds.width, topH),
          new Phaser.Geom.Rectangle(fullBounds.x, midY + fencePad, fullBounds.width, botH),
        ];
      }
      case 'vertical': {
        const midX = fullBounds.centerX;
        const leftW = Math.max(70, midX - fullBounds.left - fencePad);
        const rightW = Math.max(70, fullBounds.right - midX - fencePad);
        return [
          new Phaser.Geom.Rectangle(fullBounds.left, fullBounds.top, leftW, fullBounds.height),
          new Phaser.Geom.Rectangle(midX + fencePad, fullBounds.top, rightW, fullBounds.height),
        ];
      }
      case 'both': {
        const midX = fullBounds.centerX;
        const midY = fullBounds.centerY;
        const leftW = Math.max(70, midX - fullBounds.left - fencePad);
        const rightW = Math.max(70, fullBounds.right - midX - fencePad);
        const topH = Math.max(70, midY - fullBounds.top - fencePad);
        const botH = Math.max(70, fullBounds.bottom - midY - fencePad);
        return [
          new Phaser.Geom.Rectangle(fullBounds.left, fullBounds.top, leftW, topH),
          new Phaser.Geom.Rectangle(midX + fencePad, fullBounds.top, rightW, topH),
          new Phaser.Geom.Rectangle(fullBounds.left, midY + fencePad, leftW, botH),
          new Phaser.Geom.Rectangle(midX + fencePad, midY + fencePad, rightW, botH),
        ];
      }
      case 'none':
      default:
        return [fullBounds];
    }
  }

  findPartitionForPoint(x: number, y: number, partitions: Phaser.Geom.Rectangle[]): Phaser.Geom.Rectangle {
    if (partitions.length === 1) return partitions[0];

    for (const p of partitions) {
      if (p.contains(x, y)) return p;
    }

    let nearest = partitions[0];
    let minDist = 999999;
    for (const p of partitions) {
      const dist = Math.hypot(x - p.centerX, y - p.centerY);
      if (dist < minDist) {
        minDist = dist;
        nearest = p;
      }
    }
    return nearest;
  }

  drawArea(currentArea: CatArea, state: GameState): void {
    this.scene.children.getAll('name', 'area-bg').forEach((c) => c.destroy());

    switch (currentArea) {
      case 'yard':
        this.drawYardBackground(state);
        break;
      case 'shelter':
        this.drawShelterBackground();
        break;
      case 'sunroom':
        this.drawSunroomBackground(state);
        break;
      case 'cafe':
        this.drawCafeBackground();
        break;
    }

    this.drawPlacedFurniture(currentArea, state);
    this.createAdoptionBox();
    this.createInspectTarget(state);
    this.drawFenceDividers(currentArea, state.fenceLayout || 'none');
  }

  private drawYardBackground(state: GameState): void {
    const bounds = this.areaBounds();
    const g = this.scene.add.graphics({ x: 0, y: 0 });
    g.name = 'area-bg';
    g.setDepth(-100);

    // Stone Garden Wall Border
    g.fillStyle(0x607d47, 0.45);
    g.fillRoundedRect(bounds.x - 6, bounds.y - 6, bounds.width + 12, bounds.height + 12, 28);
    g.fillStyle(0x8fa878, 1);
    g.fillRoundedRect(bounds.x - 3, bounds.y - 3, bounds.width + 6, bounds.height + 6, 26);

    // Multi-Tone Rolling Grass Lawn Base
    g.fillStyle(0xcce8a9, 1);
    g.fillRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, 24);

    // Lush Hill Contours
    g.fillStyle(0xddf4c3, 1);
    g.fillRoundedRect(bounds.x + 8, bounds.y + 8, bounds.width - 16, bounds.height * 0.46, 20);
    g.fillStyle(0xbadc92, 1);
    g.fillRoundedRect(bounds.x + 10, bounds.y + bounds.height * 0.54, bounds.width - 20, bounds.height * 0.43, 20);

    // Clover Patches
    const cloverCoords = [
      [bounds.left + 35, bounds.top + 50],
      [bounds.left + 80, bounds.bottom - 80],
      [bounds.right - 70, bounds.top + 130],
      [bounds.right - 120, bounds.bottom - 60],
      [bounds.left + bounds.width * 0.4, bounds.top + 45],
    ];
    cloverCoords.forEach(([cx, cy]) => {
      g.fillStyle(0x9fc871, 0.85);
      g.fillCircle(cx - 3, cy, 3.5);
      g.fillCircle(cx + 3, cy, 3.5);
      g.fillCircle(cx, cy - 3.5, 3.5);
      g.fillStyle(0x85ad57, 0.9);
      g.fillCircle(cx, cy, 1.5);
    });

    // White Picket Fence along Top
    const fenceY = bounds.top + 14;
    const postCount = Math.floor((bounds.width - 40) / 22);
    g.fillStyle(0xede7d9, 1);
    g.fillRect(bounds.left + 15, fenceY + 6, bounds.width - 30, 4);
    g.fillRect(bounds.left + 15, fenceY + 16, bounds.width - 30, 4);

    for (let i = 0; i < postCount; i++) {
      const px = bounds.left + 22 + i * 22;
      g.fillStyle(0xffffff, 1);
      g.fillRect(px - 4, fenceY, 8, 24);
      g.fillTriangle(px - 4, fenceY, px + 4, fenceY, px, fenceY - 5);
      g.fillStyle(0xd9d3c5, 0.8);
      g.fillRect(px + 2, fenceY, 2, 24);
    }

    // Climbing Ivy on Fence
    g.fillStyle(0x52b788, 0.9);
    for (let i = 0; i < postCount; i += 3) {
      const px = bounds.left + 22 + i * 22;
      g.fillEllipse(px - 2, fenceY + 8, 9, 6);
      g.fillEllipse(px + 4, fenceY + 14, 8, 5);
      g.fillStyle(0xff99c8, 1);
      g.fillCircle(px + 1, fenceY + 11, 2.5);
      g.fillStyle(0x52b788, 0.9);
    }

    // Winding Cobblestone Garden Path
    const startX = bounds.left + 58;
    const startY = bounds.top + 50;
    const stoneCoords: [number, number, number, number][] = [
      [startX, startY, 24, 16],
      [startX + 18, startY + 36, 26, 17],
      [startX + 42, startY + 74, 28, 18],
      [startX + 28, startY + 116, 24, 16],
      [startX + 50, startY + 158, 27, 18],
      [startX + 38, startY + 200, 25, 17],
    ];
    stoneCoords.forEach(([sx, sy, rw, rh]) => {
      if (sy < bounds.bottom - 45) {
        g.fillStyle(0x8a9e70, 0.6);
        g.fillEllipse(sx + 2, sy + 3, rw, rh);
        g.fillStyle(0xe2ded4, 0.95);
        g.fillEllipse(sx, sy, rw, rh);
        g.fillStyle(0xf5f3ee, 0.8);
        g.fillEllipse(sx - 2, sy - 2, rw * 0.65, rh * 0.6);
      }
    });

    // Picnic Blanket (Top Right)
    const rugX = bounds.right - 76;
    const rugY = bounds.top + 62;
    g.fillStyle(0x8a9e70, 0.4);
    g.fillRoundedRect(rugX - 48, rugY - 26, 96, 56, 16);
    g.fillStyle(0xffccd5, 1);
    g.fillRoundedRect(rugX - 45, rugY - 24, 90, 52, 14);

    g.fillStyle(0xffb3c1, 0.7);
    for (let bx = rugX - 42; bx < rugX + 42; bx += 14) {
      g.fillRect(bx, rugY - 24, 7, 52);
    }
    for (let by = rugY - 22; by < rugY + 26; by += 14) {
      g.fillRect(rugX - 45, by, 90, 7);
    }

    g.fillStyle(0xffffff, 0.95);
    g.fillEllipse(rugX - 22, rugY - 4, 24, 18);
    g.fillStyle(0xffe5ec, 1);
    g.fillCircle(rugX - 22, rugY - 4, 4);

    // Stone Birdbath (Bottom Right)
    const bbX = bounds.right - 58;
    const bbY = bounds.bottom - 70;
    g.fillStyle(0x768a62, 0.5);
    g.fillEllipse(bbX, bbY + 12, 38, 16);
    g.fillStyle(0xc5beaf, 1);
    g.fillEllipse(bbX, bbY + 10, 24, 10);
    g.fillRect(bbX - 4, bbY - 8, 8, 18);
    g.fillStyle(0xdcd7cd, 1);
    g.fillEllipse(bbX, bbY - 8, 44, 24);
    g.fillStyle(0x8ecae6, 0.95);
    g.fillEllipse(bbX, bbY - 9, 36, 18);
    g.fillStyle(0xffffff, 0.7);
    g.fillEllipse(bbX - 6, bbY - 11, 14, 6);

    // Blooming Flowerbeds
    const flowerCoords: [number, number, number, number][] = [
      [bounds.left + 32, bounds.top + 88, 0xffffff, 0xffcc00],
      [bounds.left + 44, bounds.top + 96, 0xc77dff, 0xffffff],
      [bounds.right - 35, bounds.bottom - 42, 0xffd166, 0xff9f1c],
      [bounds.right - 50, bounds.bottom - 38, 0xffffff, 0xffcc00],
      [bounds.left + bounds.width * 0.48, bounds.top + 42, 0xff99c8, 0xffffff],
      [bounds.left + bounds.width * 0.72, bounds.bottom - 52, 0xc77dff, 0xffffff],
      [bounds.left + bounds.width * 0.28, bounds.bottom - 44, 0xffffff, 0xffcc00],
    ];
    flowerCoords.forEach(([fx, fy, petalCol, centerCol]) => {
      g.fillStyle(petalCol, 0.95);
      g.fillCircle(fx - 3.5, fy, 3.5);
      g.fillCircle(fx + 3.5, fy, 3.5);
      g.fillCircle(fx, fy - 3.5, 3.5);
      g.fillCircle(fx, fy + 3.5, 3.5);
      g.fillStyle(centerCol, 1);
      g.fillCircle(fx, fy, 2.5);
    });

    this.drawBowlsStation(g, bounds, 0xff758f, 0x48cae4);

    if (state.weather === 'sunny' && state.timeOfDay !== 'night') {
      g.fillStyle(0xfffae6, 0.14);
      g.fillTriangle(bounds.right - 180, bounds.top, bounds.right, bounds.top, bounds.right, bounds.top + 260);
      g.fillTriangle(bounds.right - 90, bounds.top, bounds.right, bounds.top, bounds.right, bounds.top + 140);
    }
  }

  private drawShelterBackground(): void {
    const bounds = this.areaBounds();
    const g = this.scene.add.graphics({ x: 0, y: 0 });
    g.name = 'area-bg';
    g.setDepth(-100);

    g.fillStyle(0x543d2b, 0.5);
    g.fillRoundedRect(bounds.x - 6, bounds.y - 6, bounds.width + 12, bounds.height + 12, 28);
    g.fillStyle(0x735741, 1);
    g.fillRoundedRect(bounds.x - 3, bounds.y - 3, bounds.width + 6, bounds.height + 6, 26);

    g.fillStyle(0xdfba87, 1);
    g.fillRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, 24);

    const wallHeight = Math.min(84, bounds.height * 0.28);
    g.fillStyle(0xf7ede2, 1);
    g.fillRoundedRect(bounds.x, bounds.y, bounds.width, wallHeight, 20);
    g.fillRect(bounds.x, bounds.y + wallHeight - 14, bounds.width, 14);

    g.fillStyle(0xf1e3d3, 0.7);
    for (let wx = bounds.x + 12; wx < bounds.right - 12; wx += 20) {
      g.fillRect(wx, bounds.y + 4, 3, wallHeight - 16);
    }

    g.fillStyle(0x8a6240, 1);
    g.fillRect(bounds.x, bounds.y + wallHeight - 6, bounds.width, 8);
    g.fillStyle(0xa97d53, 1);
    g.fillRect(bounds.x, bounds.y + wallHeight - 8, bounds.width, 2);

    g.lineStyle(1.5, 0xbe9667, 0.65);
    const plankHeight = 32;
    for (let y = bounds.y + wallHeight + plankHeight; y < bounds.bottom - 8; y += plankHeight) {
      g.beginPath();
      g.moveTo(bounds.x + 8, y);
      g.lineTo(bounds.right - 8, y);
      g.strokePath();

      const offset = (y % 64 === 0) ? 40 : 90;
      for (let x = bounds.x + offset; x < bounds.right - 20; x += 110) {
        g.beginPath();
        g.moveTo(x, y - plankHeight);
        g.lineTo(x, y);
        g.strokePath();
      }
    }

    // Fairy lights
    const fairyY = bounds.y + 12;
    g.lineStyle(1, 0xb08968, 0.7);
    g.beginPath();
    g.moveTo(bounds.left + 16, fairyY);
    for (let fx = bounds.left + 16; fx < bounds.right - 16; fx += 32) {
      g.lineTo(fx + 16, fairyY + 6);
      g.lineTo(fx + 32, fairyY);
    }
    g.strokePath();

    for (let fx = bounds.left + 24; fx < bounds.right - 24; fx += 32) {
      g.fillStyle(0xffe169, 0.95);
      g.fillCircle(fx, fairyY + 5, 3.5);
      g.fillStyle(0xfffae0, 1);
      g.fillCircle(fx, fairyY + 4, 1.5);
    }

    // Fireplace (Top Center)
    const fpX = bounds.x + bounds.width * 0.5;
    const fpY = bounds.y + wallHeight - 12;
    const fpW = Math.min(120, bounds.width * 0.35);

    g.fillStyle(0x735741, 0.5);
    g.fillRect(fpX - fpW / 2 - 2, fpY - 42, fpW + 4, 48);
    g.fillStyle(0xb08968, 1);
    g.fillRoundedRect(fpX - fpW / 2, fpY - 40, fpW, 46, 6);

    g.fillStyle(0x9c6644, 0.9);
    g.fillRect(fpX - fpW / 2 + 6, fpY - 34, 18, 8);
    g.fillRect(fpX - fpW / 2 + 28, fpY - 34, 18, 8);
    g.fillRect(fpX + fpW / 2 - 24, fpY - 34, 18, 8);
    g.fillRect(fpX - fpW / 2 + 16, fpY - 22, 20, 8);
    g.fillRect(fpX + fpW / 2 - 36, fpY - 22, 20, 8);

    g.fillStyle(0x2b1e17, 1);
    g.fillRoundedRect(fpX - 26, fpY - 26, 52, 32, 6);

    g.fillStyle(0xff5400, 0.9);
    g.fillTriangle(fpX - 16, fpY + 2, fpX + 16, fpY + 2, fpX, fpY - 18);
    g.fillStyle(0xffbe0b, 1);
    g.fillTriangle(fpX - 10, fpY + 2, fpX + 10, fpY + 2, fpX, fpY - 12);
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(fpX, fpY - 2, 4);

    g.fillStyle(0xff9e00, 0.15);
    g.fillCircle(fpX, fpY, 44);

    g.fillStyle(0x582f0e, 1);
    g.fillRoundedRect(fpX - fpW / 2 - 8, fpY - 44, fpW + 16, 8, 3);
    g.fillStyle(0x7f4f24, 1);
    g.fillRect(fpX - fpW / 2 - 6, fpY - 44, fpW + 12, 2);

    g.fillStyle(0xd4a373, 1);
    g.fillRect(fpX - fpW / 2 + 2, fpY - 50, 8, 6);
    g.fillStyle(0x52b788, 1);
    g.fillCircle(fpX - fpW / 2 + 6, fpY - 52, 5);

    g.fillStyle(0xffcad4, 1);
    g.fillCircle(fpX + fpW / 2 - 6, fpY - 50, 6);
    g.fillStyle(0x4a4e69, 1);
    g.fillCircle(fpX + fpW / 2 - 6, fpY - 50, 1.5);

    // Beds
    const bed1X = bounds.left + 64;
    const bed1Y = bounds.top + wallHeight + 36;
    g.fillStyle(0x7a6855, 0.35);
    g.fillEllipse(bed1X, bed1Y + 6, 68, 36);
    g.fillStyle(0x90e0ef, 1);
    g.fillEllipse(bed1X, bed1Y, 64, 40);
    g.fillStyle(0x00b4d8, 0.4);
    g.fillEllipse(bed1X, bed1Y, 52, 30);
    g.fillStyle(0xcaf0f8, 1);
    g.fillEllipse(bed1X, bed1Y - 2, 44, 24);

    const bed2X = bounds.right - 68;
    const bed2Y = bounds.top + wallHeight + 36;
    g.fillStyle(0x7a6855, 0.35);
    g.fillEllipse(bed2X, bed2Y + 6, 68, 36);
    g.fillStyle(0xffb3c1, 1);
    g.fillEllipse(bed2X, bed2Y, 64, 40);
    g.fillStyle(0xff758f, 0.4);
    g.fillEllipse(bed2X, bed2Y, 52, 30);
    g.fillStyle(0xffe5ec, 1);
    g.fillEllipse(bed2X, bed2Y - 2, 44, 24);

    // Large Wool Rug
    const rugX = bounds.x + bounds.width * 0.5;
    const rugY = bounds.y + bounds.height * 0.68;
    const rugW = Math.min(180, bounds.width * 0.6);
    const rugH = Math.min(90, bounds.height * 0.32);

    g.fillStyle(0x8a705a, 0.3);
    g.fillRoundedRect(rugX - rugW / 2 - 2, rugY - rugH / 2 + 2, rugW + 4, rugH + 2, 22);
    g.fillStyle(0xf7ede2, 0.96);
    g.fillRoundedRect(rugX - rugW / 2, rugY - rugH / 2, rugW, rugH, 20);

    g.lineStyle(2, 0xddb892, 0.85);
    g.strokeRoundedRect(rugX - rugW / 2 + 8, rugY - rugH / 2 + 8, rugW - 16, rugH - 16, 14);
    g.fillStyle(0xe6ccb2, 0.5);
    g.fillEllipse(rugX, rugY, rugW * 0.5, rugH * 0.5);

    g.fillStyle(0xddb892, 0.9);
    for (let fx = rugX - rugW / 2 + 10; fx < rugX + rugW / 2 - 10; fx += 12) {
      g.fillRect(fx, rugY - rugH / 2 - 4, 3, 5);
      g.fillRect(fx, rugY + rugH / 2 - 1, 3, 5);
    }

    this.drawBowlsStation(g, bounds, 0xff758f, 0x48cae4);
  }

  private drawSunroomBackground(state: GameState): void {
    const bounds = this.areaBounds();
    const g = this.scene.add.graphics({ x: 0, y: 0 });
    g.name = 'area-bg';
    g.setDepth(-100);

    g.fillStyle(0x2d4a3e, 0.5);
    g.fillRoundedRect(bounds.x - 6, bounds.y - 6, bounds.width + 12, bounds.height + 12, 28);
    g.fillStyle(0x406a52, 1);
    g.fillRoundedRect(bounds.x - 3, bounds.y - 3, bounds.width + 6, bounds.height + 6, 26);

    g.fillStyle(0xeddcd2, 1);
    g.fillRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, 24);

    const winH = Math.min(100, bounds.height * 0.32);
    g.fillStyle(0xd8f3dc, 0.7);
    g.fillRoundedRect(bounds.x, bounds.y, bounds.width, winH, 20);

    g.fillStyle(0x95d5b2, 0.4);
    g.fillRect(bounds.x, bounds.y + 4, bounds.width, winH * 0.5);

    g.lineStyle(2, 0x2d6a4f, 0.75);
    const archWidth = Math.max(50, Math.floor(bounds.width / 5));
    for (let ax = bounds.x + archWidth; ax < bounds.right - 10; ax += archWidth) {
      g.beginPath();
      g.moveTo(ax, bounds.y + 4);
      g.lineTo(ax, bounds.y + winH);
      g.strokePath();

      g.beginPath();
      g.arc(ax - archWidth / 2, bounds.y + 24, archWidth / 2 - 4, Math.PI, 0, false);
      g.strokePath();
    }

    g.fillStyle(0x1b4332, 1);
    g.fillRect(bounds.x, bounds.y + winH - 4, bounds.width, 6);
    g.fillStyle(0x40916c, 1);
    g.fillRect(bounds.x, bounds.y + winH - 6, bounds.width, 2);

    g.lineStyle(1.5, 0xddb892, 0.6);
    const tileSize = 36;
    for (let x = bounds.x + tileSize; x < bounds.right - 8; x += tileSize) {
      g.beginPath();
      g.moveTo(x, bounds.y + winH);
      g.lineTo(x, bounds.bottom - 8);
      g.strokePath();
    }
    for (let y = bounds.y + winH + tileSize; y < bounds.bottom - 8; y += tileSize) {
      g.beginPath();
      g.moveTo(bounds.x + 8, y);
      g.lineTo(bounds.right - 8, y);
      g.strokePath();
    }

    for (let tx = bounds.x + tileSize * 1.5; tx < bounds.right - tileSize; tx += tileSize * 2) {
      for (let ty = bounds.y + winH + tileSize * 1.5; ty < bounds.bottom - tileSize; ty += tileSize * 2) {
        g.fillStyle(0x74c69d, 0.45);
        g.fillCircle(tx, ty, 6);
        g.fillStyle(0xd94e34, 0.45);
        g.fillCircle(tx, ty, 3);
      }
    }

    const planter1X = bounds.left + 54;
    const planter2X = bounds.right - 54;
    [planter1X, planter2X].forEach((px) => {
      g.lineStyle(1.5, 0xd4a373, 0.9);
      g.beginPath();
      g.moveTo(px, bounds.y);
      g.lineTo(px, bounds.y + 36);
      g.strokePath();

      g.fillStyle(0xffffff, 0.95);
      g.fillEllipse(px, bounds.y + 40, 26, 16);
      g.fillStyle(0xe9ecef, 1);
      g.fillEllipse(px, bounds.y + 43, 20, 10);

      g.fillStyle(0x2d6a4f, 0.95);
      g.fillEllipse(px - 8, bounds.y + 36, 16, 12);
      g.fillEllipse(px + 8, bounds.y + 36, 16, 12);
      g.fillEllipse(px, bounds.y + 32, 14, 18);
      g.fillCircle(px - 10, bounds.y + 48, 4);
      g.fillCircle(px - 8, bounds.y + 55, 3);
      g.fillCircle(px + 10, bounds.y + 48, 4);
      g.fillCircle(px + 12, bounds.y + 57, 3.5);
    });

    const mX = bounds.left + 50;
    const mY = bounds.bottom - 68;
    g.fillStyle(0x8a705a, 0.35);
    g.fillEllipse(mX, mY + 22, 38, 14);
    g.fillStyle(0xba7c59, 1);
    g.fillPoints([
      new Phaser.Geom.Point(mX - 16, mY),
      new Phaser.Geom.Point(mX + 16, mY),
      new Phaser.Geom.Point(mX + 12, mY + 24),
      new Phaser.Geom.Point(mX - 12, mY + 24),
    ], true);
    g.fillStyle(0x40916c, 0.95);
    g.fillEllipse(mX - 18, mY - 14, 28, 18);
    g.fillEllipse(mX + 18, mY - 14, 28, 18);
    g.fillEllipse(mX, mY - 26, 22, 32);
    g.fillStyle(0x52b788, 1);
    g.fillCircle(mX - 12, mY - 14, 4);
    g.fillCircle(mX + 12, mY - 14, 4);

    const ftX = bounds.right - 64;
    const ftY = bounds.y + winH + 46;
    g.fillStyle(0x8a705a, 0.35);
    g.fillEllipse(ftX, ftY + 20, 52, 20);
    g.fillStyle(0xb7b7a4, 1);
    g.fillEllipse(ftX, ftY + 14, 38, 16);
    g.fillRect(ftX - 5, ftY - 4, 10, 18);
    g.fillStyle(0xddbea9, 1);
    g.fillEllipse(ftX, ftY - 4, 48, 24);
    g.fillStyle(0x90e0ef, 0.95);
    g.fillEllipse(ftX, ftY - 5, 40, 18);
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(ftX, ftY - 6, 4);

    const cushX = bounds.x + bounds.width * 0.48;
    const cushY = bounds.y + bounds.height * 0.62;
    g.fillStyle(0x8a705a, 0.3);
    g.fillEllipse(cushX, cushY + 8, 96, 46);
    g.fillStyle(0xffb703, 0.95);
    g.fillEllipse(cushX, cushY, 90, 48);
    g.fillStyle(0xfb8500, 0.35);
    g.fillEllipse(cushX, cushY, 72, 34);
    g.fillStyle(0xffe3a8, 1);
    g.fillEllipse(cushX, cushY - 4, 58, 24);

    if (state.timeOfDay !== 'night') {
      g.fillStyle(0xfffa80, 0.16);
      g.fillTriangle(bounds.left + 50, bounds.top, bounds.left + 180, bounds.top, bounds.left + 270, bounds.bottom - 30);
      g.fillTriangle(bounds.right - 210, bounds.top, bounds.right - 70, bounds.top, bounds.right - 10, bounds.bottom - 40);
    }

    this.drawBowlsStation(g, bounds, 0xfb8500, 0x00b4d8);
  }

  private drawCafeBackground(): void {
    const bounds = this.areaBounds();
    const g = this.scene.add.graphics({ x: 0, y: 0 });
    g.name = 'area-bg';
    g.setDepth(-100);

    g.fillStyle(0x3e2723, 0.55);
    g.fillRoundedRect(bounds.x - 6, bounds.y - 6, bounds.width + 12, bounds.height + 12, 28);
    g.fillStyle(0x5d4037, 1);
    g.fillRoundedRect(bounds.x - 3, bounds.y - 3, bounds.width + 6, bounds.height + 6, 26);

    g.fillStyle(0xd7ba89, 1);
    g.fillRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, 24);

    const wallH = Math.min(88, bounds.height * 0.28);
    g.fillStyle(0x8d5b4c, 1);
    g.fillRoundedRect(bounds.x, bounds.y, bounds.width, wallH, 20);
    g.fillRect(bounds.x, bounds.y + wallH - 14, bounds.width, 14);

    g.fillStyle(0x6d3d30, 0.85);
    for (let by = bounds.y + 6; by < bounds.y + wallH - 12; by += 14) {
      const offset = (by % 28 === 0) ? 0 : 16;
      for (let bx = bounds.x + 8 + offset; bx < bounds.right - 16; bx += 32) {
        g.fillRect(bx, by, 28, 10);
      }
    }

    g.fillStyle(0x4e342e, 1);
    g.fillRect(bounds.x, bounds.y + wallH - 6, bounds.width, 8);
    g.fillStyle(0x8d6e63, 1);
    g.fillRect(bounds.x, bounds.y + wallH - 8, bounds.width, 2);

    g.lineStyle(1.5, 0xb08968, 0.6);
    for (let y = bounds.y + wallH + 28; y < bounds.bottom - 8; y += 28) {
      g.beginPath();
      g.moveTo(bounds.x + 8, y);
      g.lineTo(bounds.right - 8, y);
      g.strokePath();
    }

    // Espresso bar
    const barX = bounds.x + bounds.width * 0.5;
    const barY = bounds.y + wallH - 14;
    const barW = Math.min(220, bounds.width * 0.65);

    g.fillStyle(0x2d1810, 0.4);
    g.fillRoundedRect(barX - barW / 2 - 2, barY - 26, barW + 4, 46, 12);
    g.fillStyle(0x5d4037, 1);
    g.fillRoundedRect(barX - barW / 2, barY - 24, barW, 44, 10);
    g.fillStyle(0xede0d4, 1);
    g.fillRoundedRect(barX - barW / 2 - 4, barY - 26, barW + 8, 12, 6);

    g.fillStyle(0xd4af37, 1);
    g.fillRoundedRect(barX - 44, barY - 48, 38, 24, 4);
    g.fillStyle(0xffe066, 1);
    g.fillRect(barX - 40, barY - 44, 30, 4);
    g.fillStyle(0x333333, 1);
    g.fillRect(barX - 38, barY - 26, 8, 4);
    g.fillRect(barX - 22, barY - 26, 8, 4);

    g.fillStyle(0xe0f7fa, 0.8);
    g.fillCircle(barX + 32, barY - 32, 12);
    g.fillStyle(0xd4a373, 1);
    g.fillCircle(barX + 32, barY - 30, 6);

    g.fillStyle(0xff758f, 1);
    g.fillRoundedRect(barX - 4, barY - 24, 10, 10, 2);
    g.fillStyle(0x48cae4, 1);
    g.fillRoundedRect(barX + 10, barY - 24, 10, 10, 2);

    const menuX = bounds.left + 24;
    const menuY = bounds.top + 16;
    g.fillStyle(0x3e2723, 1);
    g.fillRoundedRect(menuX, menuY, 52, 38, 6);
    g.fillStyle(0x263238, 1);
    g.fillRoundedRect(menuX + 4, menuY + 4, 44, 30, 4);
    g.fillStyle(0xffffff, 0.85);
    g.fillRect(menuX + 10, menuY + 10, 26, 2);
    g.fillRect(menuX + 10, menuY + 16, 32, 2);
    g.fillRect(menuX + 10, menuY + 22, 22, 2);
    g.fillStyle(0xffcad4, 1);
    g.fillCircle(menuX + 38, menuY + 24, 3);

    const lamp1X = bounds.left + bounds.width * 0.28;
    const lamp2X = bounds.right - bounds.width * 0.28;
    [lamp1X, lamp2X].forEach((lx) => {
      g.lineStyle(1.5, 0x3e2723, 1);
      g.beginPath();
      g.moveTo(lx, bounds.y);
      g.lineTo(lx, bounds.y + 26);
      g.strokePath();

      g.fillStyle(0xd4af37, 1);
      g.fillTriangle(lx - 12, bounds.y + 36, lx + 12, bounds.y + 36, lx, bounds.y + 24);
      g.fillStyle(0xfffae0, 1);
      g.fillCircle(lx, bounds.y + 37, 4);

      g.fillStyle(0xfffae0, 0.12);
      g.fillEllipse(lx, bounds.y + bounds.height * 0.5, 110, 50);
    });

    const tableX = bounds.x + bounds.width * 0.5;
    const tableY = bounds.y + bounds.height * 0.65;
    g.fillStyle(0x8a705a, 0.35);
    g.fillEllipse(tableX, tableY + 8, 116, 62);
    g.fillStyle(0xccd5ae, 0.95);
    g.fillEllipse(tableX, tableY, 108, 56);
    g.fillStyle(0xe9edc9, 1);
    g.fillEllipse(tableX, tableY, 92, 44);

    g.fillStyle(0x7f4f24, 1);
    g.fillEllipse(tableX, tableY - 14, 56, 28);
    g.fillStyle(0x936639, 1);
    g.fillEllipse(tableX, tableY - 16, 48, 22);

    g.fillStyle(0xffffff, 1);
    g.fillCircle(tableX, tableY - 18, 7);
    g.fillStyle(0x8d5b4c, 1);
    g.fillCircle(tableX, tableY - 18, 5);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(tableX, tableY - 18, 2);

    this.drawBowlsStation(g, bounds, 0x9c27b0, 0x009688);
  }

  private drawBowlsStation(
    g: Phaser.GameObjects.Graphics,
    bounds: Phaser.Geom.Rectangle,
    foodColor: number,
    waterColor: number,
  ): void {
    const bowlY = bounds.bottom - 34;
    const foodBowlX = bounds.left + 48;
    const waterBowlX = bounds.left + 94;

    g.fillStyle(0x000000, 0.15);
    g.fillRoundedRect(bounds.left + 22, bowlY - 18, 98, 40, 16);

    g.fillStyle(0xfdf0d5, 1);
    g.fillRoundedRect(bounds.left + 24, bowlY - 20, 94, 38, 14);
    g.lineStyle(2, 0xe0c3aa, 0.9);
    g.strokeRoundedRect(bounds.left + 24, bowlY - 20, 94, 38, 14);

    g.fillStyle(0xd4a373, 0.7);
    g.fillCircle(bounds.left + 35, bowlY - 6, 3);
    g.fillCircle(bounds.left + 107, bowlY - 6, 3);

    g.fillStyle(0x666666, 0.35);
    g.fillEllipse(foodBowlX, bowlY + 4, 32, 16);
    g.fillStyle(foodColor, 1);
    g.fillEllipse(foodBowlX, bowlY, 30, 18);
    g.fillStyle(0x7f4f24, 1);
    g.fillEllipse(foodBowlX, bowlY - 2, 22, 12);
    g.fillStyle(0xba7c59, 1);
    g.fillCircle(foodBowlX - 4, bowlY - 3, 3);
    g.fillCircle(foodBowlX + 3, bowlY - 2, 2.5);

    g.fillStyle(0x666666, 0.35);
    g.fillEllipse(waterBowlX, bowlY + 4, 32, 16);
    g.fillStyle(waterColor, 1);
    g.fillEllipse(waterBowlX, bowlY, 30, 18);
    g.fillStyle(0x8ecae6, 1);
    g.fillEllipse(waterBowlX, bowlY - 2, 22, 12);
    g.fillStyle(0xffffff, 0.85);
    g.fillEllipse(waterBowlX - 4, bowlY - 4, 10, 4);
  }

  private drawPlacedFurniture(currentArea: CatArea, state: GameState): void {
    const bounds = this.areaBounds();
    const ownedFurniture = FURNITURE_CATALOG.filter(
      (f) => f.area === currentArea && state.furniture.includes(f.id),
    );

    for (const item of ownedFurniture) {
      const fx = bounds.left + bounds.width * item.xPercent;
      const fy = bounds.top + bounds.height * item.yPercent;

      const fGfx = this.scene.add.graphics();
      fGfx.name = 'area-bg';
      fGfx.setDepth(fy - 5);

      switch (item.id) {
        case 'plush_donut_bed': {
          fGfx.fillStyle(0x3d291a, 0.16);
          fGfx.fillEllipse(fx, fy + 14, 68, 26);
          fGfx.fillStyle(0xe07a5f, 1);
          fGfx.fillEllipse(fx, fy + 2, 60, 36);
          fGfx.fillStyle(0xf4a261, 0.7);
          fGfx.fillEllipse(fx, fy, 54, 30);
          fGfx.fillStyle(0xfefae0, 1);
          fGfx.fillEllipse(fx, fy - 2, 44, 24);
          fGfx.fillStyle(0xfaedcd, 1);
          fGfx.fillEllipse(fx, fy - 3, 34, 18);
          fGfx.fillStyle(0xe76f51, 0.8);
          fGfx.fillCircle(fx - 2, fy - 4, 3);
          fGfx.fillCircle(fx + 2, fy - 4, 3);
          fGfx.beginPath();
          fGfx.moveTo(fx - 5, fy - 3);
          fGfx.lineTo(fx + 5, fy - 3);
          fGfx.lineTo(fx, fy + 2);
          fGfx.closePath();
          fGfx.fillPath();
          break;
        }
        case 'sisal_cat_tree': {
          fGfx.fillStyle(0x3d291a, 0.18);
          fGfx.fillEllipse(fx, fy + 24, 64, 22);
          fGfx.fillStyle(0x7f5539, 1);
          fGfx.fillEllipse(fx, fy + 20, 56, 18);
          fGfx.fillStyle(0x9c6644, 1);
          fGfx.fillEllipse(fx, fy + 18, 50, 14);
          fGfx.fillStyle(0xddb892, 1);
          fGfx.fillRect(fx - 9, fy - 40, 18, 60);

          fGfx.fillStyle(0xb08968, 0.65);
          for (let sy = fy - 36; sy < fy + 16; sy += 6) {
            fGfx.fillRect(fx - 9, sy, 18, 2.5);
          }

          fGfx.fillStyle(0x7f5539, 1);
          fGfx.fillRoundedRect(fx - 24, fy - 12, 22, 8, 3);
          fGfx.fillStyle(0xfefae0, 1);
          fGfx.fillRoundedRect(fx - 22, fy - 14, 18, 5, 2);

          fGfx.fillStyle(0x7f5539, 1);
          fGfx.fillEllipse(fx, fy - 40, 50, 20);
          fGfx.fillStyle(0xfefae0, 1);
          fGfx.fillEllipse(fx, fy - 42, 44, 16);
          fGfx.fillStyle(0xfaedcd, 1);
          fGfx.fillEllipse(fx, fy - 43, 34, 11);

          fGfx.lineStyle(1.5, 0x8a6240, 0.85);
          fGfx.beginPath();
          fGfx.moveTo(fx + 18, fy - 40);
          fGfx.lineTo(fx + 18, fy - 22);
          fGfx.strokePath();

          fGfx.fillStyle(0xe07a5f, 1);
          fGfx.fillCircle(fx + 18, fy - 20, 5.5);
          fGfx.fillStyle(0xf4a261, 1);
          fGfx.fillCircle(fx + 17, fy - 21, 2.5);
          break;
        }
        case 'sunbeam_mat': {
          fGfx.fillStyle(0x3d291a, 0.14);
          fGfx.fillEllipse(fx, fy + 12, 76, 30);
          fGfx.fillStyle(0xf4a261, 0.95);
          fGfx.fillEllipse(fx, fy + 2, 70, 34);
          fGfx.fillStyle(0xffe3a8, 0.85);
          fGfx.fillEllipse(fx, fy, 62, 28);
          fGfx.fillStyle(0xfefae0, 1);
          fGfx.fillEllipse(fx, fy - 2, 50, 20);

          fGfx.lineStyle(1.5, 0xe76f51, 0.35);
          for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
            fGfx.beginPath();
            fGfx.moveTo(fx + Math.cos(angle) * 8, fy - 2 + Math.sin(angle) * 4);
            fGfx.lineTo(fx + Math.cos(angle) * 26, fy - 2 + Math.sin(angle) * 11);
            fGfx.strokePath();
          }

          fGfx.fillStyle(0xe76f51, 0.9);
          fGfx.fillCircle(fx - 32, fy + 2, 3);
          fGfx.fillCircle(fx + 32, fy + 2, 3);
          break;
        }
        case 'cardboard_castle': {
          fGfx.fillStyle(0x3d291a, 0.18);
          fGfx.fillEllipse(fx, fy + 20, 68, 24);
          fGfx.fillStyle(0xcca783, 1);
          fGfx.fillRoundedRect(fx - 30, fy - 24, 60, 42, 6);
          fGfx.fillStyle(0xddb892, 0.6);
          fGfx.fillRect(fx - 28, fy - 22, 56, 4);

          fGfx.fillStyle(0xcca783, 1);
          fGfx.fillRect(fx - 30, fy - 33, 14, 11);
          fGfx.fillRect(fx - 7, fy - 33, 14, 11);
          fGfx.fillRect(fx + 16, fy - 33, 14, 11);

          fGfx.fillStyle(0x58311a, 1);
          fGfx.fillRoundedRect(fx - 13, fy - 6, 26, 24, 8);

          fGfx.beginPath();
          fGfx.moveTo(fx - 12, fy - 6);
          fGfx.lineTo(fx - 7, fy - 14);
          fGfx.lineTo(fx - 2, fy - 6);
          fGfx.closePath();
          fGfx.fillPath();

          fGfx.beginPath();
          fGfx.moveTo(fx + 2, fy - 6);
          fGfx.lineTo(fx + 7, fy - 14);
          fGfx.lineTo(fx + 12, fy - 6);
          fGfx.closePath();
          fGfx.fillPath();

          fGfx.fillStyle(0x9c7a5b, 0.85);
          fGfx.fillCircle(fx + 20, fy - 8, 3);
          fGfx.fillCircle(fx + 17, fy - 14, 1.5);
          fGfx.fillCircle(fx + 20, fy - 16, 1.5);
          fGfx.fillCircle(fx + 23, fy - 14, 1.5);
          break;
        }
        case 'fountain_dish': {
          fGfx.fillStyle(0x3d291a, 0.16);
          fGfx.fillEllipse(fx, fy + 16, 60, 22);
          fGfx.fillStyle(0xfbfbf2, 1);
          fGfx.fillEllipse(fx, fy + 8, 52, 24);
          fGfx.fillStyle(0xcce3de, 1);
          fGfx.fillEllipse(fx, fy + 6, 44, 18);

          fGfx.fillStyle(0x83c5be, 0.85);
          fGfx.fillEllipse(fx, fy + 5, 38, 14);
          fGfx.fillStyle(0xa2d2ff, 0.6);
          fGfx.fillEllipse(fx, fy + 4, 30, 10);

          fGfx.fillStyle(0xffccd5, 1);
          fGfx.fillCircle(fx - 4, fy - 3, 5);
          fGfx.fillCircle(fx + 4, fy - 3, 5);
          fGfx.fillCircle(fx, fy - 6, 5);
          fGfx.fillStyle(0xfff0f3, 1);
          fGfx.fillCircle(fx, fy - 3, 4);
          fGfx.fillStyle(0xf4a261, 1);
          fGfx.fillCircle(fx, fy - 3, 2.5);

          fGfx.fillStyle(0xffffff, 0.9);
          fGfx.fillCircle(fx - 12, fy + 4, 2);
          fGfx.fillCircle(fx + 12, fy + 6, 1.5);
          break;
        }
        default: {
          const fText = this.scene.add.text(fx, fy, item.bonusText || '✨', {
            fontSize: '12px',
          }).setOrigin(0.5, 0.7).setDepth(fy);
          fText.name = 'area-bg';
        }
      }
    }
  }

  private drawFenceDividers(currentArea: CatArea, layout: FenceLayout): void {
    if (layout === 'none') return;

    const bounds = this.walkableBounds(currentArea);
    const g = this.scene.add.graphics();
    g.name = 'area-bg';
    g.setDepth(680);

    const midX = bounds.centerX;
    const midY = bounds.centerY;

    if (currentArea === 'yard') {
      const postColor = 0xffffff;
      const shadowColor = 0xc8c3b5;
      const railColor = 0xede7d9;
      const leafColor = 0x40916c;

      if (layout === 'horizontal' || layout === 'both') {
        g.fillStyle(railColor, 0.95);
        g.fillRect(bounds.left, midY - 6, bounds.width, 3);
        g.fillRect(bounds.left, midY + 4, bounds.width, 3);

        const count = Math.floor(bounds.width / 20);
        for (let i = 0; i < count; i++) {
          const px = bounds.left + 10 + i * 20;
          g.fillStyle(postColor, 1);
          g.fillRect(px - 3, midY - 14, 6, 26);
          g.fillTriangle(px - 3, midY - 14, px + 3, midY - 14, px, midY - 18);
          g.fillStyle(shadowColor, 0.8);
          g.fillRect(px + 1, midY - 14, 2, 26);

          if (i % 3 === 0) {
            g.fillStyle(leafColor, 0.85);
            g.fillEllipse(px - 2, midY - 2, 7, 5);
          }
        }
      }

      if (layout === 'vertical' || layout === 'both') {
        g.fillStyle(railColor, 0.95);
        g.fillRect(midX - 6, bounds.top, 3, bounds.height);
        g.fillRect(midX + 4, bounds.top, 3, bounds.height);

        const count = Math.floor(bounds.height / 20);
        for (let i = 0; i < count; i++) {
          const py = bounds.top + 10 + i * 20;
          g.fillStyle(postColor, 1);
          g.fillRect(midX - 14, py - 3, 26, 6);
          g.fillStyle(shadowColor, 0.8);
          g.fillRect(midX - 14, py + 1, 26, 2);

          if (i % 3 === 1) {
            g.fillStyle(leafColor, 0.85);
            g.fillEllipse(midX - 4, py - 2, 6, 6);
          }
        }
      }
    } else if (currentArea === 'shelter') {
      const timberColor = 0x5c4033;
      const stoneColor = 0x8b7355;
      const highlight = 0xa08264;

      if (layout === 'horizontal' || layout === 'both') {
        g.fillStyle(stoneColor, 0.95);
        g.fillRoundedRect(bounds.left, midY - 7, bounds.width, 14, 4);
        g.fillStyle(timberColor, 1);
        g.fillRect(bounds.left, midY - 4, bounds.width, 8);
        g.fillStyle(highlight, 0.7);
        g.fillRect(bounds.left, midY - 7, bounds.width, 2);
      }

      if (layout === 'vertical' || layout === 'both') {
        g.fillStyle(stoneColor, 0.95);
        g.fillRoundedRect(midX - 7, bounds.top, 14, bounds.height, 4);
        g.fillStyle(timberColor, 1);
        g.fillRect(midX - 4, bounds.top, 8, bounds.height);
        g.fillStyle(highlight, 0.7);
        g.fillRect(midX - 7, bounds.top, 2, bounds.height);
      }
    } else if (currentArea === 'sunroom') {
      const bambooColor = 0xd4a373;
      const glassColor = 0xa8dadc;

      if (layout === 'horizontal' || layout === 'both') {
        g.fillStyle(glassColor, 0.4);
        g.fillRect(bounds.left, midY - 6, bounds.width, 12);
        g.lineStyle(1.8, bambooColor, 0.9);
        g.lineBetween(bounds.left, midY - 6, bounds.right, midY - 6);
        g.lineBetween(bounds.left, midY + 6, bounds.right, midY + 6);
        const count = Math.floor(bounds.width / 24);
        for (let i = 0; i < count; i++) {
          const px = bounds.left + 12 + i * 24;
          g.lineBetween(px, midY - 8, px, midY + 8);
        }
      }

      if (layout === 'vertical' || layout === 'both') {
        g.fillStyle(glassColor, 0.4);
        g.fillRect(midX - 6, bounds.top, 12, bounds.height);
        g.lineStyle(1.8, bambooColor, 0.9);
        g.lineBetween(midX - 6, bounds.top, midX - 6, bounds.bottom);
        g.lineBetween(midX + 6, bounds.top, midX + 6, bounds.bottom);
        const count = Math.floor(bounds.height / 24);
        for (let i = 0; i < count; i++) {
          const py = bounds.top + 12 + i * 24;
          g.lineBetween(midX - 8, py, midX + 8, py);
        }
      }
    } else {
      const brassColor = 0xd4af37;
      const ropeColor = 0x9b2226;

      if (layout === 'horizontal' || layout === 'both') {
        g.lineStyle(3, ropeColor, 0.95);
        g.lineBetween(bounds.left, midY, bounds.right, midY);
        const count = Math.floor(bounds.width / 36);
        for (let i = 0; i < count; i++) {
          const px = bounds.left + 18 + i * 36;
          g.fillStyle(brassColor, 1);
          g.fillCircle(px, midY, 4.5);
          g.fillRect(px - 2, midY, 4, 12);
        }
      }

      if (layout === 'vertical' || layout === 'both') {
        g.lineStyle(3, ropeColor, 0.95);
        g.lineBetween(midX, bounds.top, midX, bounds.bottom);
        const count = Math.floor(bounds.height / 36);
        for (let i = 0; i < count; i++) {
          const py = bounds.top + 18 + i * 36;
          g.fillStyle(brassColor, 1);
          g.fillCircle(midX, py, 4.5);
          g.fillRect(midX, py - 2, 12, 4);
        }
      }
    }
  }

  private createAdoptionBox(): void {
    if (this.adoptionBoxContainer) {
      this.adoptionBoxContainer.destroy();
      this.adoptionBoxContainer = null;
    }

    const bounds = this.areaBounds();
    const boxX = bounds.left + 54;
    const boxY = bounds.top + 44;

    const container = this.scene.add.container(boxX, boxY);
    container.name = 'area-bg';
    container.setDepth(750);

    const glow = this.scene.add.graphics();
    glow.fillStyle(0xf59e0b, 0.35);
    glow.fillRoundedRect(-46, -34, 92, 68, 18);
    glow.lineStyle(2.5, 0xfbbf24, 0.9);
    glow.strokeRoundedRect(-46, -34, 92, 68, 18);
    glow.setAlpha(0);
    container.add(glow);
    this.adoptionBoxGlow = glow;

    const shadow = this.scene.add.graphics();
    shadow.fillStyle(0x000000, 0.18);
    shadow.fillEllipse(0, 18, 76, 24);
    container.add(shadow);

    const boxGfx = this.scene.add.graphics();

    boxGfx.fillStyle(0xae8252, 1);
    boxGfx.beginPath();
    boxGfx.moveTo(-24, -14);
    boxGfx.lineTo(-28, -25);
    boxGfx.lineTo(28, -25);
    boxGfx.lineTo(24, -14);
    boxGfx.closePath();
    boxGfx.fillPath();
    boxGfx.lineStyle(1.2, 0x7c5832, 0.8);
    boxGfx.strokePath();

    boxGfx.fillStyle(0xcda171, 1);
    boxGfx.beginPath();
    boxGfx.moveTo(-24, -14);
    boxGfx.lineTo(-37, -10);
    boxGfx.lineTo(-37, 10);
    boxGfx.lineTo(-24, 8);
    boxGfx.closePath();
    boxGfx.fillPath();
    boxGfx.lineStyle(1.2, 0x7c5832, 0.8);
    boxGfx.strokePath();

    boxGfx.fillStyle(0xb88b5b, 1);
    boxGfx.beginPath();
    boxGfx.moveTo(24, -14);
    boxGfx.lineTo(37, -10);
    boxGfx.lineTo(37, 10);
    boxGfx.lineTo(24, 8);
    boxGfx.closePath();
    boxGfx.fillPath();
    boxGfx.lineStyle(1.2, 0x7c5832, 0.8);
    boxGfx.strokePath();

    boxGfx.fillStyle(0x825c36, 1);
    boxGfx.fillRoundedRect(-24, -14, 48, 24, 3);
    boxGfx.lineStyle(1.5, 0x5a3e20, 0.9);
    boxGfx.strokeRoundedRect(-24, -14, 48, 24, 3);

    boxGfx.fillStyle(0xfde68a, 0.95);
    boxGfx.fillRoundedRect(-18, -10, 36, 18, 5);
    boxGfx.fillStyle(0xfef08a, 1);
    boxGfx.fillRoundedRect(-16, -8, 32, 14, 4);

    boxGfx.fillStyle(0xdcb080, 1);
    boxGfx.beginPath();
    boxGfx.moveTo(-25, 6);
    boxGfx.lineTo(25, 6);
    boxGfx.lineTo(25, 22);
    boxGfx.lineTo(-25, 22);
    boxGfx.closePath();
    boxGfx.fillPath();
    boxGfx.lineStyle(1.5, 0x8c6239, 0.9);
    boxGfx.strokePath();

    boxGfx.fillStyle(0xe5bc8c, 1);
    boxGfx.beginPath();
    boxGfx.moveTo(-24, 22);
    boxGfx.lineTo(24, 22);
    boxGfx.lineTo(18, 30);
    boxGfx.lineTo(-18, 30);
    boxGfx.closePath();
    boxGfx.fillPath();
    boxGfx.lineStyle(1.2, 0x8c6239, 0.85);
    boxGfx.strokePath();

    boxGfx.lineStyle(1, 0xb48455, 0.6);
    boxGfx.lineBetween(-20, 14, 20, 14);

    container.add(boxGfx);

    const hitZone = this.scene.add.zone(0, 4, 76, 56).setInteractive({ cursor: 'pointer' });
    hitZone.on('pointerdown', () => {
      sound.playTap();
      EventBus.emit('toast', {
        message: '🏡 Drag any cat into the box to find their loving forever home! (+💗 Care Points)',
      });
      this.scene.tweens.add({
        targets: container,
        scaleX: 1.14,
        scaleY: 1.14,
        duration: 100,
        yoyo: true,
        ease: 'Quad.easeOut',
      });
    });
    container.add(hitZone);

    this.adoptionBoxContainer = container;
    this.callbacks.onAdoptionBoxCreated?.(container, glow);
  }

  private createInspectTarget(state: GameState): void {
    if (this.catInspectContainer) {
      this.catInspectContainer.destroy();
      this.catInspectContainer = null;
    }

    const bounds = this.areaBounds();
    const inspectX = bounds.right - 54;
    const inspectY = bounds.top + 44;

    const container = this.scene.add.container(inspectX, inspectY);
    container.name = 'area-bg';
    container.setDepth(750);

    const glow = this.scene.add.graphics();
    glow.fillStyle(0x38bdf8, 0.35);
    glow.fillCircle(0, 0, 36);
    glow.lineStyle(2.5, 0x0284c7, 0.9);
    glow.strokeCircle(0, 0, 36);
    glow.setAlpha(0);
    container.add(glow);
    this.catInspectGlow = glow;

    const shadow = this.scene.add.graphics();
    shadow.fillStyle(0x000000, 0.18);
    shadow.fillEllipse(0, 18, 56, 18);
    container.add(shadow);

    const padGfx = this.scene.add.graphics();
    padGfx.fillStyle(0xfaf5eb, 0.95);
    padGfx.fillCircle(0, 0, 26);
    padGfx.lineStyle(2, 0xd4a373, 0.9);
    padGfx.strokeCircle(0, 0, 26);

    padGfx.lineStyle(1, 0xffedd5, 0.9);
    padGfx.strokeCircle(0, 0, 23);
    container.add(padGfx);

    const glassGfx = this.scene.add.graphics();
    glassGfx.lineStyle(5.5, 0x78350f, 1);
    glassGfx.lineBetween(7, 7, 19, 19);
    glassGfx.lineStyle(3.5, 0xd97706, 1);
    glassGfx.lineBetween(7, 7, 18, 18);

    glassGfx.fillStyle(0xf59e0b, 1);
    glassGfx.fillCircle(-4, -4, 15);
    glassGfx.lineStyle(2, 0xb45309, 1);
    glassGfx.strokeCircle(-4, -4, 15);

    glassGfx.fillStyle(0xe0f2fe, 0.85);
    glassGfx.fillCircle(-4, -4, 12);

    glassGfx.lineStyle(1.8, 0xffffff, 0.95);
    glassGfx.beginPath();
    glassGfx.arc(-4, -4, 9.5, Phaser.Math.DegToRad(190), Phaser.Math.DegToRad(290));
    glassGfx.strokePath();

    container.add(glassGfx);

    const pawText = this.scene.add.text(-4, -3, '🐾', {
      fontSize: '13px',
    }).setOrigin(0.5);
    container.add(pawText);

    const hitZone = this.scene.add.zone(0, 0, 60, 60).setInteractive({ cursor: 'pointer' });
    hitZone.on('pointerdown', () => {
      sound.playTap();
      if (state.cats.length > 0) {
        EventBus.emit('cat-info', { cat: state.cats[0] });
      } else {
        EventBus.emit('toast', {
          message: '🔍 Drag any cat here to open their details and care journal!',
        });
      }
      this.scene.tweens.add({
        targets: container,
        scaleX: 1.15,
        scaleY: 1.15,
        duration: 100,
        yoyo: true,
        ease: 'Quad.easeOut',
      });
    });
    container.add(hitZone);

    this.catInspectContainer = container;
    this.callbacks.onInspectTargetCreated?.(container, glow);
  }

  getAdoptionBoxContainer(): Phaser.GameObjects.Container | null {
    return this.adoptionBoxContainer;
  }

  getAdoptionBoxGlow(): Phaser.GameObjects.Graphics | null {
    return this.adoptionBoxGlow;
  }

  getInspectContainer(): Phaser.GameObjects.Container | null {
    return this.catInspectContainer;
  }

  getInspectGlow(): Phaser.GameObjects.Graphics | null {
    return this.catInspectGlow;
  }
}
