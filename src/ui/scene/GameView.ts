import * as THREE from 'three';
import type { HearthCard } from '../../game/core/state';
import { getEffect } from '../../game/hearth/effects/registry';
import type { UnoCard } from '../../game/uno/types';
import { assetUrl } from '../assets/url';
import type { CardVisual } from '../effects/CardEffects';
import { CardDetailPanel } from './CardDetailPanel';
import { HandRenderer } from './HandRenderer';
import { MinionBoardRenderer } from './MinionBoard';
import { OpponentHandRenderer } from './OpponentHandRenderer';
import { TableCenterRenderer } from './TableCenter';
import { UIActionBar } from './UIActionBar';

/**
 * 卡通风 3D 牌桌场景。
 * - 炉石式大型椭圆牌桌为场景主体
 * - 手牌 / 桌面中央牌区由程序化渲染器驱动
 * - 3D 交互：电脑拿牌后点桌面确认，触屏长按拖放，配合立体结束回合按钮
 * - 规则引擎状态通过 sync*() 流入渲染层（只读），操作通过回调传出
 */
export class GameView {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private rafId = 0;
  private readonly container: HTMLElement;
  private hand: HandRenderer | null = null;
  private opponentHand: OpponentHandRenderer | null = null;
  private tableCenter: TableCenterRenderer | null = null;
  private detailPanel: CardDetailPanel | null = null;
  private actionBar: UIActionBar | null = null;
  private minionBoard: MinionBoardRenderer | null = null;

