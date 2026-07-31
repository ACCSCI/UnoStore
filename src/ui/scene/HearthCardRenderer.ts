import * as THREE from 'three';
import type { HearthCard } from '../../game/core/state';
import { getEffect } from '../../game/hearth/effects/registry';

/**
 * 炉石牌渲染（炉石传说风格拟物化）：
 * - 卡面 = 深色宝石背景 + mmx 插画窗 + 金色描边 + 费用宝石
 * - 插画加载完成自动替换（监听回调）
 */

const CARD_W = 0.55;
const CARD_H = 0.72;
const CARD_T = 0.03;

/** 每个效果的插画/主题色 */
const EFFECT_TINTS: Record<string, string> = {
  bolt: '#3b6fd9',
  shield: '#c9a227',
  draw2: '#c9711e',
  fireball: '#c9351e',
  crystal2: '#8e44ad',
  reverse2: '#b0392b',
  massSkip: '#5b6ee8',
  freeze2: '#3aa0d8',
  untap: '#27ae60',
  steal: '#6c3483',
  timeTwist: '#a04000',
  echo: '#148f77',
  manaBlast: '#5b2c6f',
  double: '#b7950b',
};

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 0xff) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
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

/** 绘制炉石式卡面（无插画时的宝石底 + 效果名；有插画时叠加） */
export function drawHearthCardFace(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  effectId: string,
  name: string,
  cost: number
): void {
  const tint = EFFECT_TINTS[effectId] ?? '#555';
  // 深色描边外框
  roundRect(ctx, 2, 2, w - 4, h - 4, w * 0.09);
  ctx.fillStyle = '#201a30';
  ctx.fill();
  // 主题色边框（炉石蓝宝石色边）
  roundRect(ctx, w * 0.035, h * 0.035, w * 0.93, h * 0.93, w * 0.08);
  const borderGrad = ctx.createLinearGradient(0, 0, w, h);
  borderGrad.addColorStop(0, shade(tint, 90));
  borderGrad.addColorStop(0.5, tint);
  borderGrad.addColorStop(1, shade(tint, -60));
  ctx.fillStyle = borderGrad;
  ctx.fill();
  // 插画窗（深色渐变底）
  roundRect(ctx, w * 0.09, h * 0.1, w * 0.82, h * 0.62, w * 0.05);
  const artGrad = ctx.createLinearGradient(0, h * 0.1, 0, h * 0.72);
  artGrad.addColorStop(0, shade(tint, -25));
  artGrad.addColorStop(1, shade(tint, -70));
  ctx.fillStyle = artGrad;
  ctx.fill();
  // 效果名（插画窗下方）
  ctx.fillStyle = '#f5e9c8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${w * 0.09}px sans-serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = w * 0.02;
  ctx.fillText(name.slice(0, 5), w / 2, h * 0.82);
  ctx.shadowBlur = 0;
  // 费用宝石（左上，蓝宝石圆）
  const gemR = w * 0.12;
  ctx.beginPath();
  ctx.arc(w * 0.13, h * 0.12, gemR, 0, Math.PI * 2);
  const gemGrad = ctx.createRadialGradient(w * 0.11, h * 0.1, gemR * 0.2, w * 0.13, h * 0.12, gemR);
  gemGrad.addColorStop(0, '#9ad8ff');
  gemGrad.addColorStop(0.5, '#2e86de');
  gemGrad.addColorStop(1, '#15457a');
  ctx.fillStyle = gemGrad;
  ctx.fill();
  ctx.strokeStyle = '#dff1ff';
  ctx.lineWidth = w * 0.015;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${gemR * 1.1}px sans-serif`;
  ctx.fillText(String(cost), w * 0.13, h * 0.12 + h * 0.005);
}

/** 在插画窗内绘制插画（裁剪，不铺满整卡 → 避免套娃） */
export function drawHearthArtInWindow(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  img: HTMLImageElement
): void {
  ctx.save();
  roundRect(ctx, w * 0.09, h * 0.1, w * 0.82, h * 0.62, w * 0.05);
  ctx.clip();
  // 插画等比覆盖插画窗（cover）
  const aw = w * 0.82;
  const ah = h * 0.62;
  const scale = Math.max(aw / img.width, ah / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, w * 0.09 + (aw - dw) / 2, h * 0.1 + (ah - dh) / 2, dw, dh);
  ctx.restore();
}

/** 加载插画（异步），替换到指定 canvas */
export function drawHearthArt(canvas: HTMLCanvasElement, effectId: string): void {
  const ctx = canvas.getContext('2d')!;
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = `/assets/images/hearth/${effectId}.webp`;
}

function fallbackTexture(effectId: string, name: string, cost: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 176;
  drawHearthCardFace(canvas.getContext('2d')!, 128, 176, effectId, name, cost);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 加载插画纹理（成功时替换到已创建材质） */
const loadListeners = new Map<string, Set<(tex: THREE.Texture) => void>>();
const loadStarted = new Set<string>();

function requestArt(effectId: string): (cb: (tex: THREE.Texture) => void) => void {
  const onLoad = (cb: (tex: THREE.Texture) => void): void => {
    let set = loadListeners.get(effectId);
    if (!set) {
      set = new Set();
      loadListeners.set(effectId, set);
    }
    set.add(cb);
  };
  if (!loadStarted.has(effectId)) {
    loadStarted.add(effectId);
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      const listeners = loadListeners.get(effectId);
      if (listeners) {
        for (const cb of listeners) cb(tex);
        listeners.clear();
      }
    };
    img.onerror = () => {
      const listeners = loadListeners.get(effectId);
      if (listeners) {
        for (const cb of listeners) cb(texFallback(effectId));
        listeners.clear();
      }
    };
    img.src = `/assets/images/hearth/${effectId}.webp`;
  }
  return onLoad;
}

const texCache = new Map<string, THREE.Texture>();

function texFallback(effectId: string): THREE.Texture {
  const effect = getEffect(effectId);
  let t = texCache.get(effectId);
  if (t) return t;
  t = fallbackTexture(effectId, effect?.name ?? effectId, effect?.cost ?? 0);
  texCache.set(effectId, t);
  return t;
}

/** 创建炉石牌 3D mesh（+y 面 = 卡面） */
export function createHearthCardMesh(card: HearthCard): THREE.Mesh {
  const effect = getEffect(card.effectId);
  const name = effect?.name ?? card.effectId;
  const cost = effect?.cost ?? 0;
  const front = new THREE.MeshStandardMaterial({
    map: texFallback(card.effectId),
    roughness: 0.38,
    metalness: 0.05,
  });
  requestArt(card.effectId)((tex) => {
    front.map = tex;
    front.needsUpdate = true;
  });
  const back = new THREE.MeshStandardMaterial({ color: 0x2c1e3f, roughness: 0.5 });
  const edge = new THREE.MeshStandardMaterial({ color: 0x201a30, roughness: 0.8 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H), [
    edge,
    edge,
    front,
    edge,
    back,
    edge,
  ]);
  mesh.castShadow = true;
  mesh.name = `hearth-${card.id}`;
  mesh.userData.effectName = name;
  mesh.userData.cost = cost;
  mesh.userData.description = effect?.description ?? '';
  return mesh;
}

/** 详情面板用卡面 dataURL（程序化底 + 插画叠加） */
export function hearthCardDataURL(card: HearthCard): string {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 352;
  const effect = getEffect(card.effectId);
  drawHearthCardFace(
    canvas.getContext('2d')!,
    256,
    352,
    card.effectId,
    effect?.name ?? card.effectId,
    effect?.cost ?? 0
  );
  // 插画叠加（加载完成时重绘）
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 256 * 0.09, 256 * 0.1, 256 * 0.82, 256 * 0.62);
  };
  img.src = `/assets/images/hearth/${card.effectId}.webp`;
  return canvas.toDataURL('image/png');
}
