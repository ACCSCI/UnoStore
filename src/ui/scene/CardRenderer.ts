import * as THREE from 'three';
import type { UnoCard } from '../../game/uno/types';

/**
 * Uno 牌渲染（拟物化：多层渐变 + 高光 + 椭圆徽记 + 描边）。
 * 牌面 = canvas 分层绘制（视觉接近实体卡牌）。
 */

const CARD_W = 0.55;
const CARD_H = 0.72;
const CARD_T = 0.03;

const COLOR_HEX: Record<string, string> = {
  red: '#e74c3c',
  yellow: '#f1c40f',
  green: '#2ecc71',
  blue: '#3498db',
};

const COLOR_EDGE: Record<string, string> = {
  red: '#5c1515',
  yellow: '#6b5308',
  green: '#0e4423',
  blue: '#123a5c',
};

const ACTION_LABEL: Record<string, string> = {
  skip: '⏭',
  reverse: '⇄',
  draw2: '+2',
  wild: 'W',
  wildDraw4: '+4',
  massSkip: '×',
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 0xff) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

/** 绘制 Uno 卡面（任意尺寸，供纹理与详情面板复用） */
export function drawUnoCardFace(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  card: UnoCard
): void {
  const bg = card.color ? (COLOR_HEX[card.color] ?? '#888') : '#2a2a3a';
  // 白描边外框（牌边缘）
  roundRect(ctx, 2, 2, w - 4, h - 4, w * 0.09);
  ctx.fillStyle = '#f5f0e6';
  ctx.fill();
  // 彩色主体（垂直渐变 = 实体卡光泽）
  roundRect(ctx, w * 0.05, h * 0.05, w * 0.9, h * 0.9, w * 0.07);
  const grad = ctx.createLinearGradient(0, h * 0.05, 0, h * 0.95);
  grad.addColorStop(0, shade(bg, 45));
  grad.addColorStop(0.45, bg);
  grad.addColorStop(1, shade(bg, -35));
  ctx.fillStyle = grad;
  ctx.fill();
  // 顶部高光（拟物反光）
  roundRect(ctx, w * 0.08, h * 0.07, w * 0.84, h * 0.42, w * 0.05);
  const gloss = ctx.createLinearGradient(0, h * 0.07, 0, h * 0.49);
  gloss.addColorStop(0, 'rgba(255,255,255,0.4)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fill();
  // 中央大符号（直接白色，压在卡面颜色上，无背景）
  const label = card.color ? (card.value as string) : (ACTION_LABEL[card.value] ?? '?');
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = w * 0.03;
  ctx.shadowOffsetY = h * 0.012;
  ctx.font = `bold ${h * 0.5}px sans-serif`;
  ctx.fillText(label, w / 2, h / 2 + h * 0.01);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  // 左上角小符号
  ctx.font = `bold ${h * 0.2}px sans-serif`;
  ctx.fillText(label, w * 0.17, h * 0.15);
}

/** 绘制牌背（金色描边 + UNO 字） */
export function drawCardBack(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  roundRect(ctx, 2, 2, w - 4, h - 4, w * 0.09);
  ctx.fillStyle = '#f5f0e6';
  ctx.fill();
  roundRect(ctx, w * 0.05, h * 0.05, w * 0.9, h * 0.9, w * 0.07);
  const grad = ctx.createLinearGradient(0, h * 0.05, 0, h * 0.95);
  grad.addColorStop(0, '#2b2b6e');
  grad.addColorStop(1, '#15153c');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = w * 0.03;
  roundRect(ctx, w * 0.1, h * 0.1, w * 0.8, h * 0.8, w * 0.05);
  ctx.stroke();
  ctx.fillStyle = '#ffd700';
  ctx.font = `bold ${h * 0.26}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('UNO', w / 2, h / 2);
}

function cardFaceTexture(card: UnoCard): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 176;
  drawUnoCardFace(canvas.getContext('2d')!, 128, 176, card);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function cardBackTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 176;
  drawCardBack(canvas.getContext('2d')!, 128, 176);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 创建 3D 卡牌 mesh：+y 面 = 正面，侧面 = 深色（实体厚度感） */
export function createCardMesh(card: UnoCard): THREE.Mesh {
  const geo = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H);
  const front = new THREE.MeshStandardMaterial({
    map: cardFaceTexture(card),
    roughness: 0.32,
    metalness: 0.05,
  });
  const back = new THREE.MeshStandardMaterial({ map: cardBackTexture(), roughness: 0.4 });
  const edge = new THREE.MeshStandardMaterial({
    color: card.color ? (COLOR_EDGE[card.color] ?? '#333') : '#1a1a2a',
    roughness: 0.7,
  });
  const mesh = new THREE.Mesh(geo, [edge, edge, front, edge, back, edge]);
  mesh.castShadow = true;
  mesh.name = `card-${card.id}`;
  return mesh;
}

/** 详情面板用的卡面图像（dataURL） */
export function unoCardDataURL(card: UnoCard): string {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 352;
  drawUnoCardFace(canvas.getContext('2d')!, 256, 352, card);
  return canvas.toDataURL('image/png');
}

/** 详情面板用的牌背图像（dataURL） */
export function cardBackDataURL(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 352;
  drawCardBack(canvas.getContext('2d')!, 256, 352);
  return canvas.toDataURL('image/png');
}
