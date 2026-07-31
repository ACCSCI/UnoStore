import * as THREE from 'three';
import type { UnoCard } from '../../game/uno/types';
import { createCardMesh } from './CardRenderer';

/**
 * 手牌区渲染：弧形展开 + 选中抬升 + 牌面朝上。
 * 渲染只消费 GameState 的快照，不直接改规则状态。
 */

const ARC_RADIUS = 4.4;
const SPREAD = 0.62; // 相邻牌间距
const BASE_Y = 0.55;
const HOVER_Y = 0.95;

export class HandRenderer {
  private group = new THREE.Group();
  private cardMeshes: Map<string, THREE.Mesh> = new Map();

  constructor(private scene: THREE.Scene) {
    this.scene.add(this.group);
  }

  /** 根据手牌快照同步渲染（增量更新） */
  sync(hand: UnoCard[], selectedIdx: number | null): void {
    // 移除已不存在的牌
    const ids = new Set(hand.map((c) => c.id));
    for (const [id, mesh] of this.cardMeshes) {
      if (!ids.has(id)) {
        this.group.remove(mesh);
        this.cardMeshes.delete(id);
      }
    }
    // 添加/更新牌
    const count = hand.length;
    hand.forEach((card, i) => {
      let mesh = this.cardMeshes.get(card.id);
      if (!mesh) {
        mesh = createCardMesh(card);
        this.cardMeshes.set(card.id, mesh);
        this.group.add(mesh);
      }
      const t = count <= 1 ? 0 : i / (count - 1) - 0.5;
      const angle = t * 0.9;
      const x = t * SPREAD * (count - 1);
      const z = ARC_RADIUS - Math.cos(angle) * 0.6;
      const y = selectedIdx === i ? HOVER_Y : BASE_Y;
      mesh.position.set(x, y, z);
      mesh.rotation.set(-0.45, -angle * 0.7, 0);
    });
  }

  clear(): void {
    for (const mesh of this.cardMeshes.values()) this.group.remove(mesh);
    this.cardMeshes.clear();
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.group);
  }
}
