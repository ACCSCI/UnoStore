import * as THREE from 'three';
import type { HearthCard } from '../../game/core/state';
import { getEffect } from '../../game/hearth/effects/registry';
import type { HeroId } from '../../game/heroes';
import type { UnoCard } from '../../game/uno/types';
import { assetUrl } from '../assets/url';
import { audio } from '../audio/AudioManager';
import type { CardVisual } from '../effects/CardEffects';
import { createDrawCardBackMesh, loadCardBackTexture } from './CardBackRenderer';
import { CardDetailPanel } from './CardDetailPanel';
import type { HandInteractionMode } from './HandInteractionMode';
import { HandRenderer } from './HandRenderer';
import { MinionBoardRenderer } from './MinionBoard';
import { OpponentHandRenderer } from './OpponentHandRenderer';
import {
  createPlayedCardMesh,
  disposePlayedCardMesh,
  type PlayedCardVisual,
} from './PlayedCardRenderer';
import { minionSeatWorldPosition, separateSeatHudAnchors, TABLE_VISUAL_LAYOUT } from './SeatLayout';
import {
  TableCenterRenderer,
  tableCenterWorldPosition,
  tableDeckWorldPosition,
  tableDiscardWorldPosition,
} from './TableCenter';
import { TavernScene } from './TavernScene';
import { UIActionBar } from './UIActionBar';

