import { MAX_MINIONS_PER_PLAYER, type MinionState } from '../../game/core/state';
import { getEffect, minionHasTaunt } from '../../game/hearth/effects/registry';
import { assetUrl } from '../assets/url';

type SpellTargetSide = 'friendly' | 'enemy' | 'any' | null;

interface MinionBoardCallbacks {
  onSelectAttacker: (minionId: string) => void;
  onAttackMinion: (minionId: string) => void;
  onInvalidAttackTarget: () => void;
  onHoverMinion: (minion: MinionState | null) => void;
  onPreviewMinion: (minion: MinionState) => void;
}

/** 指针越过几个随从中心，就插入到第几个位置。 */
export function minionInsertionIndex(pointerX: number, minionCenters: number[]): number {
  return minionCenters.filter((center) => pointerX >= center).length;
}

type SeatAnchorResolver = (seat: number, playerCount: number) => { x: number; y: number };

type RoutePoint = { x: number; y: number };

/**
 * 英雄攻击目标按可见界面优先级解析。本机的圆桌席位仍保留在 DOM 中，
 * 但会被 CSS 隐藏，因此 0 号视觉席必须先指向下方的真实英雄徽记。
 */
export function combatHeroTargetSelectors(targetPlayer: number): string[] {
  const tableSeat = `.table-seat[data-seat="${targetPlayer}"] .seat-target-button`;
  if (targetPlayer === 0) return ['.player-hero .player-crest', tableSeat];
  if (targetPlayer === 1) return [tableSeat, '.opponent-hero'];
  return [tableSeat];
}

