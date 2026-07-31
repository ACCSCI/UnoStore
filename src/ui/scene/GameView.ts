import * as THREE from 'three';
import type { HearthCard } from '../../game/core/state';
import type { UnoCard } from '../../game/uno/types';
import { loadGameAssets } from '../assets/loader';
import { CardDetailPanel } from './CardDetailPanel';
import { HandRenderer } from './HandRenderer';
import { TableCenterRenderer } from './TableCenter';
import { UIActionBar } from './UIActionBar';

/**
 * 卡通风 3D 牌桌场景。
 * - Blender GLB 资产（table.glb 压缩版）为场景主体
 * - 手牌 / 桌面中央牌区由程序化渲染器驱动
 * - 3D 交互：手牌点击出牌、3D 按钮（抽牌/结束回合）
 * - 规则引擎状态通过 sync*() 流入渲染层（只读），操作通过回调传出
 */
export class GameView {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private rafId = 0;
  private readonly container: HTMLElement;
  private hand: HandRenderer | null = null;
  private tableCenter: TableCenterRenderer | null = null;
  private detailPanel: CardDetailPanel = new CardDetailPanel(document.body);
  private actionBar: UIActionBar | null = null;

  // 回调（由 BattleScreen 注入）
  private onCardClick: (id: string, isHearth: boolean) => void = () => {};
  private onDrawClick: () => void = () => {};
  private onEndClick: () => void = () => {};

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a2350);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.position.set(0, 5.5, 7.5);
    this.camera.lookAt(0, 0.2, 0);

    this.buildLights();
    this.buildSeats(8);
    void this.loadTableModel();
    window.addEventListener('resize', this.onResize);
  }

  /** 注入操作回调（BattleScreen 调用） */
  bindCallbacks(cb: {
    onCardClick?: (id: string, isHearth: boolean) => void;
    onDrawClick?: () => void;
    onEndClick?: () => void;
  }): void {
    if (cb.onCardClick) this.onCardClick = cb.onCardClick;
    if (cb.onDrawClick) this.onDrawClick = cb.onDrawClick;
    if (cb.onEndClick) this.onEndClick = cb.onEndClick;
  }

  start(): void {
    this.onResize();
    this.animate();
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    this.hand?.dispose();
    this.tableCenter?.dispose();
    this.actionBar?.remove();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  /** 初始化手牌 + 桌面中央 + UI 操作栏（右侧垂直居中） */
  setupScene(container: HTMLElement): void {
    this.hand = new HandRenderer(
      this.scene,
      this.renderer,
      this.camera,
      (entry) => {
        this.onCardClick(entry.id, entry.isHearth);
      },
      (entry) => this.detailPanel.show(entry)
    );
    this.detailPanel = new CardDetailPanel(container);
    this.tableCenter = new TableCenterRenderer(this.scene);
    // UI 操作栏：抽牌 / 结束回合（右侧垂直居中，对齐）
    this.actionBar = new UIActionBar(container);
    this.actionBar.addButton('抽牌', () => this.onDrawClick(), 'primary');
    this.actionBar.addButton('结束回合', () => this.onEndClick(), 'danger');
  }

  /** 同步手牌（Uno + 炉石） */
  syncHand(uno: UnoCard[], hearth: HearthCard[], playableIds: Set<string>): void {
    this.hand?.sync(uno, hearth);
    this.hand?.setPlayable(playableIds);
  }

  /** 同步桌面中央（牌堆 + 弃牌堆） */
  syncTable(deckCount: number, discardTop: UnoCard | null): void {
    this.tableCenter?.sync(deckCount, discardTop);
  }

  private onResize = (): void => {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate);
    this.renderer.render(this.scene, this.camera);
  };

  private buildLights(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(5, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x8899ff, 0.4);
    fill.position.set(-4, 3, -5);
    this.scene.add(fill);
    const glow = new THREE.PointLight(0xffa500, 0.3, 12);
    glow.position.set(0, 3, 0);
    this.scene.add(glow);
  }

  /** 座位：8 个彩色垫子 */
  private buildSeats(count: number): void {
    const radius = 4.6;
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (i / count) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const seat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.6, 0.12, 16),
        new THREE.MeshStandardMaterial({ color: seatColor(i), roughness: 0.6 })
      );
      seat.position.set(x, 0.06, z);
      seat.rotation.y = -angle + Math.PI / 2;
      this.scene.add(seat);
      seat.name = `seat-${i}`;
    }
  }

  /** 加载 Blender GLB 牌桌；失败时占位 */
  private async loadTableModel(): Promise<void> {
    try {
      const assets = await loadGameAssets();
      assets.table.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.scene.add(assets.table);
    } catch (err) {
      console.warn('GLB 加载失败，使用占位模型', err);
      this.buildTablePlaceholder();
    }
  }

  /** 占位牌桌 */
  private buildTablePlaceholder(): void {
    const tableTop = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.4, 0.3, 32),
      new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.7 })
    );
    tableTop.position.y = 0.15;
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    this.scene.add(tableTop);
  }
}

function seatColor(i: number): number {
  const palette = [0xe74c3c, 0xf1c40f, 0x2ecc71, 0x3498db, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xe84393];
  return palette[i % palette.length]!;
}