const HAND_COLLAPSE_SFX_DURATION_MS = 688;
const HAND_EXPAND_SFX_DURATION_MS = 708.063;

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
  private readonly clock = new THREE.Clock();
  private readonly tavern: TavernScene;
  private pageVisible = !document.hidden;
  private readonly container: HTMLElement;
  private hand: HandRenderer | null = null;
  private opponentHand: OpponentHandRenderer | null = null;
  private tableCenter: TableCenterRenderer | null = null;
  private detailPanel: CardDetailPanel | null = null;
  private actionBar: UIActionBar | null = null;
  private minionBoard: MinionBoardRenderer | null = null;
  private handCollapseButton: HTMLButtonElement | null = null;
  private handCollapsed = false;
  private playerCount = 2;
  private seatHudElements: HTMLElement[] = [];
  private readonly serverClickPosition = new THREE.Vector3();
  private readonly drawCardBackTexture: Promise<THREE.Texture>;
  private disposed = false;

  // 回调（由 BattleScreen 注入）
  private onCardClick: (id: string, isHearth: boolean, position?: number) => void = () => {};
  private onEndClick: () => void = () => {};
  private onSelectAttacker: (id: string) => void = () => {};
  private onAttackMinion: (id: string) => void = () => {};
  private onInvalidAttackTarget: () => void = () => {};
  private onServerClick: (seat: number, position: THREE.Vector3) => void = () => {};
  private onCancelGameplaySelection: () => boolean = () => false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.drawCardBackTexture = loadCardBackTexture();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.position.set(0, 5.8, 7.8);
    this.camera.lookAt(0, 0.35, 0);

    this.buildLights();
    this.buildTable();
    this.tavern = new TavernScene(this.scene, this.camera);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.container.addEventListener('pointerdown', this.handleUiPointerDown, true);
    this.renderer.domElement.addEventListener('contextmenu', this.handleCanvasContextMenu);
  }

  /** 注入操作回调（BattleScreen 调用） */
  bindCallbacks(cb: {
    onCardClick?: (id: string, isHearth: boolean, position?: number) => void;
    onEndClick?: () => void;
    onSelectAttacker?: (id: string) => void;
    onAttackMinion?: (id: string) => void;
    onInvalidAttackTarget?: () => void;
    onServerClick?: (seat: number, position: THREE.Vector3) => void;
    onCancelGameplaySelection?: () => boolean;
  }): void {
    if (cb.onCardClick) this.onCardClick = cb.onCardClick;
    if (cb.onEndClick) this.onEndClick = cb.onEndClick;
    if (cb.onSelectAttacker) this.onSelectAttacker = cb.onSelectAttacker;
    if (cb.onAttackMinion) this.onAttackMinion = cb.onAttackMinion;
    if (cb.onInvalidAttackTarget) this.onInvalidAttackTarget = cb.onInvalidAttackTarget;
    if (cb.onServerClick) this.onServerClick = cb.onServerClick;
    if (cb.onCancelGameplaySelection) {
      this.onCancelGameplaySelection = cb.onCancelGameplaySelection;
    }
  }

  start(): void {
    this.onResize();
    this.animate();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.container.removeEventListener('pointerdown', this.handleUiPointerDown, true);
    this.renderer.domElement.removeEventListener('contextmenu', this.handleCanvasContextMenu);
    this.hand?.dispose();
    this.opponentHand?.dispose();
    this.tableCenter?.dispose();
    this.detailPanel?.hide();
    this.actionBar?.remove();
    this.minionBoard?.remove();
    this.handCollapseButton?.remove();
    this.handCollapseButton = null;
    this.seatHudElements = [];
    this.tavern.dispose();
    void this.drawCardBackTexture.then((texture) => texture.dispose());
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite)) return;
      if (object instanceof THREE.Mesh) object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
        material.dispose();
      }
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
    this.minionBoard = new MinionBoardRenderer(
      container,
      {
        onSelectAttacker: (id) => this.onSelectAttacker(id),
        onAttackMinion: (id) => this.onAttackMinion(id),
        onInvalidAttackTarget: () => this.onInvalidAttackTarget(),
        onHoverMinion: (minion) => this.detailPanel?.showMinion(minion),
        onPreviewMinion: (minion) => this.detailPanel?.pinMinion(minion),
      },
      (seat, playerCount) => this.minionSeatPosition(seat, playerCount, container)
    );
    this.actionBar.addButton('结束回合', '结束回合并结算补牌', () => this.onEndClick(), 'primary');
    this.handCollapseButton = document.createElement('button');
    this.handCollapseButton.type = 'button';
    this.handCollapseButton.className = 'hand-collapse-button';
    this.handCollapseButton.textContent = '收牌';
    this.handCollapseButton.setAttribute('aria-pressed', 'false');
    this.handCollapseButton.addEventListener('click', this.toggleHandCollapsed);
    container.appendChild(this.handCollapseButton);
  }

  /** 同步手牌（Uno + 炉石） */
  syncHand(
    uno: UnoCard[],
    hearth: HearthCard[],
    playableIds: Set<string>,
    selectedIds: Set<string> = new Set(),
    interactionMode: HandInteractionMode = 'play'
  ): void {
    this.hand?.sync(uno, hearth);
    this.hand?.setPlayable(playableIds);
    this.hand?.setSelected(selectedIds);
    this.hand?.setInteractionMode(interactionMode);
  }

  /** Render the selected heroes as independent articulated paper puppets. */
  syncPuppets(heroIds: readonly HeroId[]): void {
    this.playerCount = heroIds.length;
    this.tavern.syncPuppets(heroIds);
    this.layoutSeatHud();
  }

  bindSeatHudElements(elements: readonly HTMLElement[]): void {
    this.seatHudElements = [...elements];
    this.seatHudElements[0]?.parentElement?.classList.add('world-anchored-seat-ring');
    this.layoutSeatHud();
  }

  playHeroEmoteAnimation(seat: number, emoteId: string, durationMs = 1900): void {
    this.tavern.playHeroEmote(seat, emoteId, durationMs);
  }

  clearHandInteraction(): void {
    this.hand?.clearGameplayInteraction();
    this.hand?.setPlayable(new Set());
    this.hand?.setSelected(new Set());
  }

  /** 同步桌面中央（牌堆 + 弃牌堆） */
  syncTable(deckCount: number, discardTop: UnoCard | null, chosenColor?: UnoCard['color']): void {
    this.tableCenter?.sync(deckCount, discardTop, chosenColor);
    this.hand?.refreshExtraPreview(this.tableCenter?.displayedCard() ?? null);
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
    this.playerCount = playerCount;
    this.detailPanel?.setSuppressed(Boolean(selectedAttackerId) || Boolean(spellTargetSide));
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
  playCardAnimation(player: number, playerCount: number, visual: PlayedCardVisual): Promise<void> {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return this.animationPause(70);
    const mesh = createPlayedCardMesh(visual);
    const from = this.seatActionPosition(player, playerCount);
    mesh.position.copy(from);
    this.scene.add(mesh);
    const to = tableDiscardWorldPosition();
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
          disposePlayedCardMesh(mesh, visual.kind === 'uno');
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  /** 自动抽牌演出：牌从公共牌库飞入玩家手牌。 */
  async playDrawAnimation(player = 0, playerCount = 2): Promise<void> {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return this.animationPause(80);
    const sharedTexture = await this.drawCardBackTexture;
    if (this.disposed) return;
    const animationTexture = sharedTexture.clone();
    animationTexture.needsUpdate = true;
    const mesh = createDrawCardBackMesh(animationTexture);
    const from = tableDeckWorldPosition();
    const to = this.seatActionPosition(player, playerCount);
    const via = from
      .clone()
      .lerp(to, 0.5)
      .add(new THREE.Vector3(0, 1.4, 0));
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
          mesh.geometry.dispose();
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const material of materials) material.dispose();
          animationTexture.dispose();
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
    const mesh = createPlayedCardMesh({
      kind: 'hearth',
      card: { id: `summon-${effectId || 'unknown'}`, effectId },
    });
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      material.transparent = true;
      material.opacity = 0.9;
    }
    const from = this.seatActionPosition(player, playerCount).add(new THREE.Vector3(0, 0.8, 0));
    const to = tableCenterWorldPosition(0.74);
    mesh.position.copy(from);
    this.scene.add(mesh);
    return this.animateTemporary(mesh, 620, (t) => {
      const eased = 1 - (1 - t) ** 3;
      mesh.position.lerpVectors(from, to, eased);
      mesh.scale.setScalar(0.35 + eased * 0.85);
      mesh.lookAt(this.camera.position);
      mesh.rotation.z = (1 - eased) * -0.18;
      const opacity = t < 0.72 ? 0.9 : (1 - t) / 0.28;
      for (const material of materials) material.opacity = opacity;
    });
  }

  /** 随从头像与红色航线统一使用实际 DOM 攻击者和目标，避免座位中心错位。 */
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
    void player;
    void playerCount;
    const combatAnimation = attackerId
      ? this.minionBoard?.playCombatAnimation(
          attackerId,
          targetMinionId,
          target,
          damage,
          counterDamage
        )
      : undefined;
    return combatAnimation ?? this.animationPause(100);
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
        ? tableDeckWorldPosition(0.82)
        : this.seatActionPosition(fromPlayer, playerCount);
    const to = this.seatActionPosition(target, playerCount);
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
  playHeroPowerAnimation(heroId: string, player: number, playerCount: number): Promise<void> {
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
    const overlayParent = this.container.parentElement;
    overlayParent?.appendChild(overlay);
    if (overlayParent) {
      const actor = this.projectWorldToElement(
        this.seatActionPosition(player, playerCount),
        overlayParent
      );
      const deck = this.projectWorldToElement(tableDeckWorldPosition(), overlayParent);
      const discard = this.projectWorldToElement(tableDiscardWorldPosition(), overlayParent);
      const center = this.projectWorldToElement(tableCenterWorldPosition(), overlayParent);
      const start = heroId === 'cardMaster' ? deck : actor;
      for (const card of overlay.querySelectorAll<HTMLElement>('.vfx-card')) {
        card.style.left = `${start.x}px`;
        card.style.top = `${start.y}px`;
      }
      const deckElement = overlay.querySelector<HTMLElement>('.vfx-deck');
      if (deckElement) {
        deckElement.style.left = `${deck.x}px`;
        deckElement.style.top = `${deck.y}px`;
      }
      const handElement = overlay.querySelector<HTMLElement>('.vfx-hand');
      if (handElement) {
        handElement.style.left = `${actor.x}px`;
        handElement.style.top = `${actor.y}px`;
      }
      setTravel(overlay, 'deck', deck.x - actor.x, deck.y - actor.y);
      setTravel(overlay, 'actor', actor.x - deck.x, actor.y - deck.y);
      setTravel(overlay, 'discard', discard.x - actor.x, discard.y - actor.y);
      setTravel(overlay, 'center', center.x - actor.x, center.y - actor.y);
    }
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
    const from = this.seatActionPosition(player, playerCount);
    const to =
      target === null ? tableCenterWorldPosition() : this.seatActionPosition(target, playerCount);
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
    const from = this.seatActionPosition(player, playerCount);
    const to =
      target === null
        ? tableCenterWorldPosition(0.82)
        : this.seatActionPosition(target, playerCount);
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

  private seatActionPosition(player: number, playerCount: number): THREE.Vector3 {
    return this.tavern.getSeatActionWorldPosition(player, playerCount, new THREE.Vector3());
  }

  private projectWorldToElement(
    world: THREE.Vector3,
    element: HTMLElement
  ): { x: number; y: number } {
    const canvasBounds = this.renderer.domElement.getBoundingClientRect();
    const elementBounds = element.getBoundingClientRect();
    const projected = world.clone().project(this.camera);
    return {
      x: canvasBounds.left - elementBounds.left + (projected.x * 0.5 + 0.5) * canvasBounds.width,
      y: canvasBounds.top - elementBounds.top + (-projected.y * 0.5 + 0.5) * canvasBounds.height,
    };
  }

  private minionSeatPosition(
    seat: number,
    playerCount: number,
    element: HTMLElement
  ): { x: number; y: number } {
    const insetAnchor = minionSeatWorldPosition(seat, playerCount);
    return this.projectWorldToElement(insetAnchor, element);
  }

  private toggleHandCollapsed = (): void => {
    this.handCollapsed = !this.handCollapsed;
    const animationDurationMs = this.hand?.getCollapseTransitionDurationMs() ?? 460;
    this.hand?.setCollapsed(this.handCollapsed);
    const soundDurationMs = this.handCollapsed
      ? HAND_COLLAPSE_SFX_DURATION_MS
      : HAND_EXPAND_SFX_DURATION_MS;
    audio.playSfx(
      this.handCollapsed
        ? '/assets/audio/sfx/generated/hand_collapse.mp3'
        : '/assets/audio/sfx/generated/hand_expand.mp3',
      0.72,
      soundDurationMs / animationDurationMs
    );
    if (!this.handCollapseButton) return;
    this.handCollapseButton.textContent = this.handCollapsed ? '展开手牌' : '收牌';
    this.handCollapseButton.setAttribute('aria-pressed', String(this.handCollapsed));
  };

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
    this.minionBoard?.layout(this.playerCount);
    this.layoutSeatHud();
  };

  private layoutSeatHud(): void {
    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;
    const placements: Array<{
      element: HTMLElement;
      seat: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];
    for (const element of this.seatHudElements) {
      const seat = Number(element.dataset.seat);
      if (!Number.isInteger(seat) || seat <= 0) continue;
      const position = this.tavern.getPuppetHudPosition(seat, width, height);
      if (!position) continue;
      const bounds = element.getBoundingClientRect();
      placements.push({
        element,
        seat,
        ...position,
        width: bounds.width || 104,
        // Include the absolutely positioned crystal and hand-count badges.
        height: (bounds.height || 48) + 48,
      });
    }

    const separated = separateSeatHudAnchors(placements, width);
    for (const position of separated) {
      const { element } = position;
      element.dataset.worldAnchored = 'true';
      element.classList.remove('far-seat');
      element.style.setProperty('--seat-screen-x', `${position.x.toFixed(2)}px`);
      element.style.setProperty('--seat-screen-y', `${position.y.toFixed(2)}px`);
    }
  }

  private handleUiPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (event.target === this.renderer.domElement) {
      const seat = this.tavern.hitTestServer(
        event.clientX,
        event.clientY,
        this.renderer.domElement.getBoundingClientRect()
      );
      if (seat !== null) {
        event.preventDefault();
        event.stopPropagation();
        this.onServerClick(
          seat,
          this.tavern.getServerWorldPosition(this.serverClickPosition).clone()
        );
      }
      return;
    }
    this.hand?.clearPreviewSelection();
    this.detailPanel?.clearPinned();
  };

  private handleCanvasContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    // Gameplay targeting owns the first right click. Only an otherwise idle
    // canvas is allowed to interpret empty space as hand collapse/expand.
    if (this.onCancelGameplaySelection()) {
      event.stopPropagation();
      return;
    }
    if (this.hand?.containsCardAt(event.clientX, event.clientY)) return;
    const viewport = this.renderer.domElement.getBoundingClientRect();
    if (this.tavern.hitTestServer(event.clientX, event.clientY, viewport, false) !== null) return;
    event.stopPropagation();
    this.toggleHandCollapsed();
  };

  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate);
    if (!this.pageVisible) return;
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.tavern.update(this.clock.elapsedTime, delta);
    this.renderer.render(this.scene, this.camera);
  };

  private onVisibilityChange = (): void => {
    this.pageVisible = !document.hidden;
    if (this.pageVisible) this.clock.getDelta();
  };

  private buildLights(): void {
    const ambient = new THREE.HemisphereLight(0xffffff, 0x8d8d8d, 1.1);
    this.scene.add(ambient);
    const fill = new THREE.DirectionalLight(0xffffff, 0.62);
    fill.position.set(-4, 3, -5);
    this.scene.add(fill);
    const glow = new THREE.PointLight(0xffffff, 0.22, 12);
    glow.position.set(0, 3, 0);
    this.scene.add(glow);
  }

  /** 炉石式椭圆圆桌：厚木底座与连续毛毡桌面。 */
  private buildTable(): void {
    const material = new THREE.SpriteMaterial({
      transparent: false,
      alphaTest: 0.025,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const loader = new THREE.TextureLoader();
    const assign = (texture: THREE.Texture): void => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      material.map = texture;
      material.needsUpdate = true;
    };
    loader.load(assetUrl('/assets/images/tavern/table.avif'), assign, undefined, () =>
      loader.load(assetUrl('/assets/images/tavern/table.webp'), assign)
    );
    const table = new THREE.Sprite(material);
    table.name = 'painted-2d-card-table';
    table.position.set(TABLE_VISUAL_LAYOUT.x, TABLE_VISUAL_LAYOUT.y, TABLE_VISUAL_LAYOUT.z);
    table.scale.set(TABLE_VISUAL_LAYOUT.width, TABLE_VISUAL_LAYOUT.height, 1);
    table.renderOrder = -2;
    this.scene.add(table);
  }
}

function setTravel(
  element: HTMLElement,
  name: 'deck' | 'actor' | 'discard' | 'center',
  x: number,
  y: number
): void {
  element.style.setProperty(`--vfx-${name}-x`, `${x.toFixed(1)}px`);
  element.style.setProperty(`--vfx-${name}-y`, `${y.toFixed(1)}px`);
}
