import * as THREE from 'three';
import type { HearthCard } from '../../game/core/state';
import type { UnoCard } from '../../game/uno/types';
import { createCardMesh, unoCardDataURL } from './CardRenderer';
import {
  HAND_CANDIDATE_OUTLINE,
  type HandInteractionMode,
  resolveHandCardOutline,
  shouldSelectHandCard,
} from './HandInteractionMode';
import { createHearthCardMesh, hearthCardDataURL } from './HearthCardRenderer';

/**
 * 手牌区渲染（炉石传说风格）：
 * - 默认：紧凑堆叠（错开露出一小条），牌面朝上（+y）
 * - 悬停：固定命中槽位，仅轻微抬牌；高清放大预览由 CardDetailPanel 显示
 * - 电脑：单击拿起卡牌并跟随指针，再点击桌面确认打出
 * - 触屏：轻点只选中/预览，长按拖到桌面后释放才打出
 */

const BASE_Y = 0.74;
const HOVER_LIFT = 0.12;
const HOVER_FORWARD = 0.08;
/** 合法牌常驻向牌桌外缘抽出，不能只靠颜色区分。 */
const PLAYABLE_LIFT = 0.17;
const PLAYABLE_FORWARD = 0.035;
const MAX_HAND_WIDTH = 5.4;
/** 每张牌只露出左侧信息带；右侧下一张牌始终盖在它上面。 */
const MAX_CARD_GAP = 0.3;
const ROW_Z = 3.42;
const CARD_TILT = 0.38;
const TOUCH_HOLD_MS = 180;
const TABLE_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.48);

export interface HandCardEntry {
  id: string;
  isHearth: boolean;
  uno?: UnoCard;
  hearth?: HearthCard;
  playable: boolean;
  selected?: boolean;
}

