import * as THREE from 'three';
import type { HearthCard } from '../../game/core/state';
import type { UnoCard } from '../../game/uno/types';
import { createCardMesh, unoCardDataURL } from './CardRenderer';
import { type CursorState, handCursorState } from './CursorState';
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

const BASE_Y = 0.1;
const HOVER_LIFT = 0.12;
const HOVER_FORWARD = 0.08;
/** 合法牌常驻向牌桌外缘抽出，不能只靠颜色区分。 */
const PLAYABLE_LIFT = 0.17;
const PLAYABLE_FORWARD = 0.035;
const MAX_HAND_WIDTH = 6.15;
/** 每张牌只露出左侧信息带；右侧下一张牌始终盖在它上面。 */
const MAX_CARD_GAP = 0.34;
const ROW_Z = 3.58;
const CARD_TILT = 0.38;
const HAND_SCALE_BOOST = 1.1;
const HAND_FAN_DROP = 0.22;
const TOUCH_HOLD_MS = 180;
const TABLE_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.48);
const COLLAPSED_X = -3.55;
const COLLAPSED_Y = 0.62;
const COLLAPSED_Z = 3.72;
export const HAND_LAYOUT_TRAVEL_MS = 460;
export const HAND_LAYOUT_STAGGER_MS = 24;

