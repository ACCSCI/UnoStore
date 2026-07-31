import * as THREE from 'three';
import type { HearthCard } from '../../game/core/state';
import type { UnoCard } from '../../game/uno/types';
import { createCardMesh } from './CardRenderer';
import { createHearthCardMesh } from './HearthCardRenderer';

/**
 * 手牌区渲染（炉石传说风格）：
 * - 默认：紧凑堆叠（错开露出一小条），牌面朝上（+y）
 * - 悬停：该牌上浮 + 放大 + 与相邻牌拉开，其余牌不变
 * - 点击触发回调
 */

const BASE_Y = 0.36;
const HOVER_Y = 0.62;
const HOVER_SCALE = 1.25;
const OVERLAP = 0.34; // 牌间错开距离（< 牌宽 0.55 → 堆叠效果）
const ROW_Z = 4.35; // 手牌行距玩家侧
const CARD_TILT = -0.22; // 微倾，牌面朝上偏玩家

export interface HandCardEntry {
  id: string;
  isHearth: boolean;
  uno?: UnoCard;
  hearth?: HearthCard;
  playable: boolean;
}

export class HandRenderer {
  private group = new THREE.Group();
  private meshes: Map<string, THREE.Mesh> = new Map();
  private hoverId: string | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    private camera: THREE.PerspectiveCamera,
    private onClick: (entry: HandCardEntry) => void,
    private onHover?: (entry: HandCardEntry | null) => void
  ) {
    this.scene.add(this.group);
    renderer.domElement.addEventListener('pointermove', this.handleMove);
    renderer.domElement.addEventListener('click', this.handleClick);
  }

  dispose(): void {
    this.renderer.domElement.removeEventListener('pointermove', this.handleMove);
    this.renderer.domElement.removeEventListener('click', this.handleClick);
    for (const mesh of this.meshes.values()) this.group.remove(mesh);
    this.meshes.clear();
    this.scene.remove(this.group);
  }

  /** 同步双牌手牌：uno 数组 + hearth 数组 → 堆叠排列 */
  sync(uno: UnoCard[], hearth: HearthCard[]): void {
    const entries: HandCardEntry[] = [
      ...uno.map((c) => ({ id: c.id, isHearth: false, uno: c, playable: true })),
      ...hearth.map((c) => ({ id: c.id, isHearth: true, hearth: c, playable: true })),
    ];
    // 移除已不存在的牌
    const ids = new Set(entries.map((e) => e.id));
    for (const [id, mesh] of this.meshes) {
      if (!ids.has(id)) {
        this.group.remove(mesh);
        this.meshes.delete(id);
      }
    }
    // 布局：紧凑错开堆叠（Uno 左、炉石右）
    const n = entries.length;
    entries.forEach((entry, i) => {
      let mesh = this.meshes.get(entry.id);
      if (!mesh) {
        mesh = entry.isHearth ? createHearthCardMesh(entry.hearth!) : createCardMesh(entry.uno!);
        mesh.userData.entry = entry;
        this.meshes.set(entry.id, mesh);
        this.group.add(mesh);
      }
      this.layoutCard(entry.id, i, n);
    });
  }

  /** 更新可打出状态 */
  setPlayable(ids: Set<string>): void {
    for (const [id, mesh] of this.meshes) {
      const entry = mesh.userData.entry as HandCardEntry | undefined;
      if (entry) entry.playable = ids.has(id);
    }
  }

  private layoutCard(id: string, index: number, total: number): void {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    const isHover = this.hoverId === id;
    // 默认：紧凑堆叠；悬停：上浮 + 放大
    const x = (index - (total - 1) / 2) * OVERLAP;
    const y = isHover ? HOVER_Y : BASE_Y;
    const scale = isHover ? HOVER_SCALE : 1;
    mesh.position.set(x, y, ROW_Z);
    mesh.scale.set(scale, scale, scale);
    mesh.rotation.set(CARD_TILT, 0, 0);
  }

  private handleMove = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects([...this.meshes.values()], false)[0];
    const id = hit?.object?.userData?.entry?.id ?? null;
    if (id !== this.hoverId) {
      this.hoverId = id;
      const entry = id ? (this.meshes.get(id)?.userData.entry as HandCardEntry) : null;
      this.onHover?.(entry ?? null);
      // 重排（悬停牌上浮放大）
      const entries = [...this.meshes.values()].map((m) => m.userData.entry as HandCardEntry);
      for (let i = 0; i < entries.length; i++) this.layoutCard(entries[i]!.id, i, entries.length);
    }
  };

  private handleClick = (e: PointerEvent): void => {
    this.handleMove(e);
    const id = this.hoverId;
    if (id) {
      const entry = this.meshes.get(id)?.userData.entry as HandCardEntry | undefined;
      if (entry) this.onClick(entry);
    }
  };

  clear(): void {
    for (const mesh of this.meshes.values()) this.group.remove(mesh);
    this.meshes.clear();
  }
}