export class HandRenderer {
  private group = new THREE.Group();
  private meshes: Map<string, THREE.Mesh> = new Map();
  private hitMeshes: Map<string, THREE.Mesh> = new Map();
  private orderedIds: string[] = [];
  private hoverId: string | null = null;
  private extraHoverId: string | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private stagedId: string | null = null;
  private previewOnlyId: string | null = null;
  private interactionMode: HandInteractionMode = 'play';
  private touchGesture: {
    pointerId: number;
    cardId: string;
    held: boolean;
    timer: number;
  } | null = null;
  private floatingPreview: HTMLImageElement | null = null;
  private floatingPreviewVersion = 0;
  private suppressContextMenuUntil = 0;

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    private camera: THREE.PerspectiveCamera,
    private onClick: (entry: HandCardEntry, clientX?: number, clientY?: number) => void,
    private onHover?: (entry: HandCardEntry | null) => void,
    private findExtraHover?: (raycaster: THREE.Raycaster) => UnoCard | null,
    private onPreviewSelect?: (entry: HandCardEntry | null) => void,
    private onStagedPointer?: (
      entry: HandCardEntry | null,
      clientX?: number,
      clientY?: number,
      overTable?: boolean
    ) => void
  ) {
    this.scene.add(this.group);
    renderer.domElement.addEventListener('pointermove', this.handleMove);
    renderer.domElement.addEventListener('pointerleave', this.handleLeave);
    renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    renderer.domElement.addEventListener('pointercancel', this.handlePointerCancel);
    window.addEventListener('pointerdown', this.handleGlobalPointerDown, true);
    window.addEventListener('pointermove', this.handleGlobalPointerMove, true);
    window.addEventListener('contextmenu', this.handleContextMenu, true);
    this.resize();
  }

  /** 竖屏会显著收窄 3D 可视宽度，按相机宽高比收拢整副手牌。 */
  resize(): void {
    const scale = Math.min(1, Math.max(0.6, this.camera.aspect / 1.1));
    this.group.scale.setScalar(scale);
    this.group.position.set(0, BASE_Y * (1 - scale), ROW_Z * (1 - scale));
  }

  dispose(): void {
    this.renderer.domElement.removeEventListener('pointermove', this.handleMove);
    this.renderer.domElement.removeEventListener('pointerleave', this.handleLeave);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.handlePointerCancel);
    window.removeEventListener('pointerdown', this.handleGlobalPointerDown, true);
    window.removeEventListener('pointermove', this.handleGlobalPointerMove, true);
    window.removeEventListener('contextmenu', this.handleContextMenu, true);
    for (const mesh of this.meshes.values()) {
      this.group.remove(mesh);
      disposeMesh(mesh);
    }
    this.meshes.clear();
    for (const mesh of this.hitMeshes.values()) {
      this.group.remove(mesh);
      disposeHitMesh(mesh);
    }
    this.hitMeshes.clear();
    this.orderedIds = [];
    this.extraHoverId = null;
    this.cancelTouchGesture();
    this.removeFloatingPreview();
    this.onStagedPointer?.(null);
    this.renderer.domElement.style.cursor = '';
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
    if (this.hoverId && !ids.has(this.hoverId)) {
      this.hoverId = null;
      this.onHover?.(null);
    }
    if (this.stagedId && !ids.has(this.stagedId)) {
      this.stagedId = null;
      this.removeFloatingPreview();
      this.onPreviewSelect?.(null);
      this.onStagedPointer?.(null);
    }
    for (const [id, mesh] of this.meshes) {
      if (!ids.has(id)) {
        this.group.remove(mesh);
        disposeMesh(mesh);
        this.meshes.delete(id);
        const hitMesh = this.hitMeshes.get(id);
        if (hitMesh) {
          this.group.remove(hitMesh);
          disposeHitMesh(hitMesh);
          this.hitMeshes.delete(id);
        }
      }
    }
    // 布局：紧凑错开堆叠（Uno 左、炉石右）
    const n = entries.length;
    this.orderedIds = entries.map((entry) => entry.id);
    entries.forEach((entry, i) => {
      let mesh = this.meshes.get(entry.id);
      if (!mesh) {
        mesh = entry.isHearth ? createHearthCardMesh(entry.hearth!) : createCardMesh(entry.uno!);
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          material.depthTest = false;
          material.depthWrite = false;
          if (material instanceof THREE.MeshStandardMaterial) {
            material.userData.handBaseColor = material.color.getHex();
          }
        }
        mesh.userData.entry = entry;
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(mesh.geometry),
          new THREE.LineBasicMaterial({
            color: HAND_CANDIDATE_OUTLINE,
            transparent: false,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          })
        );
        outline.name = 'playable-outline';
        outline.scale.set(1.055, 1.18, 1.055);
        outline.visible = false;
        outline.renderOrder = 1;
        mesh.add(outline);
        this.meshes.set(entry.id, mesh);
        this.group.add(mesh);
        const hitMesh = createHitMesh(entry);
        this.hitMeshes.set(entry.id, hitMesh);
        this.group.add(hitMesh);
      }
      mesh.userData.entry = entry;
      const hitMesh = this.hitMeshes.get(entry.id);
      if (hitMesh) hitMesh.userData.entry = entry;
      this.layoutCard(entry.id, i, n);
    });
  }

  /** 更新可打出状态 */
  setPlayable(ids: Set<string>): void {
    for (const [id, mesh] of this.meshes) {
      const entry = mesh.userData.entry as HandCardEntry | undefined;
      if (!entry) continue;
      entry.playable = ids.has(id);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) {
          const baseColor = material.userData.handBaseColor;
          if (typeof baseColor === 'number') material.color.setHex(baseColor);
          // 不可操作仍保留可读卡面；合法牌只用金色描边与位置区分，不给牌面染色。
          if (!entry.playable) material.color.multiplyScalar(0.6);
          material.emissive.set(0x000000);
          material.emissiveIntensity = 0;
        }
      }
    }
    for (let i = 0; i < this.orderedIds.length; i++) {
      this.layoutCard(this.orderedIds[i]!, i, this.orderedIds.length);
    }
  }

  /** 来源牌或待弃 UNO 的选中态；与 hover 分离，避免命中区域抖动。 */
  setSelected(ids: Set<string>): void {
    for (const [id, mesh] of this.meshes) {
      const entry = mesh.userData.entry as HandCardEntry | undefined;
      if (!entry) continue;
      entry.selected = ids.has(id);
      // 选中反馈由统一红色外轮廓承担，不再给卡面增白或染色。
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        material.emissive.set(0x000000);
        material.emissiveIntensity = 0;
      }
    }
    for (let i = 0; i < this.orderedIds.length; i++) {
      this.layoutCard(this.orderedIds[i]!, i, this.orderedIds.length);
    }
  }

  /** 所有“从手牌中选择卡牌”的技能/法术共用此模式，不依赖当前是否已有 selected 卡。 */
  setInteractionMode(mode: HandInteractionMode): void {
    if (this.interactionMode === mode) return;
    this.interactionMode = mode;
    if (mode === 'select') this.clearPreviewSelection();
  }

  private layoutCard(id: string, index: number, total: number): void {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    const isHover = this.hoverId === id;
    // 默认：紧凑堆叠；悬停：上浮 + 放大
    const middle = (total - 1) / 2;
    const offset = index - middle;
    const gap = total <= 1 ? 0 : Math.min(MAX_CARD_GAP, MAX_HAND_WIDTH / (total - 1));
    const normalized = middle === 0 ? 0 : offset / middle;
    const x = offset * gap;
    const baseY = BASE_Y - Math.abs(normalized) * 0.13;
    // 右侧牌略靠近相机，命中顺序与绘制顺序一致：后一张永远压住前一张右边。
    const baseZ = ROW_Z + index * 0.008;
    const entry = mesh.userData.entry as HandCardEntry | undefined;
    const selected = Boolean(entry?.selected);
    const playable = Boolean(entry?.playable);
    const y =
      baseY +
      (isHover ? HOVER_LIFT + PLAYABLE_LIFT : selected ? 0.13 : playable ? PLAYABLE_LIFT : 0);
    const scale = isHover ? 1.12 : playable ? 1.095 : 1.025;
    const z =
      baseZ - (isHover ? HOVER_FORWARD + PLAYABLE_FORWARD : playable ? PLAYABLE_FORWARD : 0);
    mesh.position.set(x, y, z);
    mesh.scale.set(scale, scale, scale);
    mesh.rotation.set(CARD_TILT, -normalized * 0.18, normalized * 0.12);
    mesh.renderOrder = isHover ? 1000 : index * 2;
    const outline = mesh.getObjectByName('playable-outline');
    if (outline instanceof THREE.LineSegments) {
      const outlineVisual = resolveHandCardOutline(playable, selected);
      outline.visible = outlineVisual.visible;
      outline.renderOrder = mesh.renderOrder + 1;
      const material = outline.material as THREE.LineBasicMaterial;
      material.color.setHex(outlineVisual.color);
      material.opacity = 1;
      outline.scale.setScalar(outlineVisual.scale);
      outline.scale.y = outlineVisual.scaleY;
    }

    // 命中代理始终留在基础扇形槽位；视觉卡上浮后不会改变下一帧的命中结果。
    const hitMesh = this.hitMeshes.get(id);
    if (hitMesh) {
      hitMesh.position.set(x, BASE_Y - Math.abs(normalized) * 0.13, ROW_Z + index * 0.008);
      hitMesh.scale.setScalar(1.06);
      hitMesh.rotation.set(CARD_TILT, -normalized * 0.18, normalized * 0.12);
    }
  }

  private handleMove = (e: PointerEvent): void => {
    this.updateRaycaster(e);
    if (
      e.pointerType === 'touch' &&
      this.touchGesture?.pointerId === e.pointerId &&
      this.touchGesture.held
    ) {
      e.preventDefault();
      this.updateFloatingCard(this.touchGesture.cardId, e.clientX, e.clientY);
      this.notifyStagedPointer(this.touchGesture.cardId, e.clientX, e.clientY);
      return;
    }
    const hit =
      this.raycaster.intersectObjects([...this.hitMeshes.values()], false)[0] ??
      this.raycaster.intersectObjects([...this.meshes.values()], false)[0];
    const id = hit?.object?.userData?.entry?.id ?? null;
    const hoveredEntry = id
      ? (this.meshes.get(id)?.userData.entry as HandCardEntry | undefined)
      : undefined;
    this.renderer.domElement.style.cursor = id
      ? hoveredEntry?.playable
        ? 'pointer'
        : 'not-allowed'
      : '';
    if (id) {
      this.extraHoverId = null;
      this.setHover(id);
      return;
    }

    this.setHover(null);
    const extraCard = this.findExtraHover?.(this.raycaster) ?? null;
    this.renderer.domElement.style.cursor = extraCard ? 'help' : '';
    const extraId = extraCard ? `${extraCard.id}:${extraCard.color ?? 'wild'}` : null;
    if (extraId === this.extraHoverId) return;
    this.extraHoverId = extraId;
    this.onHover?.(
      extraCard
        ? { id: `table-${extraId}`, isHearth: false, uno: extraCard, playable: false }
        : null
    );
  };

  private handleLeave = (): void => {
    if (this.hoverId === null && this.extraHoverId === null) return;
    this.hoverId = null;
    this.extraHoverId = null;
    if (!(this.stagedId || this.touchGesture?.held)) this.removeFloatingPreview();
    this.onHover?.(null);
    for (let i = 0; i < this.orderedIds.length; i++) {
      this.layoutCard(this.orderedIds[i]!, i, this.orderedIds.length);
    }
  };

  private handleGlobalPointerMove = (event: PointerEvent): void => {
    if (!(this.stagedId && event.pointerType !== 'touch')) return;
    // 捕获阶段覆盖整个视口：无论指针位于 Canvas、HUD 或其他覆盖层，卡牌都持续跟手。
    this.updateRaycaster(event);
    this.updateFloatingCard(this.stagedId, event.clientX, event.clientY);
    this.notifyStagedPointer(this.stagedId, event.clientX, event.clientY);
  };

  private handleGlobalPointerDown = (event: PointerEvent): void => {
    if (!(this.stagedId && event.pointerType !== 'touch' && event.button === 2)) return;
    event.preventDefault();
    event.stopPropagation();
    // contextmenu 会在右键 pointerdown 之后触发；保留短暂标记以吞掉浏览器菜单。
    this.suppressContextMenuUntil = performance.now() + 1000;
    this.clearPreviewSelection();
  };

  private setHover(id: string | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    const entry = id ? (this.meshes.get(id)?.userData.entry as HandCardEntry) : null;
    this.onHover?.(entry ?? null);
    for (let i = 0; i < this.orderedIds.length; i++) {
      this.layoutCard(this.orderedIds[i]!, i, this.orderedIds.length);
    }
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    this.cancelTouchGesture();
    this.updateRaycaster(e);
    const entry = this.hitEntry();
    if (!entry || this.interactionMode === 'select') return;
    const gesture = {
      pointerId: e.pointerId,
      cardId: entry.id,
      held: false,
      timer: 0,
    };
    gesture.timer = window.setTimeout(() => {
      if (this.touchGesture !== gesture) return;
      gesture.held = true;
      this.stage(entry, e.clientX, e.clientY);
      this.renderer.domElement.setPointerCapture?.(e.pointerId);
      if ('vibrate' in navigator) navigator.vibrate(16);
    }, TOUCH_HOLD_MS);
    this.touchGesture = gesture;
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' && e.button !== 0) return;
    this.updateRaycaster(e);
    const entry = this.hitEntry();
    if (e.pointerType === 'touch') {
      e.preventDefault();
      const gesture = this.touchGesture?.pointerId === e.pointerId ? this.touchGesture : null;
      if (gesture) window.clearTimeout(gesture.timer);
      if (gesture?.held) {
        const draggedEntry = this.entryById(gesture.cardId);
        const shouldPlay = Boolean(draggedEntry && this.isOverTable());
        this.touchGesture = null;
        this.renderer.domElement.releasePointerCapture?.(e.pointerId);
        this.removeFloatingPreview();
        if (shouldPlay) {
          this.stagedId = null;
          this.onPreviewSelect?.(null);
          this.onStagedPointer?.(null);
        }
        this.layoutAll();
        if (shouldPlay) this.commit(gesture.cardId, e.clientX, e.clientY);
        return;
      }
      this.touchGesture = null;
      this.handleTap(entry);
      return;
    }

    if (this.stagedId && this.isOverTable()) {
      const id = this.stagedId;
      this.stagedId = null;
      this.onPreviewSelect?.(null);
      this.removeFloatingPreview();
      this.onStagedPointer?.(null);
      this.layoutAll();
      this.commit(id, e.clientX, e.clientY);
      return;
    }
    if (!entry) {
      const tableCard = this.findExtraHover?.(this.raycaster) ?? null;
      if (tableCard) {
        const previewEntry: HandCardEntry = {
          id: `table-${tableCard.id}:${tableCard.color ?? 'wild'}`,
          isHearth: false,
          uno: tableCard,
          playable: false,
        };
        if (this.previewOnlyId === previewEntry.id) {
          this.clearPreviewSelection();
        } else {
          this.stagedId = null;
          this.previewOnlyId = previewEntry.id;
          this.onPreviewSelect?.(previewEntry);
          this.layoutAll();
        }
        return;
      }
      this.clearPreviewSelection();
      return;
    }
    if (shouldSelectHandCard(this.interactionMode, entry.playable)) {
      this.onClick(entry);
      return;
    }
    this.stage(entry, e.clientX, e.clientY);
  };

  private handlePointerCancel = (): void => {
    this.clearPreviewSelection();
  };

  private handleContextMenu = (event: MouseEvent): void => {
    if (!(this.stagedId || performance.now() <= this.suppressContextMenuUntil)) return;
    event.preventDefault();
    event.stopPropagation();
    this.suppressContextMenuUntil = 0;
    if (this.stagedId) this.clearPreviewSelection();
  };

  private handleTap(entry: HandCardEntry | null): void {
    if (!entry) {
      const tableCard = this.findExtraHover?.(this.raycaster) ?? null;
      if (tableCard) {
        const previewEntry: HandCardEntry = {
          id: `table-${tableCard.id}:${tableCard.color ?? 'wild'}`,
          isHearth: false,
          uno: tableCard,
          playable: false,
        };
        this.stagedId = null;
        this.previewOnlyId = previewEntry.id;
        this.onPreviewSelect?.(previewEntry);
        this.layoutAll();
        return;
      }
      this.clearPreviewSelection();
      return;
    }
    if (shouldSelectHandCard(this.interactionMode, entry.playable)) {
      this.onClick(entry);
      return;
    }
    this.clearPreviewSelection();
  }

  private stage(entry: HandCardEntry, clientX: number, clientY: number): void {
    this.previewOnlyId = null;
    this.stagedId = entry.id;
    this.removeFloatingPreview();
    this.onPreviewSelect?.(null);
    this.layoutAll();
    this.updateFloatingCard(entry.id, clientX, clientY);
    this.notifyStagedPointer(entry.id, clientX, clientY);
  }

  private updateRaycaster(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private hitEntry(): HandCardEntry | null {
    const hit =
      this.raycaster.intersectObjects([...this.hitMeshes.values()], false)[0] ??
      this.raycaster.intersectObjects([...this.meshes.values()], false)[0];
    return (hit?.object?.userData?.entry as HandCardEntry | undefined) ?? null;
  }

  private entryById(id: string): HandCardEntry | null {
    return (this.meshes.get(id)?.userData.entry as HandCardEntry | undefined) ?? null;
  }

  private isOverTable(): boolean {
    const point = this.raycaster.ray.intersectPlane(TABLE_PLANE, new THREE.Vector3());
    if (!point) return false;
    return (point.x / 4.02) ** 2 + (point.z / 2.84) ** 2 <= 0.94;
  }

  private updateFloatingCard(id: string, clientX: number, clientY: number): void {
    const entry = this.entryById(id);
    if (!entry) return;
    if (this.floatingPreview?.dataset.cardId !== id) {
      this.removeFloatingPreview();
      const image = new Image();
      image.className = 'hand-drag-preview';
      image.dataset.cardId = id;
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      this.floatingPreview = image;
      const version = ++this.floatingPreviewVersion;
      if (entry.uno) image.src = unoCardDataURL(entry.uno);
      else if (entry.hearth) {
        void hearthCardDataURL(entry.hearth).then((src) => {
          if (this.floatingPreview === image && version === this.floatingPreviewVersion)
            image.src = src;
        });
      }
      (this.renderer.domElement.parentElement ?? document.body).appendChild(image);
    }
    this.floatingPreview.style.left = `${clientX}px`;
    this.floatingPreview.style.top = `${clientY}px`;
  }

  private cancelTouchGesture(): void {
    if (!this.touchGesture) return;
    window.clearTimeout(this.touchGesture.timer);
    this.touchGesture = null;
  }

  private removeFloatingPreview(): void {
    this.floatingPreviewVersion++;
    this.floatingPreview?.remove();
    this.floatingPreview = null;
  }

  private notifyStagedPointer(id: string, clientX: number, clientY: number): void {
    const entry = this.entryById(id);
    if (!entry) return;
    this.onStagedPointer?.(entry, clientX, clientY, this.isOverTable() && this.hitEntry() === null);
  }

  private commit(id: string, clientX: number, clientY: number): void {
    const entry = this.meshes.get(id)?.userData.entry as HandCardEntry | undefined;
    if (entry) this.onClick(entry, clientX, clientY);
  }

  private layoutAll(): void {
    for (let i = 0; i < this.orderedIds.length; i++) {
      this.layoutCard(this.orderedIds[i]!, i, this.orderedIds.length);
    }
  }

  clearPreviewSelection(): void {
    if (!(this.stagedId || this.previewOnlyId)) {
      this.onPreviewSelect?.(null);
      return;
    }
    this.stagedId = null;
    this.previewOnlyId = null;
    this.cancelTouchGesture();
    this.removeFloatingPreview();
    this.onPreviewSelect?.(null);
    this.onStagedPointer?.(null);
    this.layoutAll();
  }

  clear(): void {
    for (const mesh of this.meshes.values()) {
      this.group.remove(mesh);
      disposeMesh(mesh);
    }
    this.meshes.clear();
    for (const mesh of this.hitMeshes.values()) {
      this.group.remove(mesh);
      disposeHitMesh(mesh);
    }
    this.hitMeshes.clear();
    this.orderedIds = [];
    this.interactionMode = 'play';
    this.stagedId = null;
    this.onStagedPointer?.(null);
    this.previewOnlyId = null;
    this.cancelTouchGesture();
    this.removeFloatingPreview();
    this.extraHoverId = null;
    this.renderer.domElement.style.cursor = '';
  }
}

function createHitMesh(entry: HandCardEntry): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.12, 0.9), material);
  mesh.userData.entry = entry;
  mesh.name = `hand-hit-${entry.id}`;
  return mesh;
}

function disposeHitMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) material.dispose();
}

function disposeMesh(mesh: THREE.Mesh): void {
  for (const child of [...mesh.children]) {
    if (!(child instanceof THREE.LineSegments)) continue;
    child.geometry.dispose();
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of childMaterials) material.dispose();
    mesh.remove(child);
  }
  mesh.geometry.dispose();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const entry = mesh.userData.entry as HandCardEntry | undefined;
  for (const material of materials) {
    if (!entry?.isHearth && material instanceof THREE.MeshStandardMaterial) {
      material.map?.dispose();
    }
    material.dispose();
  }
}
