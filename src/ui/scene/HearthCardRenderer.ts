import * as THREE from 'three';
import type { HearthCard } from '../../game/core/state';
import { getEffect } from '../../game/hearth/effects/registry';

/**
 * 炉石牌渲染（炉石传说风格）：
 * - 卡面 = mmx 生成的插画（public/assets/images/hearth/<effectId>.png）
 * - 插画未加载完时用程序化占位（颜色 + 效果名）
 * - 顶部显示费用水晶（蓝色菱形），底部显示效果名
 */

const CARD_W = 0.55;
const CARD_H = 0.72;
const CARD_T = 0.03;

/** 每个效果的占位配色 */
const EFFECT_COLORS: Record<string, string> = {
  bolt: '#1e6fd9',
  shield: '#d9a51e',
  draw2: '#d96b1e',
  fireball: '#d9301e',
  crystal2: '#8e44ad',
  reverse2: '#c0392b',
  massSkip: '#5b6ee8',
  freeze2: '#3498db',
  untap: '#27ae60',
  steal: '#6c3483',
  timeTwist: '#a04000',
  echo: '#148f77',
  manaBlast: '#5b2c6f',
  double: '#b7950b',
};

function effectColor(effectId: string): string {
  return EFFECT_COLORS[effectId] ?? '#555';
}

/** 程序化兜底卡面（mmx 插画未加载时） */
function fallbackTexture(effectId: string, name: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 176;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = effectColor(effectId);
  ctx.fillRect(0, 0, 128, 176);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(6, 6, 116, 164, 12);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.slice(0, 6), 64, 60);
  // 费用角标
  ctx.fillStyle = '#4a90d9';
  ctx.beginPath();
  ctx.moveTo(18, 10);
  ctx.lineTo(30, 10);
  ctx.lineTo(30, 22);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 加载 mmx 卡面纹理（缓存 + 失败回退） */
const textureCache = new Map<string, THREE.Texture>();
const loadFailed = new Set<string>();

function loadHearthTexture(effectId: string): THREE.Texture {
  const cached = textureCache.get(effectId);
  if (cached) return cached;
  const effect = getEffect(effectId);
  const name = effect?.name ?? effectId;
  const fallback = fallbackTexture(effectId, name);
  textureCache.set(effectId, fallback); // 先占位，加载成功替换
  if (loadFailed.has(effectId)) return fallback;
  const img = new Image();
  img.onload = () => {
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    textureCache.set(effectId, tex);
  };
  img.onerror = () => {
    loadFailed.add(effectId);
  };
  img.src = `/assets/images/hearth/${effectId}.png`;
  return fallback;
}

/** 创建炉石牌 3D mesh（正面 = mmx 卡面） */
export function createHearthCardMesh(card: HearthCard): THREE.Mesh {
  const effect = getEffect(card.effectId);
  const frontTex = loadHearthTexture(card.effectId);
  const front = new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.4 });
  const back = new THREE.MeshStandardMaterial({ color: 0x2c1e3f, roughness: 0.5 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H), [
    front,
    back,
    back,
    back,
    back,
    back,
  ]);
  mesh.castShadow = true;
  mesh.name = `hearth-${card.id}`;
  // 存储效果名供 UI 显示
  mesh.userData.effectName = effect?.name ?? card.effectId;
  mesh.userData.cost = effect?.cost ?? 0;
  return mesh;
}
