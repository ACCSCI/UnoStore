import * as THREE from 'three';
import type { UnoCard } from '../../game/uno/types';

/**
 * 3D 卡牌渲染：程序化生成 Uno 风格卡面（颜色 + 符号），
 * Blender 卡牌模型就绪后可直接替换 mesh 构建部分。
 * 卡牌尺寸：0.55 × 0.72（与 Blender 样例一致）
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

const ACTION_LABEL: Record<string, string> = {
  skip: '⏭',
  reverse: '⇄',
  draw2: '+2',
  wild: 'W',
  wildDraw4: '+4',
  massSkip: '×',
};

/** 生成卡面 Canvas 纹理（颜色 + 白框 + 符号） */
function cardFaceTexture(card: UnoCard): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 176;
  const ctx = canvas.getContext('2d')!;
  const bg = card.color ? (COLOR_HEX[card.color] ?? '#888') : '#222';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 128, 176);
  // 白色圆角边框
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.roundRect(8, 8, 112, 160, 14);
  ctx.stroke();
  // 符号
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 52px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = card.color ? card.value : (ACTION_LABEL[card.value] ?? '?');
  ctx.fillText(label, 64, 88);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 生成牌背纹理 */
function cardBackTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 176;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1a1a4e';
  ctx.fillRect(0, 0, 128, 176);
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(8, 8, 112, 160, 14);
  ctx.stroke();
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('UNO', 64, 88);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 创建一张 3D 卡牌 mesh（正面可换）
 *  BoxGeometry(宽0.55, 厚0.03, 高0.72)：
 *  面序 0:+x 1:-x 2:+y 3:-y 4:+z 5:-z
 *  卡片平放 → 朝上的是 +y 面（index 2）= 正面；其余为牌背 */
export function createCardMesh(card: UnoCard): THREE.Mesh {
  const geo = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H);
  const front = new THREE.MeshStandardMaterial({ map: cardFaceTexture(card), roughness: 0.35 });
  const back = new THREE.MeshStandardMaterial({ map: cardBackTexture(), roughness: 0.4 });
  const mesh = new THREE.Mesh(geo, [back, back, front, back, back, back]);
  mesh.castShadow = true;
  mesh.name = `card-${card.id}`;
  return mesh;
}