/** 收起和展开共用的逐牌总时长；空手牌仍保留一次基础过渡。 */
export function handLayoutTransitionDurationMs(cardCount: number): number {
  const count = Number.isFinite(cardCount) ? Math.max(0, Math.floor(cardCount)) : 0;
  return HAND_LAYOUT_TRAVEL_MS + Math.max(0, count - 1) * HAND_LAYOUT_STAGGER_MS;
}

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
  private readonly stackEdgeTexture = createStackEdgeTexture();
  private readonly stackMaterials = createStackMaterials(this.stackEdgeTexture);
  private readonly stackBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.67, 0.04, 0.91),
    this.stackMaterials
  );
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
  private collapsed = false;
  private layoutTransitionFrame = 0;

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
    this.stackBase.name = 'collapsed-hand-thickness';
    this.stackBase.rotation.set(CARD_TILT, -0.08, -0.08);
    this.stackBase.renderOrder = -1;
    this.stackBase.visible = false;
    this.group.add(this.stackBase);
    renderer.domElement.addEventListener('pointermove', this.handleMove);
    renderer.domElement.addEventListener('pointerleave', this.handleLeave);
    renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    renderer.domElement.addEventListener('pointercancel', this.handlePointerCancel);
    window.addEventListener('pointerdown', this.handleGlobalPointerDown, true);
    window.addEventListener('pointermove', this.handleGlobalPointerMove, true);
    window.addEventListener('contextmenu', this.handleContextMenu, true);
    this.resize();
    this.setCursor('default');
  }

  /** 竖屏会显著收窄 3D 可视宽度，按相机宽高比收拢整副手牌。 */
  resize(): void {
    const scale = Math.min(1, Math.max(0.6, this.camera.aspect / 1.1));
    this.group.scale.setScalar(scale);
    this.group.position.set(0, BASE_Y * (1 - scale), ROW_Z * (1 - scale));
  }

  dispose(): void {
    cancelAnimationFrame(this.layoutTransitionFrame);
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
    delete this.renderer.domElement.dataset.cursor;
    this.stackBase.geometry.dispose();
    for (const material of this.stackMaterials) material.dispose();
    this.stackEdgeTexture.dispose();
    this.group.remove(this.stackBase);
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
    this.updateStackBase(n);
  }

  setCollapsed(collapsed: boolean): void {
    if (this.collapsed === collapsed) return;
    this.clearPreviewSelection();
    if (collapsed) {
      this.hoverId = null;
      this.extraHoverId = null;
      this.onHover?.(null);
      this.onPreviewSelect?.(null);
      this.setCursor('default');
    }
    this.animateCollapsedLayout(collapsed);
  }

  /** 当前手牌数量对应的收起/展开动画总时长，供音效播放速率同步。 */
  getCollapseTransitionDurationMs(): number {
    return handLayoutTransitionDurationMs(this.orderedIds.length);
  }

  containsCardAt(clientX: number, clientY: number): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects([...this.meshes.values()], false).length > 0;
  }

  /** 更新可打出状态 */
  setPlayable(ids: Set<string>): void {
    for (const [id, mesh] of this.meshes) {
      const entry = mesh.userData.entry as HandCardEntry | undefined;
      if (!entry) continue;
      entry.playable = ids.has(id);
      const outline = mesh.getObjectByName('playable-outline');
      if (outline) outline.visible = entry.playable;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) {
          const baseColor = material.userData.handBaseColor;
          if (typeof baseColor === 'number') material.color.setHex(baseColor);
          // 用卡面贴图自身作为发光颜色：提亮而不覆盖原有色相和细节。
          if (!entry.playable) material.color.multiplyScalar(0.6);
          const hasPlayableFace = entry.playable && Boolean(material.map);
          material.emissive.set(hasPlayableFace ? 0xffffff : 0x000000);
          const nextEmissiveMap = hasPlayableFace ? material.map : null;
          if (material.emissiveMap !== nextEmissiveMap) {
            material.emissiveMap = nextEmissiveMap;
            material.needsUpdate = true;
          }
          material.emissiveIntensity = hasPlayableFace ? 0.3 : 0;
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
    }
    for (let i = 0; i < this.orderedIds.length; i++) {
      this.layoutCard(this.orderedIds[i]!, i, this.orderedIds.length);
    }
  }

  /** 所有从手牌选择卡牌的技能共用同一交互模式。 */
  setInteractionMode(mode: HandInteractionMode): void {
    if (this.interactionMode === mode) return;
    this.interactionMode = mode;
    if (mode === 'select') this.clearPreviewSelection();
  }

  /** 当前牌在鼠标下或已固定时，牌堆更新必须原位刷新详情，不能闪退或保留旧牌。 */
  refreshExtraPreview(card: UnoCard | null): void {
    const entry = card ? tableCardEntry(card) : null;
    if (this.extraHoverId !== null) {
      this.extraHoverId = card ? extraCardKey(card) : null;
      this.onHover?.(entry);
    }
    if (this.previewOnlyId?.startsWith('table-')) {
      this.previewOnlyId = entry?.id ?? null;
      this.onPreviewSelect?.(entry);
    }
  }

  /** 行动演出清理拿牌/拖牌状态，但保留玩家固定查看的当前牌详情。 */
  clearGameplayInteraction(): void {
    const preserveTablePreview = Boolean(this.previewOnlyId?.startsWith('table-'));
    this.stagedId = null;
    this.cancelTouchGesture();
    this.removeFloatingPreview();
    this.onStagedPointer?.(null);
    if (!preserveTablePreview) {
      this.previewOnlyId = null;
      this.onPreviewSelect?.(null);
    }
    this.layoutAll();
    this.setCursor('default');
  }

  private layoutCard(id: string, index: number, total: number): void {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    if (this.collapsed) {
      const thickness = stackThickness(total);
      const layer = total <= 1 ? 1 : index / (total - 1);
      mesh.position.set(
        COLLAPSED_X + index * 0.003,
        COLLAPSED_Y - thickness + layer * thickness,
        COLLAPSED_Z + index * 0.002
      );
      mesh.scale.setScalar(1.04);
      mesh.rotation.set(CARD_TILT, -0.08, -0.08);
      mesh.renderOrder = index * 2;
      const hitMesh = this.hitMeshes.get(id);
      if (hitMesh) hitMesh.visible = false;
      return;
    }
    const isHover = this.hoverId === id;
    // 默认：紧凑堆叠；悬停：上浮 + 放大
    const middle = (total - 1) / 2;
    const offset = index - middle;
    const gap = total <= 1 ? 0 : Math.min(MAX_CARD_GAP, MAX_HAND_WIDTH / (total - 1));
    const normalized = middle === 0 ? 0 : offset / middle;
    const x = offset * gap;
    const baseY = BASE_Y - Math.abs(normalized) * HAND_FAN_DROP;
    // 右侧牌略靠近相机，命中顺序与绘制顺序一致：后一张永远压住前一张右边。
    const baseZ = ROW_Z + index * 0.008;
    const entry = mesh.userData.entry as HandCardEntry | undefined;
    const selected = Boolean(entry?.selected);
    const playable = Boolean(entry?.playable);
    const y =
      baseY +
      (isHover ? HOVER_LIFT + PLAYABLE_LIFT : selected ? 0.13 : playable ? PLAYABLE_LIFT : 0);
    const scale = (isHover ? 1.32 : playable ? 1.24 : 1.16) * HAND_SCALE_BOOST;
    const z =
      baseZ - (isHover ? HOVER_FORWARD + PLAYABLE_FORWARD : playable ? PLAYABLE_FORWARD : 0);
    mesh.position.set(x, y, z);
    mesh.scale.set(scale, scale, scale);
    mesh.rotation.set(CARD_TILT, -normalized * 0.22, normalized * 0.18);
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
      hitMesh.visible = true;
      hitMesh.position.set(x, BASE_Y - Math.abs(normalized) * HAND_FAN_DROP, ROW_Z + index * 0.008);
      hitMesh.scale.setScalar(1.2 * HAND_SCALE_BOOST);
      hitMesh.rotation.set(CARD_TILT, -normalized * 0.22, normalized * 0.18);
    }
  }

  private handleMove = (e: PointerEvent): void => {
    if (this.collapsed) {
      this.setCursor('default');
      return;
    }
    this.updateRaycaster(e);
    if (this.stagedId && e.pointerType !== 'touch') {
      this.setCursor('grabbing');
      return;
    }
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
    this.setCursor(
      handCursorState({
        carrying: false,
        overCard: Boolean(id),
        playable: Boolean(hoveredEntry?.playable),
        overDetail: false,
      })
    );
    if (id) {
      this.extraHoverId = null;
      this.setHover(id);
      return;
    }

    this.setHover(null);
    const extraCard = this.findExtraHover?.(this.raycaster) ?? null;
    this.setCursor(
      handCursorState({
        carrying: false,
        overCard: false,
        playable: false,
        overDetail: Boolean(extraCard),
      })
    );
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
    this.setCursor(this.stagedId ? 'grabbing' : 'default');
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
    this.setCursor('grabbing');
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
    if (this.collapsed) return;
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
      this.setCursor('grabbing');
      this.renderer.domElement.setPointerCapture?.(e.pointerId);
      if ('vibrate' in navigator) navigator.vibrate(16);
    }, TOUCH_HOLD_MS);
    this.touchGesture = gesture;
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (this.collapsed) return;
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
        const previewEntry = tableCardEntry(tableCard);
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
        const previewEntry = tableCardEntry(tableCard);
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
    this.setCursor('grabbing');
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
    if (this.collapsed) return null;
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

  private animateCollapsedLayout(collapsed: boolean): void {
    cancelAnimationFrame(this.layoutTransitionFrame);
    this.layoutTransitionFrame = 0;
    const ids = [...this.orderedIds];
    const starts = new Map<string, CardTransform>();
    for (const id of ids) {
      const mesh = this.meshes.get(id);
      if (mesh) starts.set(id, captureTransform(mesh));
    }

    const startingStackOpacity = this.stackMaterials[0]?.opacity ?? 0;
    this.collapsed = collapsed;
    this.updateStackBase(ids.length);
    this.layoutAll();
    const targets = new Map<string, CardTransform>();
    for (const id of ids) {
      const mesh = this.meshes.get(id);
      if (!mesh) continue;
      targets.set(id, captureTransform(mesh));
      const start = starts.get(id);
      if (start) applyTransform(mesh, start);
    }
    for (const hitMesh of this.hitMeshes.values()) hitMesh.visible = false;
    this.stackBase.visible = true;
    this.setStackOpacity(startingStackOpacity);

    const started = performance.now();
    const totalDuration = handLayoutTransitionDurationMs(ids.length);
    const step = (now: number): void => {
      const elapsed = now - started;
      ids.forEach((id, index) => {
        const mesh = this.meshes.get(id);
        const start = starts.get(id);
        const target = targets.get(id);
        if (!(mesh && start && target)) return;
        const delayIndex = collapsed ? index : ids.length - index - 1;
        const progress = THREE.MathUtils.clamp(
          (elapsed - delayIndex * HAND_LAYOUT_STAGGER_MS) / HAND_LAYOUT_TRAVEL_MS,
          0,
          1
        );
        interpolateTransform(mesh, start, target, easeInOutCubic(progress));
      });
      const stackProgress = easeInOutCubic(THREE.MathUtils.clamp(elapsed / totalDuration, 0, 1));
      this.setStackOpacity(
        THREE.MathUtils.lerp(startingStackOpacity, collapsed ? 1 : 0, stackProgress)
      );
      if (elapsed < totalDuration) {
        this.layoutTransitionFrame = requestAnimationFrame(step);
        return;
      }
      this.layoutTransitionFrame = 0;
      this.layoutAll();
      this.stackBase.visible = this.collapsed;
      this.setStackOpacity(this.collapsed ? 1 : 0);
    };
    this.layoutTransitionFrame = requestAnimationFrame(step);
  }

  private updateStackBase(total: number): void {
    const thickness = stackThickness(total);
    this.stackBase.geometry.dispose();
    this.stackBase.geometry = new THREE.BoxGeometry(0.67, thickness, 0.91);
    this.stackBase.position.set(
      COLLAPSED_X,
      COLLAPSED_Y - thickness / 2 - 0.018,
      COLLAPSED_Z - 0.012
    );
    if (!this.layoutTransitionFrame) {
      this.stackBase.visible = this.collapsed;
      this.setStackOpacity(this.collapsed ? 1 : 0);
    }
  }

  private setStackOpacity(opacity: number): void {
    this.stackMaterials.forEach((material, index) => {
      material.opacity = index === 2 ? 0 : opacity;
    });
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
    this.setCursor('default');
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
    this.setCursor('default');
  }

  private setCursor(state: CursorState): void {
    this.renderer.domElement.dataset.cursor = state;
  }
}

