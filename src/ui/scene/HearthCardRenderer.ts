import * as THREE from 'three';
import type { HearthCard } from '../../game/core/state';
import { getEffect } from '../../game/hearth/effects/registry';

/**
 * 炉石牌渲染（炉石传说风格）：
 * - 卡面 = mmx 生成的插画（public/assets/images/hearth/<effectId>.webp）
 * - 插画加载完成前用程序化占位（颜色 + 效果名），加载完成后自动替换材质
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
  // 费用角标（蓝色菱形）
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

/**
 * 纹理加载管理：返回 fallback 纹理 + 加载完成回调注册。
 * 卡面 webp 加载完成后，替换该效果所有已创建材质的 map。
 */
const textureCache = new Map<string, THREE.Texture>();
const loadListeners = new Map<string, Set<(tex: THREE.Texture) => void>>();
const loadStarted = new Set<string>();
const loadFailed = new Set<string>();

function loadHearthTexture(effectId: string): {
  fallback: THREE.Texture;
  onLoad: (cb: (tex: THREE.Texture) => void) => void;
} {
  const effect = getEffect(effectId);
  const name = effect?.name ?? effectId;
  const fallback = fallbackTexture(effectId, name);
  textureCache.set(effectId, fallback); // 先占位，加载成功替换
  const onLoad = (cb: (tex: THREE.Texture) => void): void => {
    const cached = textureCache.get(effectId);
    if (cached && cached !== fallback) {
      cb(cached); // 已加载完成
      return;
    }
    let set = loadListeners.get(effectId);
    if (!set) {
      set = new Set();
      loadListeners.set(effectId, set);
    }
    set.add(cb);
  };
  // 仅首次请求发起加载（防止重复请求）
  if (!(loadStarted.has(effectId) || loadFailed.has(effectId))) {
    loadStarted.add(effectId);
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      textureCache.set(effectId, tex);
      const listeners = loadListeners.get(effectId);
      if (listeners) {
        for (const cb of listeners) cb(tex);
        listeners.clear();
      }
    };
    img.onerror = () => {
      loadFailed.add(effectId);
      const listeners = loadListeners.get(effectId);
      if (listeners) {
        for (const cb of listeners) cb(fallback);
        listeners.clear();
      }
    };
    img.src = `/assets/images/hearth/${effectId}.webp`;
  }
  return { fallback, onLoad };
}

/** 创建炉石牌 3D mesh（正面 = mmx 卡面，+y 面朝上） */
export function createHearthCardMesh(card: HearthCard): THREE.Mesh {
  const effect = getEffect(card.effectId);
  const { fallback, onLoad } = loadHearthTexture(card.effectId);
  const front = new THREE.MeshStandardMaterial({ map: fallback, roughness: 0.4 });
  // 卡面加载完成 → 替换材质纹理
  onLoad((tex) => {
    front.map = tex;
    front.needsUpdate = true;
  });
  const back = new THREE.MeshStandardMaterial({ color: 0x2c1e3f, roughness: 0.5 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H), [
    back,
    back,
    front,
    back,
    back,
    back,
  ]);
  mesh.castShadow = true;
  mesh.name = `hearth-${card.id}`;
  // 存储效果名供 UI 显示
  mesh.userData.effectName = effect?.name ?? card.effectId;
  mesh.userData.cost = effect?.cost ?? 0;
  mesh.userData.description = effect?.description ?? '';
  return mesh;
}
