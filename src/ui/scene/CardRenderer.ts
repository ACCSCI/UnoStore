import * as THREE from 'three';
import type { UnoCard } from '../../game/uno/types';

/**
 * Uno 牌渲染（拟物化：多层渐变 + 高光 + 椭圆徽记 + 描边）。
 * 牌面 = canvas 分层绘制（视觉接近实体卡牌）。
 */

const CARD_W = 0.62;
const CARD_H = 0.84;
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
  skip: '⊘',
  reverse: '↻',
  draw2: '+2',
  draw4: '+4',
  wild: 'W',
  wildDraw4: '+4',
  massSkip: '×',
  colorDump: '全',
  wildReverseDraw4: '↻+4',
  wildDraw6: '+6',
  wildDraw10: '+10',
  wildColorRoulette: '◉',
};

const ACTION_INFO: Record<string, { name: string; description: string }> = {
  skip: { name: '跳过', description: '下一个玩家跳过回合' },
  reverse: { name: '反转', description: '反转方向；双人局等同跳过' },
  draw2: { name: '强制抽牌', description: '下一个玩家罚抽 2 张' },
  draw4: { name: '彩色抽四', description: '下一个玩家罚抽 4 张，可向上叠加' },
  wild: { name: '万能变色', description: '打出后选择一种当前颜色' },
  wildDraw4: { name: '万能抽四', description: '选择颜色；下家罚抽 4 张' },
  massSkip: { name: '全员跳过', description: '跳过所有对手并获得额外行动' },
  colorDump: { name: '同色清场', description: '弃掉全部同色 UNO；数字点数之和转为冻结水晶' },
  wildReverseDraw4: {
    name: '反转抽四',
    description: '反转方向并 +4；双人局跳过对手、自己承罚，可叠 ≥+4 送回。',
  },
  wildDraw6: { name: '万能抽六', description: '选择颜色；下家累计罚抽 6 张' },
  wildDraw10: { name: '万能抽十', description: '选择颜色；下家累计罚抽 10 张' },
  wildColorRoulette: {
    name: '颜色轮盘',
    description: '下家选色，持续抽牌直到抽到该颜色',
  },
};

const COLOR_NAME: Record<string, string> = {
  red: '红色',
  yellow: '黄色',
  green: '绿色',
  blue: '蓝色',
};

export function unoCardTitle(card: UnoCard): string {
  const color = card.color ? (COLOR_NAME[card.color] ?? card.color) : '万能';
  if (/^\d+$/.test(card.value)) return `${color} ${card.value}`;
  return `${card.color ? `${color} ` : ''}${ACTION_INFO[card.value]?.name ?? card.value}`;
}

export function unoCardDescription(card: UnoCard): string {
  if (card.value === '0') return '冻结 0 水晶；所有玩家按当前方向传递手牌。';
  if (card.value === '7') return '冻结 7 水晶；必须指定一名玩家交换 UNO 手牌。';
  if (/^\d+$/.test(card.value)) return `冻结 ${card.value} 颗水晶，下回合转为可用水晶。`;
  return ACTION_INFO[card.value]?.description ?? '按牌面规则结算。';
}

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

function drawWildPalette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const centerX = w / 2;
  const centerY = h * 0.33;
  const radiusX = w * 0.34;
  const radiusY = h * 0.225;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radiusX, radiusY, -0.12, 0, Math.PI * 2);
  ctx.clip();
  const colors = ['#e74c3c', '#f1c40f', '#2ecc71', '#3498db'];
  for (let index = 0; index < colors.length; index++) {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(
      centerX,
      centerY,
      Math.max(radiusX, radiusY) * 1.45,
      -Math.PI / 2 + index * (Math.PI / 2),
      -Math.PI / 2 + (index + 1) * (Math.PI / 2)
    );
    ctx.closePath();
    ctx.fillStyle = colors[index]!;
    ctx.fill();
  }
  ctx.restore();
}

function drawFourColorWheel(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number
): void {
  const colors = ['#e74c3c', '#f1c40f', '#2ecc71', '#3498db'];
  for (let index = 0; index < colors.length; index++) {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(
      centerX,
      centerY,
      radius,
      -Math.PI / 2 + index * (Math.PI / 2),
      -Math.PI / 2 + (index + 1) * (Math.PI / 2)
    );
    ctx.closePath();
    ctx.fillStyle = colors[index]!;
    ctx.fill();
  }
}

