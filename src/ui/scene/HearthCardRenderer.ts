import * as THREE from 'three';
import type { HearthCard } from '../../game/core/state';
import { getEffect } from '../../game/hearth/effects/registry';
import { assetUrl } from '../assets/url';

/**
 * 炉石牌渲染（炉石传说风格拟物化）：
 * - 卡面 = 深色宝石背景 + mmx 插画窗 + 金色描边 + 费用宝石
 * - 插画加载完成自动替换（监听回调）
 */

const CARD_W = 0.62;
const CARD_H = 0.84;
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
  clockworkSquire: '#8a6f5a',
  emberWolf: '#c7532c',
  fatefulGift: '#b06ed2',
  chromaticConductor: '#5a91ca',
  crystalGuardian: '#357f9f',
  stormDrake: '#6552b5',
  bloodboundTitan: '#9d2639',
  spyglassOracle: '#168ba8',
  ashPhoenix: '#c94c1e',
  graveArchivist: '#477f55',
  equalityOfAll: '#d8b654',
};

const EFFECT_STATS: Record<string, { value: string; label: string }> = {
  bolt: { value: '2', label: '罚抽' },
  shield: { value: '1', label: '护盾' },
  draw2: { value: '2', label: '抽牌' },
  fireball: { value: '4', label: '罚抽' },
  crystal2: { value: '2', label: '水晶' },
  reverse2: { value: '↻', label: '反转' },
  massSkip: { value: '1', label: '跳过' },
  freeze2: { value: '1', label: '罚抽' },
  untap: { value: '4', label: '水晶' },
  steal: { value: '1', label: '窃取' },
  timeTwist: { value: '2', label: '行动' },
  echo: { value: '∞', label: '回声' },
  manaBlast: { value: '2', label: '罚抽' },
  double: { value: '1', label: '行动' },
  equalityOfAll: { value: '1/1', label: '全场' },
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
  cost: number,
  description: string,
  minionStats?: { attack: number; health: number }
): void {
  const tint = EFFECT_TINTS[effectId] ?? '#555';
  // 厚重雕刻外框
  roundRect(ctx, 2, 2, w - 4, h - 4, w * 0.09);
  const outer = ctx.createLinearGradient(0, 0, w, h);
  outer.addColorStop(0, '#76647d');
  outer.addColorStop(0.45, '#1b1523');
  outer.addColorStop(1, '#5b4864');
  ctx.fillStyle = outer;
  ctx.fill();
  // 主题色边框
  roundRect(ctx, w * 0.035, h * 0.035, w * 0.93, h * 0.93, w * 0.08);
  const borderGrad = ctx.createLinearGradient(0, 0, w, h);
  borderGrad.addColorStop(0, shade(tint, 90));
  borderGrad.addColorStop(0.5, tint);
  borderGrad.addColorStop(1, shade(tint, -60));
  ctx.fillStyle = borderGrad;
  ctx.fill();

  roundRect(ctx, w * 0.075, h * 0.065, w * 0.85, h * 0.87, w * 0.06);
  ctx.fillStyle = '#211a2b';
  ctx.fill();

  // 椭圆插画窗
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.31, w * 0.34, h * 0.225, 0, 0, Math.PI * 2);
  const artGrad = ctx.createLinearGradient(0, h * 0.09, 0, h * 0.53);
  artGrad.addColorStop(0, shade(tint, -25));
  artGrad.addColorStop(1, shade(tint, -70));
  ctx.fillStyle = artGrad;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.31, w * 0.34, h * 0.225, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(240, 200, 100, 0.85)';
  ctx.lineWidth = Math.max(w * 0.022, 2);
  ctx.stroke();

  drawHearthCardOverlay(ctx, w, h, effectId, name, cost, description, minionStats);
}

