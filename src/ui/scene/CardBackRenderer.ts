import * as THREE from 'three';
import { assetUrl } from '../assets/url';
import { drawCardBack } from './CardRenderer';

export const CARD_BACK_ASSET = '/assets/images/dual-deck-card-back.webp';

/**
 * 提前加载抽牌演出使用的真实牌背。失败时仍返回程序化牌背，绝不退化成彩色几何体。
 */
export function loadCardBackTexture(): Promise<THREE.Texture> {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      assetUrl(CARD_BACK_ASSET),
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        resolve(texture);
      },
      undefined,
      () => resolve(createFallbackCardBackTexture())
    );
  });
}

/** 创建一张双面均为牌背的实体飞行卡，翻转途中不会露出纯色占位面。 */
export function createDrawCardBackMesh(texture: THREE.Texture): THREE.Mesh {
  const edge = (): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color: 0x101c28, roughness: 0.72 });
  const back = (): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.36, metalness: 0.04 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.74), [
    edge(),
    edge(),
    back(),
    back(),
    edge(),
    edge(),
  ]);
  mesh.name = 'draw-card-back';
  mesh.castShadow = true;
  return mesh;
}

function createFallbackCardBackTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 352;
  drawCardBack(canvas.getContext('2d')!, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