/** 屏幕空间的大圆航线近似：弧线始终偏向桌面中心，并避免退化为直线。 */
export function attackRouteGeometry(
  from: RoutePoint,
  to: RoutePoint,
  viewportCenter: RoutePoint
): { control: RoutePoint; path: string } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const normal = { x: -dy / distance, y: dx / distance };
  const arc = Math.min(180, Math.max(64, distance * 0.28));
  const candidates = [
    { x: midpoint.x + normal.x * arc, y: midpoint.y + normal.y * arc },
    { x: midpoint.x - normal.x * arc, y: midpoint.y - normal.y * arc },
  ];
  const distanceToCenter = (point: RoutePoint): number =>
    (point.x - viewportCenter.x) ** 2 + (point.y - viewportCenter.y) ** 2;
  const control =
    distanceToCenter(candidates[0]!) <= distanceToCenter(candidates[1]!)
      ? candidates[0]!
      : candidates[1]!;
  const path = `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
  return { control, path };
}

/** DOM 战场层：原生按钮负责选择己方随从和攻击目标，状态仍完全来自规则引擎。 */
export class MinionBoardRenderer {
  private readonly root: HTMLDivElement;
  private readonly queryRoot: ParentNode;
  private readonly enemyLayer: HTMLDivElement;
  private readonly playerRow: HTMLDivElement;
  private readonly minionButtons = new Map<string, HTMLButtonElement>();
  private readonly enemyRows = new Map<number, HTMLDivElement>();
  private hoveredMinionId: string | null = null;
  private placementPreview: HTMLSpanElement | null = null;
  private placementIndex: number | null = null;

  constructor(
    host: HTMLElement,
    private readonly callbacks: MinionBoardCallbacks,
    private readonly resolveSeatAnchor: SeatAnchorResolver
  ) {
    this.queryRoot = host.parentElement ?? host;
    this.root = document.createElement('div');
    this.root.className = 'minion-board';
    this.root.setAttribute('aria-label', '随从战场');

    this.enemyLayer = document.createElement('div');
    this.enemyLayer.className = 'minion-enemy-zones';
    this.enemyLayer.setAttribute('aria-label', '对手随从');
    this.playerRow = this.createRow('你的随从', 'player');
    this.root.append(this.enemyLayer, this.playerRow);
    host.appendChild(this.root);
  }

  sync(
    playerBoard: MinionState[],
    enemyBoard: MinionState[],
    selectedAttackerId: string | null,
    canAct: boolean,
    playerCount: number,
    spellTargetSide: SpellTargetSide = null
  ): void {
    this.clearPlacementPreview();
    this.root.dataset.playerCount = String(playerCount);
    const liveMinionIds = new Set([...playerBoard, ...enemyBoard].map((minion) => minion.id));
    this.renderEnemyZones(enemyBoard, selectedAttackerId, canAct, spellTargetSide, playerCount);
    const playerAnchor = this.resolveSeatAnchor(0, playerCount);
    this.playerRow.style.setProperty('--minion-x', `${playerAnchor.x.toFixed(1)}px`);
    this.playerRow.style.setProperty('--minion-y', `${playerAnchor.y.toFixed(1)}px`);
    this.renderRow(
      this.playerRow,
      playerBoard,
      'player',
      selectedAttackerId,
      canAct,
      spellTargetSide,
      false
    );
    for (const [id, button] of this.minionButtons) {
      if (liveMinionIds.has(id)) continue;
      button.remove();
      this.minionButtons.delete(id);
    }
    if (this.hoveredMinionId) {
      const hovered = [...playerBoard, ...enemyBoard].find(
        (minion) => minion.id === this.hoveredMinionId
      );
      if (hovered) this.callbacks.onHoverMinion(hovered);
      else this.clearHoveredMinion();
    }
  }

  /** 拿起随从牌后，按指针横向位置预览插入点；幽灵随从让两侧自动让位。 */
  previewPlacement(effectId: string | null, pointerX = 0): void {
    if (!effectId) {
      this.clearPlacementPreview();
      return;
    }
    const buttons = this.playerMinionButtons();
    if (buttons.length >= MAX_MINIONS_PER_PLAYER) {
      this.clearPlacementPreview();
      this.root.dataset.placement = 'blocked';
      return;
    }
    const nextIndex = minionInsertionIndex(
      pointerX,
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left + rect.width / 2;
      })
    );
    if (this.placementPreview?.dataset.effectId === effectId && this.placementIndex === nextIndex)
      return;

    const previousRects = new Map(
      buttons.map((button) => [button, button.getBoundingClientRect()] as const)
    );
    const preview = this.placementPreview ?? document.createElement('span');
    preview.className = 'board-placement-preview';
    preview.dataset.effectId = effectId;
    preview.setAttribute('aria-hidden', 'true');
    preview.innerHTML = `<img src="${assetUrl(`/assets/images/hearth/${encodeURIComponent(effectId)}.webp`)}" alt=""><span>＋</span>`;
    this.playerRow.insertBefore(preview, buttons[nextIndex] ?? null);
    this.placementPreview = preview;
    this.placementIndex = nextIndex;
    this.root.dataset.placement = 'preview';
    this.playerRow.dataset.placement = 'preview';
    this.animatePlacementShift(previousRects);
  }

  placementIndexAt(pointerX: number): number {
    return minionInsertionIndex(
      pointerX,
      this.playerMinionButtons().map((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left + rect.width / 2;
      })
    );
  }

  clearPlacementPreview(): void {
    const buttons = this.playerMinionButtons();
    const previousRects = this.placementPreview
      ? new Map(buttons.map((button) => [button, button.getBoundingClientRect()] as const))
      : null;
    this.placementPreview?.remove();
    this.placementPreview = null;
    this.placementIndex = null;
    delete this.root.dataset.placement;
    delete this.playerRow.dataset.placement;
    if (previousRects) this.animatePlacementShift(previousRects);
  }

  layout(playerCount: number): void {
    const playerAnchor = this.resolveSeatAnchor(0, playerCount);
    this.playerRow.style.setProperty('--minion-x', `${playerAnchor.x.toFixed(1)}px`);
    this.playerRow.style.setProperty('--minion-y', `${playerAnchor.y.toFixed(1)}px`);
    for (const row of this.enemyLayer.querySelectorAll<HTMLElement>('.minion-row[data-owner]')) {
      const owner = Number(row.dataset.owner);
      if (!Number.isInteger(owner)) continue;
      const anchor = this.resolveSeatAnchor(owner, playerCount);
      row.style.setProperty('--minion-x', `${anchor.x.toFixed(1)}px`);
      row.style.setProperty('--minion-y', `${anchor.y.toFixed(1)}px`);
    }
  }

  remove(): void {
    this.clearPlacementPreview();
    this.clearHoveredMinion();
    this.root.remove();
  }

  /** 真实随从头像沿实际 DOM 目标前冲；航线与前冲共用同一对端点。 */
  async playCombatAnimation(
    attackerId: string,
    targetMinionId: string | undefined,
    targetPlayer: number,
    damage: number,
    counterDamage = 0
  ): Promise<void> {
    // 等一帧让刚完成的布局写入生效，再按实例 ID 重新解析当前节点。
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const attacker = this.minionButtons.get(attackerId);
    const target = this.resolveCombatTarget(targetMinionId, targetPlayer);
    if (!(attacker?.isConnected && target?.isConnected)) return;
    const from = attacker.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const route = this.playAttackRoute(attacker, target);
    attacker.style.zIndex = '60';
    const lunge = attacker.animate(
      [
        { transform: 'translate(0, 0) scale(1)' },
        { transform: `translate(${dx * 0.82}px, ${dy * 0.82}px) scale(1.16)`, offset: 0.58 },
        { transform: `translate(${dx}px, ${dy}px) scale(.92)`, offset: 0.72 },
        { transform: 'translate(0, 0) scale(1)' },
      ],
      { duration: 720, easing: 'cubic-bezier(.2,.8,.2,1)' }
    );
    window.setTimeout(() => {
      const liveTarget = this.resolveCombatTarget(targetMinionId, targetPlayer) ?? target;
      liveTarget.animate(
        [
          { transform: 'translateX(0)', filter: 'brightness(1)' },
          { transform: 'translateX(-8px)', filter: 'brightness(2) saturate(1.8)' },
          { transform: 'translateX(8px)', filter: 'brightness(.65)' },
          { transform: 'translateX(0)', filter: 'brightness(1)' },
        ],
        { duration: 330, easing: 'ease-out' }
      );
      const hit = document.createElement('strong');
      hit.className = 'combat-damage-pop';
      hit.textContent = damage > 0 ? `-${damage}` : '命中';
      liveTarget.appendChild(hit);
      window.setTimeout(() => hit.remove(), 620);
      if (counterDamage > 0) {
        window.setTimeout(() => {
          attacker.animate(
            [
              { filter: 'brightness(1)' },
              { filter: 'brightness(2) saturate(1.8)' },
              { filter: 'brightness(1)' },
            ],
            { duration: 280 }
          );
          const counter = document.createElement('strong');
          counter.className = 'combat-damage-pop';
          counter.textContent = `-${counterDamage}`;
          attacker.appendChild(counter);
          window.setTimeout(() => counter.remove(), 620);
        }, 140);
      }
    }, 430);
    await Promise.all([lunge.finished.catch(() => undefined), route]);
    attacker.style.zIndex = '';
  }

  private resolveCombatTarget(
    targetMinionId: string | undefined,
    targetPlayer: number
  ): HTMLElement | null {
    return targetMinionId
      ? (this.minionButtons.get(targetMinionId) ?? null)
      : this.resolveHeroTarget(targetPlayer);
  }

  private resolveHeroTarget(targetPlayer: number): HTMLElement | null {
    const candidates = combatHeroTargetSelectors(targetPlayer)
      .map((selector) => this.queryRoot.querySelector<HTMLElement>(selector))
      .filter((candidate): candidate is HTMLElement => candidate !== null);
    return (
      candidates.find(
        (candidate) => candidate.isConnected && candidate.getClientRects().length > 0
      ) ??
      candidates[0] ??
      null
    );
  }

  /** 红色攻击提示采用类似地图大圆航线的弧线，并以光点沿路径飞行。 */
  private playAttackRoute(attacker: HTMLElement, target: HTMLElement): Promise<void> {
    const fromRect = attacker.getBoundingClientRect();
    const toRect = target.getBoundingClientRect();
    const from = { x: fromRect.left + fromRect.width / 2, y: fromRect.top + fromRect.height / 2 };
    const to = { x: toRect.left + toRect.width / 2, y: toRect.top + toRect.height / 2 };
    const geometry = attackRouteGeometry(from, to, {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const ns = 'http://www.w3.org/2000/svg';
    const overlay = document.createElementNS(ns, 'svg');
    overlay.classList.add('combat-route-overlay');
    overlay.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    overlay.setAttribute('aria-hidden', 'true');
    const glow = document.createElementNS(ns, 'path');
    glow.setAttribute('d', geometry.path);
    glow.setAttribute('fill', 'none');
    glow.setAttribute('stroke', '#ff2638');
    glow.setAttribute('stroke-width', '9');
    glow.setAttribute('stroke-linecap', 'round');
    glow.setAttribute('opacity', '0.24');
    const route = document.createElementNS(ns, 'path');
    route.setAttribute('d', geometry.path);
    route.setAttribute('fill', 'none');
    route.setAttribute('stroke', '#ff5360');
    route.setAttribute('stroke-width', '3');
    route.setAttribute('stroke-linecap', 'round');
    route.setAttribute('stroke-dasharray', '12 9');
    const tracer = document.createElementNS(ns, 'circle');
    tracer.setAttribute('r', '5');
    tracer.setAttribute('fill', '#fff4d6');
    tracer.setAttribute('stroke', '#ff2638');
    tracer.setAttribute('stroke-width', '3');
    overlay.append(glow, route, tracer);
    document.body.append(overlay);
    const length = route.getTotalLength();
    const startedAt = performance.now();
    const duration = 720;
    return new Promise((resolve) => {
      const step = (now: number): void => {
        const t = Math.min((now - startedAt) / duration, 1);
        const eased = 1 - (1 - t) ** 3;
        const point = route.getPointAtLength(length * eased);
        tracer.setAttribute('cx', point.x.toFixed(1));
        tracer.setAttribute('cy', point.y.toFixed(1));
        route.setAttribute('stroke-dashoffset', String(-t * 42));
        overlay.style.opacity = String(t < 0.8 ? Math.min(1, t * 5) : (1 - t) / 0.2);
        if (t < 1) requestAnimationFrame(step);
        else {
          overlay.remove();
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  private createRow(label: string, side: 'enemy' | 'player'): HTMLDivElement {
    const row = document.createElement('div');
    row.className = `minion-row ${side}`;
    row.setAttribute('aria-label', label);
    return row;
  }

  /** 八人圆桌中每位对手拥有独立随从区，位置由 owner 对应其桌边席位。 */
  private renderEnemyZones(
    minions: MinionState[],
    selectedAttackerId: string | null,
    canAct: boolean,
    spellTargetSide: SpellTargetSide,
    playerCount: number
  ): void {
    const owners = [...new Set(minions.map((minion) => minion.owner))].sort((a, b) => a - b);
    const liveOwners = new Set(owners);
    for (const owner of owners) {
      let row = this.enemyRows.get(owner);
      if (!row) {
        row = this.createRow(`玩家 ${owner} 的随从`, 'enemy');
        const ownerChip = document.createElement('span');
        ownerChip.className = 'minion-owner-chip';
        ownerChip.setAttribute('aria-hidden', 'true');
        row.append(ownerChip);
        this.enemyRows.set(owner, row);
      }
      row.dataset.owner = String(owner);
      row.setAttribute('aria-label', `玩家 ${owner} 的随从`);
      const anchor = this.resolveSeatAnchor(owner, playerCount);
      row.style.setProperty('--minion-x', `${anchor.x.toFixed(1)}px`);
      row.style.setProperty('--minion-y', `${anchor.y.toFixed(1)}px`);
      const ownerMinions = minions.filter((minion) => minion.owner === owner);
      this.renderRow(
        row,
        ownerMinions,
        'enemy',
        selectedAttackerId,
        canAct,
        spellTargetSide,
        ownerMinions.some((minion) => minionHasTaunt(minion))
      );
      const ownerChip = row.querySelector<HTMLElement>(':scope > .minion-owner-chip');
      if (ownerChip) ownerChip.textContent = `玩家 ${owner}`;
      this.enemyLayer.append(row);
    }
    for (const [owner, row] of this.enemyRows) {
      if (liveOwners.has(owner)) continue;
      row.remove();
      this.enemyRows.delete(owner);
    }
  }

  private renderRow(
    row: HTMLDivElement,
    minions: MinionState[],
    side: 'enemy' | 'player',
    selectedAttackerId: string | null,
    canAct: boolean,
    spellTargetSide: SpellTargetSide,
    attackRequiresTaunt = false
  ): void {
    // 正在选择攻击者/法术目标时，抑制详情面板（会遮挡战场）
    const suppressDetails = Boolean(selectedAttackerId) || Boolean(spellTargetSide);
    const ownerChip = row.querySelector<HTMLElement>(':scope > .minion-owner-chip');
    for (const minion of minions) {
      const effect = getEffect(minion.effectId);
      const legalAttackTarget = !attackRequiresTaunt || minionHasTaunt(minion);
      const legalSpellTarget =
        spellTargetSide === 'any' ||
        (spellTargetSide === 'friendly' && side === 'player') ||
        (spellTargetSide === 'enemy' && side === 'enemy');
      let button = this.minionButtons.get(minion.id);
      if (!button) {
        button = this.createMinionButton(minion);
        this.minionButtons.set(minion.id, button);
      }
      button.className = `board-minion ${side}`;
      button.classList.toggle('selected', minion.id === selectedAttackerId);
      button.classList.toggle(
        'legal-target',
        legalSpellTarget || (side === 'enemy' && Boolean(selectedAttackerId) && legalAttackTarget)
      );
      button.classList.toggle('exhausted', minion.exhausted);
      button.classList.toggle('actionable', side === 'player' && canAct && !minion.exhausted);
      button.classList.toggle('taunt', minionHasTaunt(minion));
      const actionable = spellTargetSide
        ? canAct && legalSpellTarget
        : side === 'player'
          ? canAct && !minion.exhausted
          : canAct && selectedAttackerId !== null && legalAttackTarget;
      button.setAttribute('aria-disabled', String(!actionable));
      const name = effect?.name ?? '未知随从';
      const status = minion.exhausted && side === 'player' ? '，休眠中' : '';
      const tauntStatus = minionHasTaunt(minion) ? '，嘲讽' : '';
      button.setAttribute(
        'aria-label',
        `${name}，${minion.attack} 点攻击，${minion.health} 点生命${tauntStatus}${status}`
      );
      button.title =
        side === 'player'
          ? minion.exhausted
            ? '下个己方回合可以攻击'
            : '选择这个随从发起攻击'
          : selectedAttackerId
            ? legalAttackTarget
              ? `攻击 ${name}`
              : '必须先攻击嘲讽随从'
            : '请先选择己方随从';
      this.updateMinionButtonContent(button, minion);
      button.onclick = () => {
        if (!suppressDetails) this.callbacks.onPreviewMinion(minion);
        if (!actionable) {
          if (side === 'enemy' && selectedAttackerId && !legalAttackTarget) {
            this.callbacks.onInvalidAttackTarget();
          }
          return;
        }
        if (spellTargetSide) this.callbacks.onAttackMinion(minion.id);
        else if (side === 'player') this.callbacks.onSelectAttacker(minion.id);
        else this.callbacks.onAttackMinion(minion.id);
      };
      button.onpointerenter = () => this.setHoveredMinion(minion);
      button.onpointerleave = () => this.clearHoveredMinion(minion.id);
      button.onfocus = () => this.setHoveredMinion(minion);
      button.onblur = () => this.clearHoveredMinion(minion.id);
      row.insertBefore(button, ownerChip);
    }
  }

  private setHoveredMinion(minion: MinionState): void {
    this.hoveredMinionId = minion.id;
    this.callbacks.onHoverMinion(minion);
  }

  private clearHoveredMinion(expectedId?: string): void {
    if (expectedId && this.hoveredMinionId !== expectedId) return;
    if (this.hoveredMinionId === null) return;
    this.hoveredMinionId = null;
    this.callbacks.onHoverMinion(null);
  }

  private createMinionButton(minion: MinionState): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.minionId = minion.id;
    const art = document.createElement('span');
    art.className = 'minion-art';
    art.setAttribute('aria-hidden', 'true');
    const image = new Image();
    image.alt = '';
    image.decoding = 'async';
    art.append(image);
    const taunt = document.createElement('span');
    taunt.className = 'minion-taunt';
    taunt.setAttribute('aria-hidden', 'true');
    const attack = document.createElement('span');
    attack.className = 'minion-stat attack';
    const health = document.createElement('span');
    health.className = 'minion-stat health';
    button.append(art, taunt, attack, health);
    return button;
  }

  /** 只更新发生变化的内容；图片节点与攻击动画目标在整场对局中保持稳定。 */
  private updateMinionButtonContent(button: HTMLButtonElement, minion: MinionState): void {
    const image = button.querySelector<HTMLImageElement>('.minion-art img');
    if (image && image.dataset.effectId !== minion.effectId) {
      image.dataset.effectId = minion.effectId;
      image.src = assetUrl(`/assets/images/hearth/${encodeURIComponent(minion.effectId)}.webp`);
    }
    const taunt = button.querySelector<HTMLElement>('.minion-taunt');
    if (taunt) taunt.hidden = !minionHasTaunt(minion);
    const attack = button.querySelector<HTMLElement>('.minion-stat.attack');
    if (attack) {
      attack.textContent = String(minion.attack);
      attack.setAttribute('aria-label', `攻击力 ${minion.attack}`);
    }
    const health = button.querySelector<HTMLElement>('.minion-stat.health');
    if (health) {
      health.textContent = String(minion.health);
      health.setAttribute('aria-label', `生命值 ${minion.health}`);
    }
  }

  private playerMinionButtons(): HTMLButtonElement[] {
    return [...this.playerRow.children].filter(
      (child): child is HTMLButtonElement =>
        child instanceof HTMLButtonElement && child.classList.contains('board-minion')
    );
  }

  private animatePlacementShift(previousRects: Map<HTMLButtonElement, DOMRect>): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const [button, previous] of previousRects) {
      const next = button.getBoundingClientRect();
      const deltaX = previous.left - next.left;
      if (Math.abs(deltaX) < 1) continue;
      button.animate([{ transform: `translateX(${deltaX}px)` }, { transform: 'translateX(0)' }], {
        duration: 150,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      });
    }
  }
}
