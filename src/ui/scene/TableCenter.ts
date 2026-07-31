import * as THREE from 'three';
import type { UnoCard } from '../../game/uno/types';
import { createCardMesh } from './CardRenderer';

/**
 * 桌面中央：牌堆 + 弃牌堆渲染。
 * 牌堆：竖直一叠牌（只显示顶牌背面）
 * 弃牌堆：水平堆叠，顶牌朝上可见
 */

const DECK_POS = new THREE.Vector3(-1.2, 0.36, 0);
const DISCARD_POS = new THREE.Vector3(1.2, 0.36, 0);

export class TableCenterRenderer {
  private deckGroup = new THREE.Group();
  private discardGroup = new THREE.Group();
  private deckTopMesh: THREE.Mesh | null = null;

  constructor(private scene: THREE.Scene) {
    this.scene.add(this.deckGroup);
    this.scene.add(this.discardGroup);
  }

  /** 同步牌堆（数量 + 顶牌背面）与弃牌堆（顶牌正面） */
  sync(deckCount: number, discardTop: UnoCard | null): void {
    // 牌堆：一叠牌（按数量堆高度）
    const targetHeight = 0.02 + Math.min(deckCount, 40) * 0.008;
    if (this.deckTopMesh) {
      this.deckGroup.remove(this.deckTopMesh);
      this.deckTopMesh.geometry.dispose();
    }
    if (deckCount > 0) {
      const backMesh = createBackMesh();
      backMesh.position.y = targetHeight;
      this.deckGroup.add(backMesh);
      this.deckTopMesh = backMesh;
    }
    this.deckGroup.position.copy(DECK_POS);

    // 弃牌堆：顶牌平放朝上（+z 正面）
    this.discardGroup.clear();
    if (discardTop) {
      const mesh = createCardMesh(discardTop);
      mesh.rotation.set(0, 0, 0);
      mesh.position.y = 0.36;
      this.discardGroup.add(mesh);
    }
    this.discardGroup.position.copy(DISCARD_POS);
  }

  dispose(): void {
    this.scene.remove(this.deckGroup);
    this.scene.remove(this.discardGroup);
  }
}

/** 牌背朝上的占位卡 */
function createBackMesh(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(0.55, 0.03, 0.72);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a4e, roughness: 0.4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
