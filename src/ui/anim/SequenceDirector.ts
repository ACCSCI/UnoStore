import * as THREE from 'three';
import type { GameEvent } from '../../game/core/events';
import type { UnoCard } from '../../game/uno/types';
import { createCardMesh } from '../scene/CardRenderer';
import { seatWorldPosition } from '../scene/SeatLayout';
import { tableDiscardWorldPosition } from '../scene/TableCenter';
import { Ease, Tween } from './Tween';

/**
 * 演出序列系统（Phase 4）：
 * 消费规则引擎事件流 → 驱动 3D 场景演出（出牌飞行、连击特效、报牌动画）。
 * 渲染层只读事件，绝不改规则状态。
 */

export class SequenceDirector {
  private tween = new Tween();
  private effects: THREE.Group;

  constructor(
    private scene: THREE.Scene,
    private playerCount = 8,
    private tablePos: THREE.Vector3 = tableDiscardWorldPosition()
  ) {
    this.effects = new THREE.Group();
    this.scene.add(this.effects);
  }

  /** 消费事件并编排演出（不阻塞逻辑） */
  play(events: GameEvent[], cardById: (id: string) => UnoCard | null): void {
    for (const e of events) {
      switch (e.type) {
        case 'unoPlayed': {
          const card = cardById(e.cardId);
          if (card) this.flyCard(card, e.player);
          break;
        }
        case 'unoAlert':
          this.bounceBanner(`UNO! 玩家 ${e.player}`);
          break;
        case 'drawPenalty':
          this.flashColor(0xff3333, 300);
          break;
        case 'gameOver':
          this.bounceBanner(`🏆 玩家 ${e.winner} 获胜！`);
          break;
        case 'hearthPlayed':
          this.flashColor(0x3399ff, 200);
          break;
      }
    }
  }

  /** 出牌飞行：从玩家方向飞向弃牌堆（贝塞尔弧线） */
  private flyCard(card: UnoCard, player: number): void {
    const mesh = createCardMesh(card);
    this.scene.add(mesh);
    const from = seatWorldPosition(player, this.playerCount).add(new THREE.Vector3(0, 1.1, 0));
    const via = from
      .clone()
      .lerp(this.tablePos, 0.5)
      .add(new THREE.Vector3(0, 1.4, 0));
    mesh.position.copy(from);
    mesh.rotation.set(-0.3, 0, 0);
    this.tween.fly(mesh, from, via, this.tablePos, 0.45, Ease.cubicInOut, () => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    });
    // 飞行中旋转
    this.tween.to(mesh, { 'rotation.z': Math.PI * 2 }, 0.45, Ease.linear);
  }

  /** 屏幕中央横幅（UNO 报牌 / 获胜） */
  private bounceBanner(text: string): void {
    console.log(`[演出] ${text}`);
    // V1：console 横幅 + 未来 CSS/DOM 横幅接入点
  }

  /** 全屏颜色闪烁（惩罚/炉石效果）：淡入淡出 */
  private flashColor(color: number, duration: number): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), mat);
    plane.position.set(0, 3, -6);
    this.effects.add(plane);
    // 淡入
    this.tween.to(plane, { 'material.opacity': 0.35 }, duration * 0.25, Ease.quadIn);
    // 淡出
    this.tween.to(plane, { 'material.opacity': 0 }, duration, Ease.quadOut, () => {
      this.effects.remove(plane);
      mat.dispose();
    });
  }
}
