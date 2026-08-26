import type { Cat } from '../data/types';
import { CAT_SKINS } from '../data/catAssets';
import { AREA_INFO_MAP } from '../data/constants';
import { TRAITS } from '../data/traits';
import { sound } from './SoundManager';

export async function exportCatCardAsPng(cat: Cat): Promise<void> {
  sound.playSparkle();

  const canvas = document.createElement('canvas');
  const w = 640;
  const h = 860;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 1. Background Card Body
  ctx.fillStyle = '#fffaf2'; // Warm cream
  ctx.fillRect(0, 0, w, h);

  // Outer Border & Decorative Frame
  ctx.strokeStyle = '#4d3827';
  ctx.lineWidth = 6;
  ctx.strokeRect(16, 16, w - 32, h - 32);

  ctx.strokeStyle = '#ff758f';
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, w - 48, h - 48);

  // 2. Header Banner
  ctx.fillStyle = '#ff758f';
  ctx.fillRect(36, 40, w - 72, 54);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px "Nunito", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🐾 COZY CAT SANCTUARY CERTIFICATE 🐾', w / 2, 75);

  // 3. Cat Avatar Box (Polaroid style)
  const avatarSize = 220;
  const avatarX = (w - avatarSize) / 2;
  const avatarY = 116;

  ctx.fillStyle = '#f0f7ea';
  ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
  ctx.strokeStyle = '#cce3de';
  ctx.lineWidth = 3;
  ctx.strokeRect(avatarX, avatarY, avatarSize, avatarSize);

  // Render pixel art cat sprite onto portrait box
  const skinDef = CAT_SKINS.find((s) => s.id === cat.color);
  if (skinDef) {
    try {
      const baseImg = await loadImage(`assets/cats/${skinDef.file}`);
      ctx.imageSmoothingEnabled = false;
      // Frame 0 of Row 1 (South front facing)
      ctx.drawImage(baseImg, 0, 32, 32, 32, avatarX + 10, avatarY + 10, avatarSize - 20, avatarSize - 20);

      if (cat.marking) {
        const markImg = await loadImage(`assets/cats/Markings/${cat.marking}`);
        ctx.drawImage(markImg, 0, 32, 32, 32, avatarX + 10, avatarY + 10, avatarSize - 20, avatarSize - 20);
      }
    } catch {
      // Fallback placeholder
    }
  }

  // 4. Cat Name & Rarity
  ctx.fillStyle = '#4d3827';
  ctx.font = '900 34px "Nunito", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(cat.name, w / 2, 380);

  const skinName = skinDef?.label ?? cat.color;
  const areaMeta = AREA_INFO_MAP[cat.area];
  const stageLabel = cat.stage === 'kitten' ? '🐾 Kitten' : cat.stage === 'teen' ? '🌱 Teen' : '👑 Adult';
  ctx.fillStyle = '#7c6855';
  ctx.font = 'bold 18px "Nunito", sans-serif';
  ctx.fillText(`${skinName} · ${stageLabel} · ${areaMeta?.emoji ?? '📍'} ${areaMeta?.label ?? 'Sanctuary'}`, w / 2, 412);

  if (cat.isRare) {
    ctx.fillStyle = '#ffb703';
    ctx.font = 'bold 16px "Nunito", sans-serif';
    ctx.fillText('✨ SPECIAL RARE FELINE ✨', w / 2, 438);
  }

  // 5. Divider Line
  ctx.strokeStyle = '#e9d8c4';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(50, 456);
  ctx.lineTo(w - 50, 456);
  ctx.stroke();

  // 6. Personality Traits
  ctx.textAlign = 'left';
  const majorDesc = TRAITS[cat.majorTrait]?.description ?? '';
  const minorDesc = TRAITS[cat.minorTrait]?.description ?? '';

  ctx.fillStyle = '#ffffff';
  drawRoundedRect(ctx, 48, 474, w - 96, 68, 14, '#ffffff', '#e9d8c4');
  ctx.fillStyle = '#4d3827';
  ctx.font = 'bold 16px "Nunito", sans-serif';
  ctx.fillText(`🌟 ${cap(cat.majorTrait)}:`, 64, 502);
  ctx.fillStyle = '#7c6855';
  ctx.font = '14px "Nunito", sans-serif';
  ctx.fillText(majorDesc, 64, 526);

  drawRoundedRect(ctx, 48, 552, w - 96, 68, 14, '#ffffff', '#e9d8c4');
  ctx.fillStyle = '#4d3827';
  ctx.font = 'bold 16px "Nunito", sans-serif';
  ctx.fillText(`✨ ${cap(cat.minorTrait)}:`, 64, 580);
  ctx.fillStyle = '#7c6855';
  ctx.font = '14px "Nunito", sans-serif';
  ctx.fillText(minorDesc, 64, 604);

  // 7. Favorite Things & Stats
  const statBoxY = 632;
  const colW = (w - 110) / 2;

  drawRoundedRect(ctx, 48, statBoxY, colW, 76, 12, '#ffffff', '#e9d8c4');
  ctx.fillStyle = '#7c6855';
  ctx.font = '13px "Nunito", sans-serif';
  ctx.fillText('Favorite Food', 62, statBoxY + 28);
  ctx.fillStyle = '#4d3827';
  ctx.font = 'bold 17px "Nunito", sans-serif';
  ctx.fillText(`🐟 ${cat.favoriteFood}`, 62, statBoxY + 56);

  drawRoundedRect(ctx, 48 + colW + 14, statBoxY, colW, 76, 12, '#ffffff', '#e9d8c4');
  ctx.fillStyle = '#7c6855';
  ctx.font = '13px "Nunito", sans-serif';
  ctx.fillText('Favorite Toy', 62 + colW + 14, statBoxY + 28);
  ctx.fillStyle = '#4d3827';
  ctx.font = 'bold 17px "Nunito", sans-serif';
  ctx.fillText(`🧶 ${cat.favoriteToy}`, 62 + colW + 14, statBoxY + 56);

  // 8. Official Paw Stamp & Footer
  ctx.textAlign = 'center';
  ctx.fillStyle = '#68ad6c';
  ctx.font = 'bold 14px "Nunito", sans-serif';
  ctx.fillText(`Adopted Day ${cat.journal.adoptedDay} · Total Pets Received: ${cat.journal.totalPetsReceived}`, w / 2, 740);

  ctx.fillStyle = '#ff758f';
  ctx.font = '15px "Nunito", sans-serif';
  ctx.fillText('Forever Loved in Cozy Cat Sanctuary', w / 2, 768);

  ctx.fillStyle = '#c7b198';
  ctx.font = '12px "Nunito", sans-serif';
  ctx.fillText('Official Digital Adoption Certificate', w / 2, 804);

  // 9. Trigger Download
  const dataUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${cat.name.replace(/[^a-z0-9]/gi, '_')}_Adoption_Card.png`;
  a.click();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  fillColor: string,
  strokeColor: string,
): void {
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
  ctx.stroke();
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