interface CardTransform {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

function captureTransform(mesh: THREE.Mesh): CardTransform {
  return {
    position: mesh.position.clone(),
    rotation: mesh.rotation.clone(),
    scale: mesh.scale.clone(),
  };
}

function applyTransform(mesh: THREE.Mesh, transform: CardTransform): void {
  mesh.position.copy(transform.position);
  mesh.rotation.copy(transform.rotation);
  mesh.scale.copy(transform.scale);
}

function interpolateTransform(
  mesh: THREE.Mesh,
  start: CardTransform,
  target: CardTransform,
  progress: number
): void {
  mesh.position.lerpVectors(start.position, target.position, progress);
  mesh.scale.lerpVectors(start.scale, target.scale, progress);
  mesh.rotation.set(
    THREE.MathUtils.lerp(start.rotation.x, target.rotation.x, progress),
    THREE.MathUtils.lerp(start.rotation.y, target.rotation.y, progress),
    THREE.MathUtils.lerp(start.rotation.z, target.rotation.z, progress)
  );
}

function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
}

function stackThickness(total: number): number {
  return THREE.MathUtils.clamp(0.04 + Math.max(0, total - 1) * 0.028, 0.04, 0.44);
}

function createStackEdgeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e9dfcf';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 3; y < canvas.height; y += 7) {
    ctx.fillStyle = y % 14 === 3 ? '#9e8d78' : '#cfc1ae';
    ctx.fillRect(0, y, canvas.width, 1.5);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createStackMaterials(texture: THREE.Texture): THREE.MeshStandardMaterial[] {
  const side = (): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.9,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
  const paper = new THREE.MeshStandardMaterial({
    color: 0xeee4d4,
    roughness: 0.92,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  const bottom = paper.clone();
  bottom.color.setHex(0x3a2a24);
  // Only the layered sides provide thickness. The real top card must always
  // remain visible regardless of transparent-object sorting.
  paper.colorWrite = false;
  return [side(), side(), paper, bottom, side(), side()];
}

function createHitMesh(entry: HandCardEntry): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.14, 1.04), material);
  mesh.userData.entry = entry;
  mesh.name = `hand-hit-${entry.id}`;
  return mesh;
}

function extraCardKey(card: UnoCard): string {
  return `${card.id}:${card.color ?? 'wild'}`;
}

function tableCardEntry(card: UnoCard): HandCardEntry {
  return {
    id: `table-${extraCardKey(card)}`,
    isHearth: false,
    uno: card,
    playable: false,
  };
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