/** 最上层信息层：插画无论何时加载，都必须最后重绘这一层。 */
function drawHearthCardOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  effectId: string,
  name: string,
  cost: number,
  description: string,
  minionStats?: { attack: number; health: number }
): void {
  const effect = getEffect(effectId);
  const stat = EFFECT_STATS[effectId] ?? { value: '•', label: '效果' };
  // 名称铭牌
  roundRect(ctx, w * 0.16, h * 0.495, w * 0.68, h * 0.105, w * 0.035);
  const nameplate = ctx.createLinearGradient(0, h * 0.495, 0, h * 0.6);
  nameplate.addColorStop(0, '#f0d99e');
  nameplate.addColorStop(1, '#9a7042');
  ctx.fillStyle = nameplate;
  ctx.fill();
  ctx.strokeStyle = '#352319';
  ctx.lineWidth = w * 0.012;
  ctx.stroke();
  ctx.fillStyle = '#271a19';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${w * 0.09}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(name.slice(0, 7), w / 2, h * 0.55);

  // 下半部规则说明
  roundRect(ctx, w * 0.11, h * 0.615, w * 0.78, h * 0.245, w * 0.035);
  ctx.fillStyle = '#e8dfcf';
  ctx.fill();
  ctx.strokeStyle = '#6e593e';
  ctx.lineWidth = w * 0.012;
  ctx.stroke();
  ctx.fillStyle = '#2c2527';
  ctx.font = `600 ${w * 0.052}px "Microsoft YaHei", sans-serif`;
  wrapText(ctx, description, w / 2, h * 0.675, w * 0.63, h * 0.052, 4);

  // 左上费用宝石
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

  // 法术右上显示核心数值；随从按炉石习惯在底部显示攻击/生命。
  if (effect?.kind === 'minion') {
    drawMinionStat(
      ctx,
      w,
      h,
      w * 0.14,
      h * 0.89,
      minionStats?.attack ?? effect.attack ?? 0,
      '#a56a22',
      '攻击'
    );
    drawMinionStat(
      ctx,
      w,
      h,
      w * 0.86,
      h * 0.89,
      minionStats?.health ?? effect.health ?? 1,
      '#a72f46',
      '生命'
    );
    return;
  }
  ctx.beginPath();
  ctx.arc(w * 0.87, h * 0.12, gemR, 0, Math.PI * 2);
  const statGrad = ctx.createRadialGradient(
    w * 0.84,
    h * 0.09,
    gemR * 0.15,
    w * 0.87,
    h * 0.12,
    gemR
  );
  statGrad.addColorStop(0, '#ffd7c8');
  statGrad.addColorStop(0.5, '#ba4636');
  statGrad.addColorStop(1, '#5a1c25');
  ctx.fillStyle = statGrad;
  ctx.fill();
  ctx.strokeStyle = '#ffe3b1';
  ctx.lineWidth = w * 0.015;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `900 ${gemR * 0.95}px sans-serif`;
  ctx.fillText(stat.value, w * 0.87, h * 0.105);
  ctx.font = `700 ${w * 0.038}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(stat.label, w * 0.87, h * 0.158);
}

function drawMinionStat(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  x: number,
  y: number,
  value: number,
  color: string,
  label: string
): void {
  const radius = w * 0.105;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#ffe3b1';
  ctx.lineWidth = w * 0.015;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${radius * 1.05}px sans-serif`;
  ctx.fillText(String(value), x, y - h * 0.008);
  ctx.font = `700 ${w * 0.031}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(label, x, y + h * 0.035);
}

/** 在插画窗内绘制插画（裁剪，不铺满整卡 → 避免套娃），绘制后重描金边 */
export function drawHearthArtInWindow(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  img: HTMLImageElement
): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.31, w * 0.34, h * 0.225, 0, 0, Math.PI * 2);
  ctx.clip();
  const aw = w * 0.68;
  const ah = h * 0.45;
  const scale = Math.max(aw / img.width, ah / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, w * 0.16 + (aw - dw) / 2, h * 0.085 + (ah - dh) / 2, dw, dh);
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.31, w * 0.34, h * 0.225, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(240, 200, 100, 0.85)';
  ctx.lineWidth = Math.max(w * 0.022, 2);
  ctx.stroke();
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

/** 加载插画（异步），替换到指定 canvas */
export function drawHearthArt(canvas: HTMLCanvasElement, effectId: string): void {
  const ctx = canvas.getContext('2d')!;
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = assetUrl(`/assets/images/hearth/${effectId}.webp`);
}

/** 合成卡面：卡框 + 插画裁剪进窗（含金边）。所有纹理都走这里，避免套娃 */
function composeCardFace(
  effectId: string,
  name: string,
  cost: number,
  art?: HTMLImageElement | null
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 352;
  const ctx = canvas.getContext('2d')!;
  const description = getEffect(effectId)?.description ?? '按牌面效果结算。';
  drawHearthCardFace(ctx, 256, 352, effectId, name, cost, description);
  if (art) {
    drawHearthArtInWindow(ctx, 256, 352, art);
    drawHearthCardOverlay(ctx, 256, 352, effectId, name, cost, description);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function fallbackTexture(effectId: string, name: string, cost: number): THREE.CanvasTexture {
  return composeCardFace(effectId, name, cost);
}

/** 加载插画（成功时合成完整卡面替换到已创建材质） */
const loadListeners = new Map<string, Set<(tex: THREE.Texture) => void>>();
const loadStarted = new Set<string>();
const loadedArtTextures = new Map<string, THREE.Texture>();
const failedArt = new Set<string>();

function requestArt(effectId: string): (cb: (tex: THREE.Texture) => void) => void {
  const onLoad = (cb: (tex: THREE.Texture) => void): void => {
    const loaded = loadedArtTextures.get(effectId);
    if (loaded) {
      cb(loaded);
      return;
    }
    if (failedArt.has(effectId)) {
      cb(texFallback(effectId));
      return;
    }
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
      const effect = getEffect(effectId);
      const tex = composeCardFace(effectId, effect?.name ?? effectId, effect?.cost ?? 0, img);
      loadedArtTextures.set(effectId, tex);
      const listeners = loadListeners.get(effectId);
      if (listeners) {
        for (const cb of listeners) cb(tex);
        listeners.clear();
      }
    };
    img.onerror = () => {
      failedArt.add(effectId);
      const listeners = loadListeners.get(effectId);
      if (listeners) {
        for (const cb of listeners) cb(texFallback(effectId));
        listeners.clear();
      }
    };
    img.src = assetUrl(`/assets/images/hearth/${effectId}.webp`);
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
export function hearthCardDataURL(
  card: HearthCard,
  minionStats?: { attack: number; health: number }
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 704;
  const ctx = canvas.getContext('2d')!;
  const effect = getEffect(card.effectId);
  drawHearthCardFace(
    ctx,
    512,
    704,
    card.effectId,
    effect?.name ?? card.effectId,
    effect?.cost ?? 0,
    effect?.description ?? '按牌面效果结算。',
    minionStats
  );
  return new Promise((resolve) => {
    // 插画异步加载完成后画入并导出（避免空窗快照）
    const img = new Image();
    img.onload = () => {
      drawHearthArtInWindow(ctx, 512, 704, img);
      drawHearthCardOverlay(
        ctx,
        512,
        704,
        card.effectId,
        effect?.name ?? card.effectId,
        effect?.cost ?? 0,
        effect?.description ?? '按牌面效果结算。',
        minionStats
      );
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = assetUrl(`/assets/images/hearth/${card.effectId}.webp`);
  });
}
