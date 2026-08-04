import * as THREE from 'three';
import type { UnoCard } from '../../game/uno/types';
import { assetUrl } from '../assets/url';
import { createCardMesh } from './CardRenderer';
import { tableEllipseCenterOnPlane } from './SeatLayout';

/**
 * 桌面中央：牌堆 + 弃牌堆渲染。
 * 牌堆：竖直一叠牌（只显示顶牌背面）
 * 弃牌堆：水平堆叠，顶牌朝上可见
 */

const TABLE_CARD_PLANE_Y = 0.56;
const CENTER_ROW_Z = tableEllipseCenterOnPlane(TABLE_CARD_PLANE_Y).z;
const DECK_POS = new THREE.Vector3(-1.05, 0.56, CENTER_ROW_Z);
const DISCARD_POS = new THREE.Vector3(1.05, 0.56, CENTER_ROW_Z);

/** Shared animation anchors. Return copies so an animation can safely mutate them. */
export function tableDeckWorldPosition(height = 0.85): THREE.Vector3 {
  return new THREE.Vector3(DECK_POS.x, height, DECK_POS.z);
}

export function tableDiscardWorldPosition(height = 0.6): THREE.Vector3 {
  return new THREE.Vector3(DISCARD_POS.x, height, DISCARD_POS.z);
}

export function tableCenterWorldPosition(height = 0.8): THREE.Vector3 {
  return tableDeckWorldPosition(height).lerp(tableDiscardWorldPosition(height), 0.5);
}

export class TableCenterRenderer {
  private deckGroup = new THREE.Group();
  private discardGroup = new THREE.Group();
  private mats = new THREE.Group();
  private labels = new THREE.Group();
  private deckTopMesh: THREE.Mesh | null = null;
  private deckStackMesh: THREE.Mesh | null = null;
  private deckCount = -1;
  private discardTopMesh: THREE.Mesh | null = null;
  private displayCard: UnoCard | null = null;
  private discardTopKey: string | null = null;

  constructor(private scene: THREE.Scene) {
    this.scene.add(this.deckGroup);
    this.scene.add(this.discardGroup);
    const matMaterial = new THREE.MeshStandardMaterial({
      color: 0x0c302f,
      roughness: 0.86,
      transparent: true,
      opacity: 0.72,
    });
    for (const x of [-1.05, 1.05]) {
      const mat = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 1.14), matMaterial);
      mat.rotation.x = -Math.PI / 2;
      mat.position.set(x, 0.566, 0);
      this.mats.add(mat);
    }
    this.scene.add(this.mats);
    this.labels.add(createLabel('牌 库', -1.05), createLabel('当 前 牌', 1.05));
    this.mats.position.z = CENTER_ROW_Z;
    this.labels.position.z = CENTER_ROW_Z;
    this.scene.add(this.labels);
  }

  /** 同步牌堆（数量 + 顶牌背面）与弃牌堆（顶牌正面） */
  sync(deckCount: number, discardTop: UnoCard | null, chosenColor: UnoCard['color'] = null): void {
    // 牌堆：一叠牌（按数量堆高度）
    const targetHeight = 0.1 + Math.min(deckCount, 40) * 0.007;
    if (deckVisualNeedsRefresh(this.deckCount, deckCount)) {
      this.deckCount = deckCount;
      if (deckCount <= 0) {
        if (this.deckTopMesh) {
          this.deckGroup.remove(this.deckTopMesh);
          this.deckTopMesh.geometry.dispose();
          disposeMaterial(this.deckTopMesh.material);
          this.deckTopMesh = null;
        }
        if (this.deckStackMesh) {
          this.deckGroup.remove(this.deckStackMesh);
          this.deckStackMesh.geometry.dispose();
          disposeMaterial(this.deckStackMesh.material);
          this.deckStackMesh = null;
        }
      } else {
        if (!this.deckStackMesh) {
          this.deckStackMesh = createDeckStackMesh(targetHeight);
          this.deckStackMesh.castShadow = true;
          this.deckGroup.add(this.deckStackMesh);
        } else {
          this.deckStackMesh.geometry.dispose();
          this.deckStackMesh.geometry = new THREE.BoxGeometry(0.83, targetHeight, 1.125);
        }
        this.deckStackMesh.position.y = targetHeight / 2;
        if (!this.deckTopMesh) {
          this.deckTopMesh = createBackMesh();
          this.deckTopMesh.position.x = 0.012;
          this.deckTopMesh.rotation.y = 0.012;
          this.deckTopMesh.scale.setScalar(1.34);
          this.deckGroup.add(this.deckTopMesh);
        }
        this.deckTopMesh.position.y = targetHeight + 0.025;
      }
    }
    this.deckGroup.position.copy(DECK_POS);
    this.deckGroup.rotation.y = -0.035;

    // 弃牌堆：顶牌平放朝上（+z 正面）
    const displayCard =
      discardTop?.color === null && chosenColor
        ? { ...discardTop, color: chosenColor }
        : discardTop;
    this.displayCard = displayCard;
    const displayKey = displayCard ? `${displayCard.id}:${displayCard.color ?? 'wild'}` : null;
    if (this.discardTopKey !== displayKey) {
      for (const child of this.discardGroup.children) {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          disposeMaterial(child.material);
        }
      }
      this.discardGroup.clear();
      this.discardTopMesh = null;
      this.discardTopKey = displayKey;
    }
    if (displayCard && this.discardGroup.children.length === 0) {
      const mesh = createCardMesh(displayCard);
      mesh.rotation.set(0, 0, 0);
      mesh.position.y = 0.04;
      mesh.scale.setScalar(1.34);
      this.discardGroup.add(mesh);
      this.discardTopMesh = mesh;
    }
    this.discardGroup.position.copy(DISCARD_POS);
  }

  /** 命中桌面弃牌堆顶牌，交给统一详情面板显示。 */
  hitTest(raycaster: THREE.Raycaster): UnoCard | null {
    if (!(this.discardTopMesh && this.displayCard)) return null;
    return raycaster.intersectObject(this.discardTopMesh, false).length > 0
      ? this.displayCard
      : null;
  }

  displayedCard(): UnoCard | null {
    return this.displayCard;
  }

  dispose(): void {
    if (this.deckTopMesh) {
      this.deckTopMesh.geometry.dispose();
      disposeMaterial(this.deckTopMesh.material);
    }
    if (this.deckStackMesh) {
      this.deckStackMesh.geometry.dispose();
      disposeMaterial(this.deckStackMesh.material);
    }
    for (const child of this.discardGroup.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        disposeMaterial(child.material);
      }
    }
    this.discardTopMesh = null;
    this.displayCard = null;
    for (const child of this.mats.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        disposeMaterial(child.material);
      }
    }
    for (const child of this.labels.children) {
      if (child instanceof THREE.Sprite) {
        child.material.map?.dispose();
        child.material.dispose();
      }
    }
    this.scene.remove(this.deckGroup);
    this.scene.remove(this.discardGroup);
    this.scene.remove(this.mats);
    this.scene.remove(this.labels);
  }
}

