import * as THREE from 'three';
import type { HearthCard } from '../../game/core/state';
import type { UnoCard } from '../../game/uno/types';
import { createCardMesh } from './CardRenderer';
import { createHearthCardMesh } from './HearthCardRenderer';

/**
 * 手牌区渲染（炉石传说风格）：
 * - Uno 牌在左、炉石牌在右，合成一个手持扇形（像手里拿的牌）
 * - 可点击出牌：hover 高亮抬升 + click 触发回调
 * - 渲染只消费快照，通过回调把操作交给上层
 */

const BASE_Y = 0.36;
const HOVER_Y = 0.5;
const FAN_ANGLE = 0.5; // 紧凑扇形（微弧，像摊在桌上）
const FAN_RADIUS = 4.6; // 玩家侧
const SPREAD = 0.52; // 相邻牌间距（略重叠，炉石感）
const CARD_TILT = -0.25; // 微倾，牌面朝上偏玩家

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

  /** 同步双牌手牌：uno 数组 + hearth 数组 → 合并扇形 */
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
    // 布局：Uno 在左、炉石在右的弧形
    const n = entries.length;
    entries.forEach((entry, i) => {
      let mesh = this.meshes.get(entry.id);
      if (!mesh) {
        mesh = entry.isHearth ? createHearthCardMesh(entry.hearth!) : createCardMesh(entry.uno!);
        mesh.userData.entry = entry;
        this.meshes.set(entry.id, mesh);
        this.group.add(mesh);
      }
      // 扇形参数：-FAN_ANGLE/2 → +FAN_ANGLE/2
      // 紧凑扇形：牌面朝上平铺（微弧排列），像摊在桌上
      const t = n <= 1 ? 0 : i / (n - 1) - 0.5;
      const angle = t * FAN_ANGLE;
      const x = t * SPREAD * (n - 1) + Math.sin(angle) * 0.4;
      const z = FAN_RADIUS - Math.cos(angle) * 0.3;
      const y = this.hoverId === entry.id ? HOVER_Y : BASE_Y;
      mesh.position.set(x, y, z);
      // 牌面朝上（+z 面），微倾面向玩家
      mesh.rotation.set(CARD_TILT, -angle * 0.8, 0);
    });
  }

  /** 更新可打出状态（高亮） */
  setPlayable(ids: Set<string>): void {
    for (const [id, mesh] of this.meshes) {
      const entry = mesh.userData.entry as HandCardEntry | undefined;
      if (entry) entry.playable = ids.has(id);
    }
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
      // 重排位置（hover 抬升）
      this.reposition();
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

  private reposition(): void {
    const entries = [...this.meshes.values()].map((m) => m.userData.entry as HandCardEntry);
    const n = entries.length;
    entries.forEach((entry, i) => {
      const mesh = this.meshes.get(entry.id);
      if (!mesh) return;
      const t = n <= 1 ? 0 : i / (n - 1) - 0.5;
      const angle = t * FAN_ANGLE;
      const x = t * SPREAD * (n - 1) + Math.sin(angle) * 0.4;
      const z = FAN_RADIUS - Math.cos(angle) * 0.3;
      const y = this.hoverId === entry.id ? HOVER_Y : BASE_Y;
      mesh.position.set(x, y, z);
      mesh.rotation.set(CARD_TILT, -angle * 0.8, 0);
    });
  }

  clear(): void {
    for (const mesh of this.meshes.values()) this.group.remove(mesh);
    this.meshes.clear();
  }
}