/** 绘制 Uno 卡面（任意尺寸，供纹理与详情面板复用） */
export function drawUnoCardFace(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  card: UnoCard
): void {
  const bg = card.color ? (COLOR_HEX[card.color] ?? '#888') : '#191b24';
  const isNumber = /^\d+$/.test(card.value);
  const label = isNumber ? card.value : (ACTION_LABEL[card.value] ?? '?');
  const name = unoCardTitle(card);
  const description = unoCardDescription(card);

  // 深色雕刻外框
  roundRect(ctx, 2, 2, w - 4, h - 4, w * 0.09);
  const outer = ctx.createLinearGradient(0, 0, w, h);
  outer.addColorStop(0, '#574b65');
  outer.addColorStop(0.45, '#171322');
  outer.addColorStop(1, '#6f5d77');
  ctx.fillStyle = outer;
  ctx.fill();
  roundRect(ctx, w * 0.035, h * 0.028, w * 0.93, h * 0.944, w * 0.075);
  ctx.strokeStyle = '#e6bc63';
  ctx.lineWidth = w * 0.025;
  ctx.stroke();

  // 主题色内框
  roundRect(ctx, w * 0.075, h * 0.06, w * 0.85, h * 0.87, w * 0.06);
  const grad = ctx.createLinearGradient(0, h * 0.05, 0, h * 0.95);
  grad.addColorStop(0, shade(bg, 55));
  grad.addColorStop(0.45, bg);
  grad.addColorStop(1, shade(bg, -55));
  ctx.fillStyle = grad;
  ctx.fill();

  // 上半部：颜色 + 数字/功能符号
  if (card.color === null) {
    drawWildPalette(ctx, w, h);
  } else {
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.33, w * 0.34, h * 0.225, -0.12, 0, Math.PI * 2);
    const gem = ctx.createRadialGradient(w * 0.4, h * 0.23, w * 0.02, w / 2, h * 0.33, w * 0.38);
    gem.addColorStop(0, shade(bg, 105));
    gem.addColorStop(0.5, bg);
    gem.addColorStop(1, shade(bg, -75));
    ctx.fillStyle = gem;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.33, w * 0.34, h * 0.225, -0.12, 0, Math.PI * 2);
  ctx.strokeStyle = '#f2d58a';
  ctx.lineWidth = w * 0.025;
  ctx.stroke();

  // 中央符文
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.72)';
  ctx.shadowBlur = w * 0.045;
  ctx.shadowOffsetY = h * 0.012;
  ctx.font = `900 ${isNumber ? h * 0.31 : h * 0.25}px sans-serif`;
  ctx.fillText(label, w / 2, h * 0.33);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 下半部：名称与完整规则说明
  roundRect(ctx, w * 0.105, h * 0.56, w * 0.79, h * 0.31, w * 0.035);
  const plate = ctx.createLinearGradient(0, h * 0.56, 0, h * 0.87);
  plate.addColorStop(0, '#f4e8ca');
  plate.addColorStop(1, '#b99764');
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.strokeStyle = '#3b291d';
  ctx.lineWidth = w * 0.012;
  ctx.stroke();
  ctx.fillStyle = '#261b1c';
  ctx.font = `900 ${w * 0.085}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(name, w / 2, h * 0.615);
  ctx.strokeStyle = 'rgba(65, 43, 28, 0.32)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w * 0.16, h * 0.66);
  ctx.lineTo(w * 0.84, h * 0.66);
  ctx.stroke();
  ctx.fillStyle = '#3a2b25';
  ctx.font = `600 ${w * 0.052}px "Microsoft YaHei", sans-serif`;
  wrapText(ctx, description, w / 2, h * 0.705, w * 0.63, h * 0.052, 3);

  // 左上角标，让扇形手牌叠放时仍能辨认颜色与数值。
  ctx.beginPath();
  ctx.arc(w * 0.14, h * 0.12, w * 0.105, 0, Math.PI * 2);
  if (card.color === null) drawFourColorWheel(ctx, w * 0.14, h * 0.12, w * 0.105);
  else {
    ctx.fillStyle = '#17243d';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(w * 0.14, h * 0.12, w * 0.105, 0, Math.PI * 2);
  ctx.strokeStyle = '#d9ecff';
  ctx.lineWidth = w * 0.015;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `900 ${w * 0.13}px sans-serif`;
  ctx.fillText(label, w * 0.14, h * 0.12);
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): void {
  const chars = [...text];
  const lines: string[] = [];
  let line = '';
  for (const char of chars) {
    const next = line + char;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = char;
      if (lines.length === maxLines - 1) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((value, index) => {
    ctx.fillText(value, x, y + index * lineHeight);
  });
}

/** 绘制牌背（金色描边 + UNO 字） */
export function drawCardBack(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  roundRect(ctx, 2, 2, w - 4, h - 4, w * 0.09);
  const outer = ctx.createLinearGradient(0, 0, w, h);
  outer.addColorStop(0, '#8b7651');
  outer.addColorStop(0.5, '#21172e');
  outer.addColorStop(1, '#b79a5c');
  ctx.fillStyle = outer;
  ctx.fill();
  roundRect(ctx, w * 0.05, h * 0.05, w * 0.9, h * 0.9, w * 0.07);
  const grad = ctx.createRadialGradient(w * 0.38, h * 0.32, w * 0.03, w / 2, h / 2, h * 0.55);
  grad.addColorStop(0, '#7658b2');
  grad.addColorStop(0.48, '#302356');
  grad.addColorStop(1, '#100d20');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = '#e7c46f';
  ctx.lineWidth = w * 0.025;
  roundRect(ctx, w * 0.1, h * 0.1, w * 0.8, h * 0.8, w * 0.05);
  ctx.stroke();
  ctx.save();
  ctx.translate(w / 2, h / 2);
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.27);
    ctx.quadraticCurveTo(w * 0.18, -h * 0.09, 0, 0);
    ctx.quadraticCurveTo(-w * 0.12, -h * 0.12, 0, -h * 0.27);
    ctx.fillStyle = ['#e94d48', '#f1c40f', '#38b978', '#3978d4'][i]!;
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = '#21152f';
  ctx.fill();
  ctx.strokeStyle = '#f1d48a';
  ctx.lineWidth = w * 0.018;
  ctx.stroke();
  ctx.fillStyle = '#ffe7a3';
  ctx.font = `900 ${h * 0.16}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('UNO', w / 2, h / 2);
}

function cardFaceTexture(card: UnoCard): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 352;
  drawUnoCardFace(canvas.getContext('2d')!, 256, 352, card);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function cardBackTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 352;
  drawCardBack(canvas.getContext('2d')!, 256, 352);
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
  canvas.width = 512;
  canvas.height = 704;
  drawUnoCardFace(canvas.getContext('2d')!, 512, 704, card);
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