/** UI 频繁重绘时，只有牌库数量真的变化才触碰 3D 牌库资源。 */
export function deckVisualNeedsRefresh(previousCount: number, nextCount: number): boolean {
  return previousCount !== nextCount;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  for (const item of Array.isArray(material) ? material : [material]) {
    if (item instanceof THREE.MeshStandardMaterial) item.map?.dispose();
    item.dispose();
  }
}

/** 牌背朝上的占位卡 */
function createBackMesh(): THREE.Mesh {
  const texture = new THREE.TextureLoader().load(
    assetUrl('/assets/images/dual-deck-card-back.webp')
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  const edge = new THREE.MeshStandardMaterial({ color: 0x1a1428, roughness: 0.7 });
  const back = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.38 });
  return new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.84), [
    edge,
    edge,
    back,
    edge,
    edge,
    edge,
  ]);
}

/** 带逐层纸边纹理的实体牌库；顶牌与侧壁同尺寸，俯视时也能看见真实厚度。 */
function createDeckStackMesh(height: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e7dfd0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 2; y < canvas.height; y += 9) {
    ctx.fillStyle = y % 18 === 2 ? '#8a7c70' : '#c3b7a7';
    ctx.fillRect(0, y, canvas.width, 2);
  }
  ctx.fillStyle = 'rgba(35, 25, 48, .3)';
  ctx.fillRect(0, 0, 5, canvas.height);
  ctx.fillRect(canvas.width - 5, 0, 5, canvas.height);
  const layers = new THREE.CanvasTexture(canvas);
  layers.colorSpace = THREE.SRGBColorSpace;
  const side = new THREE.MeshStandardMaterial({ map: layers, roughness: 0.82 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xeee6d7, roughness: 0.84 });
  const bottom = new THREE.MeshStandardMaterial({ color: 0x241b31, roughness: 0.76 });
  return new THREE.Mesh(new THREE.BoxGeometry(0.83, height, 1.125), [
    side,
    side,
    paper,
    bottom,
    side,
    side,
  ]);
}

function createLabel(text: string, x: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  roundRect(ctx, 8, 8, 368, 80, 28);
  ctx.fillStyle = 'rgba(18, 13, 28, 0.86)';
  ctx.fill();
  ctx.strokeStyle = '#e5bd67';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = '#f8e8bd';
  ctx.font = '900 38px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 192, 49);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  label.position.set(x, 0.82, 0.66);
  label.scale.set(0.92, 0.23, 1);
  return label;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}
