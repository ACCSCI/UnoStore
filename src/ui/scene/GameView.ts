import * as THREE from 'three';
import { createDefaultGame, dispatch } from '../../game';
import { Rng } from '../../game/core/rng';
import type { GameState } from '../../game/core/state';
import { loadGameAssets } from '../assets/loader';
import { HandRenderer } from './HandRenderer';
import { TableCenterRenderer } from './TableCenter';

/**
 * 卡通风 3D 牌桌场景（Phase 3/4）。
 * - Blender GLB 资产（table.glb 压缩版）为场景主体
 * - 手牌区 / 桌面中央牌区由程序化渲染器驱动
 * - 规则引擎状态通过 sync() 流入渲染层（只读）
 */
export class GameView {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private rafId = 0;
  private readonly container: HTMLElement;
  private hand: HandRenderer | null = null;
  private tableCenter: TableCenterRenderer | null = null;
  private gameState: GameState | null = null;
  private gameRng: Rng | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

  start(): void {
    this.onResize();
    this.animate();
    this.startDemoGame();
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  /** 演示对局：2 人 AI 快速对战，驱动渲染 */
  private startDemoGame(): void {
    this.gameState = createDefaultGame(2, 7);
    this.gameRng = new Rng(7);
    this.hand = new HandRenderer(this.scene);
    this.tableCenter = new TableCenterRenderer(this.scene);
    // AI 驱动：每 600ms 一步（模拟对局节奏）
    const timer = window.setInterval(() => {
      if (!this.gameState || this.gameState.phase === 'gameOver') {
        window.clearInterval(timer);
        return;
      }
      this.autoStep();
      this.syncRender();
    }, 600);
  }

  /** AI 自动一步（demo 用；正式由故事/AI 模块驱动） */
  private autoStep(): void {
    const state = this.gameState!;
    const rng = this.gameRng!;
    const playable = state.players[state.turn]!.hand.map((c, i) => ({ c, i })).filter(({ c }) =>
      matches(c, state)
    );
    if (playable.length > 0 && state.unoActionsLeft > 0) {
      const pick = playable[Math.floor(Math.random() * playable.length)]!;
      const color =
        pick.c.color === null
          ? (['red', 'yellow', 'green', 'blue'][Math.floor(Math.random() * 4)] as
              | 'red'
              | 'yellow'
              | 'green'
              | 'blue')
          : undefined;
      dispatch(state, rng, { type: 'playUno', player: state.turn, cardIdx: pick.i, color });
      return;
    }
    if (state.unoActionsLeft > 0) {
      dispatch(state, rng, { type: 'drawUno', player: state.turn });
      return;
    }
    dispatch(state, rng, { type: 'endTurn', player: state.turn });
  }

  /** 渲染层同步：手牌 + 桌面中央 */
  private syncRender(): void {
    const state = this.gameState!;
    this.hand?.sync(state.players[0]!.hand, null);
    this.tableCenter?.sync(state.unoDraw.length, state.topCard);
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
    // 环境氛围：柔和点光
    const glow = new THREE.PointLight(0xffa500, 0.3, 12);
    glow.position.set(0, 3, 0);
    this.scene.add(glow);
  }

  /** 座位：8 个彩色垫子，面向桌心 */
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

  /** 占位牌桌（GLB 失败兜底） */
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

/** 与规则引擎 canPlayOn 一致（避免导入游戏模块的循环依赖） */
function matches(card: { color: string | null; value: string }, state: GameState): boolean {
  const top = state.topCard;
  const current = state.chosenColor;
  if (card.color === null) return true;
  if (card.color === current) return true;
  if (card.value === top.value) return true;
  return false;
}