  // 回调（由 BattleScreen 注入）
  private onCardClick: (id: string, isHearth: boolean, position?: number) => void = () => {};
  private onEndClick: () => void = () => {};
  private onSelectAttacker: (id: string) => void = () => {};
  private onAttackMinion: (id: string) => void = () => {};

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1026);
    this.scene.fog = new THREE.Fog(0x0b1026, 9, 18);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.position.set(0, 5.8, 7.8);
    this.camera.lookAt(0, 0.35, 0);

    this.buildLights();
    this.buildTable();
    window.addEventListener('resize', this.onResize);
    this.container.addEventListener('pointerdown', this.handleUiPointerDown, true);
  }

  /** 注入操作回调（BattleScreen 调用） */
  bindCallbacks(cb: {
    onCardClick?: (id: string, isHearth: boolean, position?: number) => void;
    onEndClick?: () => void;
    onSelectAttacker?: (id: string) => void;
    onAttackMinion?: (id: string) => void;
  }): void {
    if (cb.onCardClick) this.onCardClick = cb.onCardClick;
    if (cb.onEndClick) this.onEndClick = cb.onEndClick;
    if (cb.onSelectAttacker) this.onSelectAttacker = cb.onSelectAttacker;
    if (cb.onAttackMinion) this.onAttackMinion = cb.onAttackMinion;
  }

  start(): void {
    this.onResize();
    this.animate();
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    this.container.removeEventListener('pointerdown', this.handleUiPointerDown, true);
    this.hand?.dispose();
    this.opponentHand?.dispose();
    this.tableCenter?.dispose();
    this.detailPanel?.hide();
    this.actionBar?.remove();
    this.minionBoard?.remove();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  /** 初始化手牌、桌面中央与唯一回合操作。 */
  setupScene(container: HTMLElement): void {
    this.hand = new HandRenderer(
      this.scene,
      this.renderer,
      this.camera,
      (entry, clientX) => {
        const effect = entry.hearth ? getEffect(entry.hearth.effectId) : null;
        const position =
          effect?.kind === 'minion' && clientX !== undefined
            ? this.minionBoard?.placementIndexAt(clientX)
            : undefined;
        this.onCardClick(entry.id, entry.isHearth, position);
      },
      (entry) => this.detailPanel?.show(entry),
      (raycaster) => this.tableCenter?.hitTest(raycaster) ?? null,
      (entry) => {
        if (entry) this.detailPanel?.pin(entry);
        else this.detailPanel?.clearPinned();
      },
      (entry, clientX, _clientY, overTable) => {
        const effectId = entry?.hearth?.effectId;
        const isMinion = effectId && getEffect(effectId)?.kind === 'minion';
        this.minionBoard?.previewPlacement(isMinion && overTable ? effectId : null, clientX ?? 0);
      }
    );
    this.detailPanel = new CardDetailPanel(container);
    this.tableCenter = new TableCenterRenderer(this.scene);
    this.opponentHand = new OpponentHandRenderer(this.scene);
    this.actionBar = new UIActionBar(container);
    this.minionBoard = new MinionBoardRenderer(container, {
      onSelectAttacker: (id) => this.onSelectAttacker(id),
      onAttackMinion: (id) => this.onAttackMinion(id),
      onHoverMinion: (minion) => this.detailPanel?.showMinion(minion),
      onPreviewMinion: (minion) => this.detailPanel?.pinMinion(minion),
    });
    this.actionBar.addButton('结束回合', '结束回合并结算补牌', () => this.onEndClick(), 'primary');
  }

  /** 同步手牌（Uno + 炉石） */
  syncHand(
    uno: UnoCard[],
    hearth: HearthCard[],
    playableIds: Set<string>,
    selectedIds: Set<string> = new Set()
  ): void {
    this.hand?.sync(uno, hearth);
    this.hand?.setPlayable(playableIds);
    this.hand?.setSelected(selectedIds);
  }

  clearHandInteraction(): void {
    this.hand?.clearPreviewSelection();
    this.hand?.setPlayable(new Set());
    this.hand?.setSelected(new Set());
    this.detailPanel?.clearPinned();
  }

  /** 同步桌面中央（牌堆 + 弃牌堆） */
  syncTable(deckCount: number, discardTop: UnoCard | null, chosenColor?: UnoCard['color']): void {
    this.tableCenter?.sync(deckCount, discardTop, chosenColor);
  }

  /** 同步对手手牌（牌背数量） */
  syncOpponentHand(count: number): void {
    this.opponentHand?.sync(count);
  }

  /** 设置操作按钮可用/禁用 */
  setActionEnabled(index: number, enabled: boolean): void {
    this.actionBar?.setButtonEnabled(index, enabled);
  }

  setActionHint(index: number, hint: string): void {
    this.actionBar?.setButtonHint(index, hint);
  }

  setActionAttention(index: number, attention: boolean): void {
    this.actionBar?.setButtonAttention(index, attention);
  }

  syncMinions(
    playerBoard: import('../../game/core/state').MinionState[],
    enemyBoard: import('../../game/core/state').MinionState[],
    selectedAttackerId: string | null,
    canAct: boolean,
    playerCount: number,
    spellTargetSide: 'friendly' | 'enemy' | 'any' | null = null
  ): void {
    this.minionBoard?.sync(
      playerBoard,
      enemyBoard,
      selectedAttackerId,
      canAct,
      playerCount,
      spellTargetSide
    );
  }

  /** 出牌飞行动画：牌从手牌位置飞到弃牌堆（贝塞尔弧线） */
  playCardAnimation(from: THREE.Vector3): Promise<void> {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return this.animationPause(70);
    // 创建一个临时卡牌飞行
    const geo = new THREE.BoxGeometry(0.5, 0.03, 0.65);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.4 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    this.scene.add(mesh);
    const to = new THREE.Vector3(1.2, 0.36, 0);
    const via = new THREE.Vector3((from.x + to.x) / 2, 2.0, (from.z + to.z) / 2);
    const curve = new THREE.CubicBezierCurve3(from, via, via, to);
    const start = performance.now();
    const duration = 400;
    return new Promise((resolve) => {
      const step = (): void => {
        const t = Math.min((performance.now() - start) / duration, 1);
        const e = 1 - (1 - t) ** 3; // easeOutCubic
        mesh.position.copy(curve.getPoint(e));
        if (t < 1) requestAnimationFrame(step);
        else {
          this.scene.remove(mesh);
          geo.dispose();
          mat.dispose();
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  /** 自动抽牌演出：牌从公共牌库飞入玩家手牌。 */
  playDrawAnimation(player = 0, playerCount = 2): Promise<void> {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return this.animationPause(80);
    const geometry = new THREE.BoxGeometry(0.55, 0.04, 0.74);
    const material = new THREE.MeshStandardMaterial({
      color: 0x35205c,
      emissive: 0x8d5bd5,
      emissiveIntensity: 0.45,
      roughness: 0.35,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const from = new THREE.Vector3(-1.05, 0.85, 0);
    const to = this.seatPosition(player, playerCount).setY(1);
    const via = new THREE.Vector3(-0.5, 2.15, 1.7);
    const curve = new THREE.QuadraticBezierCurve3(from, via, to);
    mesh.position.copy(from);
    this.scene.add(mesh);
    const start = performance.now();
    const duration = 520;
    return new Promise((resolve) => {
      const step = (): void => {
        const t = Math.min((performance.now() - start) / duration, 1);
        const eased = 1 - (1 - t) ** 3;
        mesh.position.copy(curve.getPoint(eased));
        mesh.rotation.y = eased * Math.PI;
        mesh.rotation.x = -eased * 0.85;
        if (t < 1) requestAnimationFrame(step);
        else {
          this.scene.remove(mesh);
          geometry.dispose();
          material.dispose();
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  /** 随从立绘从卡牌位置落到战场；不再生成无语义的圆锥。 */
  playSummonAnimation(player: number, playerCount: number, effectId = ''): Promise<void> {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return this.animationPause(90);
    const geometry = new THREE.PlaneGeometry(0.86, 1.08);
    const texture = effectId
      ? new THREE.TextureLoader().load(
          assetUrl(`/assets/images/hearth/${encodeURIComponent(effectId)}.webp`)
        )
      : null;
    const material = new THREE.MeshBasicMaterial({
      color: 0xffe0a0,
      map: texture,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const from = this.seatPosition(player, playerCount).setY(2.2);
    const to = from.clone().multiplyScalar(0.69).setY(0.74);
    mesh.position.copy(from);
    this.scene.add(mesh);
    return this.animateTemporary(mesh, 620, (t) => {
      const eased = 1 - (1 - t) ** 3;
      mesh.position.lerpVectors(from, to, eased);
      mesh.scale.setScalar(0.35 + eased * 0.85);
      mesh.lookAt(this.camera.position);
      mesh.rotation.z = (1 - eased) * -0.18;
      material.opacity = t < 0.72 ? 0.9 : (1 - t) / 0.28;
    });
  }

  /** 随从头像真实前冲；红色立体曲线仅负责清晰标出攻击方向。 */
  playAttackAnimation(
    player: number,
    target: number,
    playerCount: number,
    attackerId?: string,
    targetMinionId?: string,
    damage = 0,
    counterDamage = 0
  ): Promise<void> {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return this.animationPause(100);
    const from = this.seatPosition(player, playerCount).multiplyScalar(0.7).setY(0.88);
    const to = this.seatPosition(target, playerCount).multiplyScalar(0.72).setY(0.92);
    const via = from.clone().add(to).multiplyScalar(0.5).setY(2.25);
    const curve = new THREE.QuadraticBezierCurve3(from, via, to);
    const trailMaterial = new THREE.MeshStandardMaterial({
      color: 0xff2d2d,
      emissive: 0xb40000,
      emissiveIntensity: 2.4,
      transparent: true,
      opacity: 0,
      roughness: 0.32,
    });
    const trail = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.045, 8, false), trailMaterial);
    const group = new THREE.Group();
    group.add(trail);
    this.scene.add(group);
    const start = performance.now();
    const duration = 760;
    const curveAnimation = new Promise<void>((resolve) => {
      const step = (): void => {
        const t = Math.min((performance.now() - start) / duration, 1);
        const fade = t < 0.82 ? Math.min(t * 5, 0.82) : Math.max(0, (1 - t) * 4.5);
        trailMaterial.opacity = fade;
        if (t < 1) requestAnimationFrame(step);
        else {
          this.scene.remove(group);
          trail.geometry.dispose();
          trailMaterial.dispose();
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
    const combatAnimation = attackerId
      ? this.minionBoard?.playCombatAnimation(
          attackerId,
          targetMinionId,
          target,
          damage,
          counterDamage
        )
      : undefined;
    return Promise.all([curveAnimation, combatAnimation]).then(() => undefined);
  }

  /** 法术：施法者座位升起奥术光球并射向目标/牌桌中心。 */
  playSpellAnimation(player: number, target: number | null, playerCount: number): Promise<void> {
    return this.playCardEffectAnimation('arcane', player, target, playerCount);
  }

  /** +N：首段由上一位传递既有罚抽牌，新增部分再从公共牌堆补向目标。 */
  playPenaltyDealAnimation(
    target: number,
    count: number,
    playerCount: number,
    fromPlayer?: number
  ): Promise<void> {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return this.animationPause(120);
    }
    const total = Math.max(1, Math.min(10, count));
    const from =
      fromPlayer === undefined
        ? new THREE.Vector3(-0.82, 0.82, 0.05)
        : this.seatPosition(fromPlayer, playerCount).multiplyScalar(0.78).setY(1.05);
    const to = this.seatPosition(target, playerCount).multiplyScalar(0.78).setY(1.05);
    const cards: THREE.Mesh[] = [];
    for (let index = 0; index < total; index++) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 180;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#241842';
      ctx.fillRect(0, 0, 128, 180);
      ctx.strokeStyle = '#f4d77b';
      ctx.lineWidth = 8;
      ctx.strokeRect(7, 7, 114, 166);
      ctx.fillStyle = '#8c5ce8';
      ctx.beginPath();
      ctx.ellipse(64, 90, 38, 61, 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff4ca';
      ctx.font = '700 24px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fromPlayer === undefined ? 'UNO+' : '传递', 64, 90);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const card = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.6),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })
      );
      card.position.copy(from).add(new THREE.Vector3(index * 0.012, index * 0.012, 0));
      card.rotation.x = -Math.PI / 2;
      card.userData.penaltyTexture = texture;
      cards.push(card);
      this.scene.add(card);
    }
    const stagger = 72;
    const flight = 500;
    const duration = flight + (total - 1) * stagger;
    const started = performance.now();
    return new Promise((resolve) => {
      const step = (): void => {
        const elapsed = performance.now() - started;
        cards.forEach((card, index) => {
          const t = Math.max(0, Math.min(1, (elapsed - index * stagger) / flight));
          const eased = t * t * (3 - 2 * t);
          card.position.lerpVectors(from, to, eased);
          card.position.y += Math.sin(t * Math.PI) * (0.75 + index * 0.02);
          card.rotation.x = -Math.PI / 2 + t * Math.PI * 1.3;
          card.rotation.z = (index % 2 === 0 ? 1 : -1) * t * 0.42;
          card.scale.setScalar(t > 0.88 ? Math.max(0, (1 - t) / 0.12) : 1);
        });
        if (elapsed < duration) requestAnimationFrame(step);
        else {
          for (const card of cards) {
            this.scene.remove(card);
            card.geometry.dispose();
            (card.material as THREE.Material).dispose();
            (card.userData.penaltyTexture as THREE.Texture).dispose();
          }
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  /** 英雄技能使用可读的专属道具演出：抓牌手、弃牌与洗牌，不生成几何占位物。 */
  playHeroPowerAnimation(heroId: string): Promise<void> {
    const overlay = document.createElement('div');
    overlay.className = `hero-power-vfx ${heroId}`;
    overlay.setAttribute('aria-hidden', 'true');
    if (heroId === 'cardMaster') {
      overlay.innerHTML =
        '<span class="vfx-deck">🂠</span><span class="vfx-hand">🤚</span><span class="vfx-card one">🂠</span><span class="vfx-card two">🂠</span>';
    } else if (heroId === 'thug') {
      overlay.innerHTML =
        '<span class="vfx-card discard-one">🂠</span><span class="vfx-card discard-two">🂠</span><strong>弃置</strong>';
    } else {
      overlay.innerHTML =
        '<span class="vfx-card mix-one">🂠</span><span class="vfx-card mix-two">🂠</span><span class="vfx-card mix-three">🂠</span><strong>重新分配</strong>';
    }
    this.container.parentElement?.appendChild(overlay);
    return new Promise((resolve) => {
      window.setTimeout(() => {
        overlay.remove();
        resolve();
      }, 1050);
    });
  }

  /** 卡牌专属主题演出；闪电使用折线路径，其余主题使用不同材质、轨迹和命中色。 */
  playCardEffectAnimation(
    visual: CardVisual,
    player: number,
    target: number | null,
    playerCount: number
  ): Promise<void> {
    if (visual === 'lightning') return this.playLightningAnimation(player, target, playerCount);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return this.animationPause(100);
    const theme: Record<Exclude<CardVisual, 'lightning'>, [number, number]> = {
      fire: [0xff742f, 0xff1900],
      frost: [0xc8f7ff, 0x49bfff],
      arcane: [0x9cc8ff, 0x6040ff],
      shadow: [0xb17aff, 0x31085f],
      nature: [0x8dff9f, 0x168c49],
      shield: [0xffe9a6, 0x3c9dff],
      time: [0xf4ceff, 0x974dcb],
      draw: [0xffd576, 0x3b86d4],
      transform: [0xff92df, 0x51d8ff],
      summon: [0xffd36a, 0xff8a24],
    };
    const [color] = theme[visual];
    const geometry = new THREE.PlaneGeometry(0.72, 0.72);
    const material = new THREE.MeshBasicMaterial({
      color,
      map: this.createGlyphTexture(visual),
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const from = this.seatPosition(player, playerCount).setY(1.2);
    const to =
      target === null
        ? new THREE.Vector3(0, 0.8, 0)
        : this.seatPosition(target, playerCount).multiplyScalar(0.75).setY(1.05);
    mesh.position.copy(from);
    this.scene.add(mesh);
    return this.animateTemporary(mesh, 720, (t) => {
      const charge = Math.min(t / 0.32, 1);
      const travel = Math.max(0, (t - 0.32) / 0.68);
      mesh.position.lerpVectors(from, to, travel * travel * (3 - 2 * travel));
      mesh.lookAt(this.camera.position);
      mesh.rotation.z = t * Math.PI * 2;
      mesh.scale.setScalar(0.35 + charge * 0.95 + (t > 0.88 ? (t - 0.88) * 6 : 0));
      material.opacity = t < 0.9 ? 0.94 : (1 - t) * 9.4;
    });
  }

  /** 闪电箭：充能后沿不规则三维折线发射，带分叉、移动电核和命中闪光。 */
  private playLightningAnimation(
    player: number,
    target: number | null,
    playerCount: number
  ): Promise<void> {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return this.animationPause(120);
    const from = this.seatPosition(player, playerCount).setY(1.25);
    const to =
      target === null
        ? new THREE.Vector3(0, 0.82, 0)
        : this.seatPosition(target, playerCount).multiplyScalar(0.75).setY(1.04);
    const points: THREE.Vector3[] = [];
    const segments = 18;
    for (let index = 0; index <= segments; index++) {
      const t = index / segments;
      const point = from.clone().lerp(to, t);
      const envelope = Math.sin(t * Math.PI);
      if (index > 0 && index < segments) {
        point.x += (Math.random() - 0.5) * 0.38 * envelope;
        point.y += (Math.random() - 0.25) * 0.34 * envelope + Math.sin(t * Math.PI) * 0.55;
        point.z += (Math.random() - 0.5) * 0.38 * envelope;
      }
      points.push(point);
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const boltGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(72));
    boltGeometry.setDrawRange(0, 0);
    const boltMaterial = new THREE.LineBasicMaterial({
      color: 0xbef7ff,
      transparent: true,
      opacity: 1,
    });
    const bolt = new THREE.Line(boltGeometry, boltMaterial);
    const light = new THREE.PointLight(0x6eeaff, 5, 5);
    light.position.copy(from);
    const group = new THREE.Group();
    group.add(bolt, light);

    for (const branchT of [0.38, 0.62, 0.78]) {
      const origin = curve.getPoint(branchT);
      const branchPoints = [
        origin,
        origin
          .clone()
          .add(new THREE.Vector3((Math.random() - 0.5) * 0.45, 0.18, (Math.random() - 0.5) * 0.45)),
        origin
          .clone()
          .add(
            new THREE.Vector3((Math.random() - 0.5) * 0.82, -0.12, (Math.random() - 0.5) * 0.82)
          ),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(branchPoints);
      const material = new THREE.LineBasicMaterial({ color: 0x55bfff, transparent: true });
      const branch = new THREE.Line(geometry, material);
      branch.userData.disposableMaterial = material;
      group.add(branch);
    }
    this.scene.add(group);
    const start = performance.now();
    const duration = 680;
    return new Promise((resolve) => {
      const step = (): void => {
        const t = Math.min((performance.now() - start) / duration, 1);
        const travel = Math.min(t / 0.78, 1);
        light.position.copy(curve.getPoint(travel));
        boltGeometry.setDrawRange(0, Math.ceil(73 * travel));
        boltMaterial.opacity = t < 0.8 ? 0.95 : Math.max(0, (1 - t) * 5);
        light.intensity = t < 0.82 ? 4 + Math.sin(t * 55) * 2 : Math.max(0, (1 - t) * 25);
        for (const child of group.children) {
          if (child instanceof THREE.Line && child !== bolt) {
            (child.material as THREE.LineBasicMaterial).opacity = boltMaterial.opacity * 0.8;
          }
        }
        if (t < 1) requestAnimationFrame(step);
        else {
          this.scene.remove(group);
          boltGeometry.dispose();
          boltMaterial.dispose();
          for (const child of group.children) {
            if (child instanceof THREE.Line && child !== bolt) {
              child.geometry.dispose();
              (child.material as THREE.Material).dispose();
            }
          }
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  animationPause(duration = 240): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, duration));
  }

  private seatPosition(player: number, playerCount: number): THREE.Vector3 {
    const angle = Math.PI / 2 + (Math.PI * 2 * player) / Math.max(2, playerCount);
    return new THREE.Vector3(Math.cos(angle) * 3.55, 0, Math.sin(angle) * 2.45);
  }

  private createGlyphTexture(visual: Exclude<CardVisual, 'lightning'>): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const glyphs: Record<Exclude<CardVisual, 'lightning'>, string> = {
      fire: '🔥',
      frost: '❄',
      arcane: '✦',
      shadow: '☾',
      nature: '❧',
      shield: '⬟',
      time: '◷',
      draw: '🂠',
      transform: '🐑',
      summon: '♟',
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 150px system-ui, sans-serif';
    ctx.shadowColor = 'white';
    ctx.shadowBlur = 26;
    ctx.fillStyle = 'white';
    ctx.fillText(glyphs[visual], 128, 136);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private animateTemporary(
    mesh: THREE.Mesh,
    duration: number,
    update: (progress: number) => void
  ): Promise<void> {
    const start = performance.now();
    return new Promise((resolve) => {
      const step = (): void => {
        const progress = Math.min((performance.now() - start) / duration, 1);
        update(progress);
        if (progress < 1) requestAnimationFrame(step);
        else {
          this.scene.remove(mesh);
          mesh.geometry.dispose();
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const material of materials) material.dispose();
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  private onResize = (): void => {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.9 ? 60 : 50;
    this.camera.updateProjectionMatrix();
    this.hand?.resize();
  };

  private handleUiPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || event.target === this.renderer.domElement) return;
    this.hand?.clearPreviewSelection();
    this.detailPanel?.clearPinned();
  };

  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate);
    this.renderer.render(this.scene, this.camera);
  };

  private buildLights(): void {
    const ambient = new THREE.HemisphereLight(0xdce9ff, 0x241225, 1.35);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xf2f6ff, 2.05);
    key.position.set(5, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x6f8dff, 0.75);
    fill.position.set(-4, 3, -5);
    this.scene.add(fill);
    const glow = new THREE.PointLight(0x7599ff, 0.62, 10);
    glow.position.set(0, 3, 0);
    this.scene.add(glow);
  }

  /** 炉石式椭圆圆桌：厚木底座与连续毛毡桌面。 */
  private buildTable(): void {
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 0.42, 72),
      new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9, metalness: 0 })
    );
    base.scale.set(4.2, 1, 3.02);
    base.position.y = 0.12;
    base.castShadow = true;
    base.receiveShadow = true;
    this.scene.add(base);

    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 0.1, 72),
      new THREE.MeshStandardMaterial({ color: 0x174b49, roughness: 0.92, metalness: 0 })
    );
    felt.scale.set(4.02, 1, 2.84);
    felt.position.y = 0.39;
    felt.receiveShadow = true;
    this.scene.add(felt);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(11, 64),
      new THREE.MeshStandardMaterial({ color: 0x0d1530, roughness: 1 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.11;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }
}
