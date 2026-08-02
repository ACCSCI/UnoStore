import type { MinionState } from '../../game/core/state';
import { getEffect } from '../../game/hearth/effects/registry';
import { assetUrl } from '../assets/url';

type SpellTargetSide = 'friendly' | 'enemy' | 'any' | null;

interface MinionBoardCallbacks {
  onSelectAttacker: (minionId: string) => void;
  onAttackMinion: (minionId: string) => void;
  onHoverMinion: (minion: MinionState | null) => void;
  onPreviewMinion: (minion: MinionState) => void;
}

/** DOM 战场层：原生按钮负责选择己方随从和攻击目标，状态仍完全来自规则引擎。 */
export class MinionBoardRenderer {
  private readonly root: HTMLDivElement;
  private readonly enemyLayer: HTMLDivElement;
  private readonly playerRow: HTMLDivElement;
  private readonly minionButtons = new Map<string, HTMLButtonElement>();

  constructor(
    host: HTMLElement,
    private readonly callbacks: MinionBoardCallbacks
  ) {
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
    this.callbacks.onHoverMinion(null);
    this.root.dataset.playerCount = String(playerCount);
    this.minionButtons.clear();
    this.renderEnemyZones(enemyBoard, selectedAttackerId, canAct, spellTargetSide, playerCount);
    this.renderRow(
      this.playerRow,
      playerBoard,
      'player',
      selectedAttackerId,
      canAct,
      spellTargetSide
    );
  }

  remove(): void {
    this.callbacks.onHoverMinion(null);
    this.root.remove();
  }

  /** 真实随从头像前冲、目标受击和伤害跳字；不使用无语义的几何弹体。 */
  async playCombatAnimation(
    attackerId: string,
    targetMinionId: string | undefined,
    targetPlayer: number,
    damage: number,
    counterDamage = 0
  ): Promise<void> {
    const attacker = this.minionButtons.get(attackerId);
    if (!attacker) return;
    const target = targetMinionId
      ? this.minionButtons.get(targetMinionId)
      : document.querySelector<HTMLElement>(
          targetPlayer === 1
            ? '.opponent-hero'
            : `.table-seat[data-seat="${targetPlayer}"] .seat-target-button`
        );
    if (!target) return;
    const from = attacker.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
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
      target.animate(
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
      target.appendChild(hit);
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
    await lunge.finished.catch(() => undefined);
    attacker.style.zIndex = '';
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
    this.enemyLayer.replaceChildren();
    const owners = [...new Set(minions.map((minion) => minion.owner))].sort((a, b) => a - b);
    for (const owner of owners) {
      const row = this.createRow(`玩家 ${owner} 的随从`, 'enemy');
      row.dataset.owner = String(owner);
      const angle = Math.PI / 2 + (Math.PI * 2 * owner) / playerCount;
      row.style.setProperty('--minion-x', `${50 + Math.cos(angle) * 22}%`);
      row.style.setProperty('--minion-y', `${50 + Math.sin(angle) * 18}%`);
      const ownerMinions = minions.filter((minion) => minion.owner === owner);
      this.renderRow(
        row,
        ownerMinions,
        'enemy',
        selectedAttackerId,
        canAct,
        spellTargetSide,
        ownerMinions.some((minion) => getEffect(minion.effectId)?.taunt)
      );
      const ownerChip = document.createElement('span');
      ownerChip.className = 'minion-owner-chip';
      ownerChip.textContent = `AI ${owner}`;
      ownerChip.setAttribute('aria-hidden', 'true');
      row.appendChild(ownerChip);
      this.enemyLayer.appendChild(row);
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
    row.replaceChildren();
    for (const minion of minions) {
      const effect = getEffect(minion.effectId);
      const legalAttackTarget = !attackRequiresTaunt || Boolean(effect?.taunt);
      const legalSpellTarget =
        spellTargetSide === 'any' ||
        (spellTargetSide === 'friendly' && side === 'player') ||
        (spellTargetSide === 'enemy' && side === 'enemy');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `board-minion ${side}`;
      this.minionButtons.set(minion.id, button);
      button.classList.toggle('selected', minion.id === selectedAttackerId);
      button.classList.toggle(
        'legal-target',
        legalSpellTarget || (side === 'enemy' && Boolean(selectedAttackerId) && legalAttackTarget)
      );
      button.classList.toggle('exhausted', minion.exhausted);
      button.classList.toggle('actionable', side === 'player' && canAct && !minion.exhausted);
      button.classList.toggle('taunt', Boolean(effect?.taunt));
      const actionable = spellTargetSide
        ? canAct && legalSpellTarget
        : side === 'player'
          ? canAct && !minion.exhausted
          : canAct && selectedAttackerId !== null && legalAttackTarget;
      button.setAttribute('aria-disabled', String(!actionable));
      const name = effect?.name ?? '未知随从';
      const status = minion.exhausted && side === 'player' ? '，休眠中' : '';
      button.setAttribute(
        'aria-label',
        `${name}，${minion.attack} 点攻击，${minion.health} 点生命${status}`
      );
      button.title =
        side === 'player'
          ? minion.exhausted
            ? '下个己方回合可以攻击'
            : '选择这个随从发起攻击'
          : selectedAttackerId
            ? legalAttackTarget
              ? `攻击 ${name}`
              : '必须先攻击该玩家的嘲讽随从'
            : '请先选择己方随从';
      button.innerHTML =
        `<span class="minion-art" aria-hidden="true"><img src="${assetUrl(`/assets/images/hearth/${encodeURIComponent(minion.effectId)}.webp`)}" alt=""></span>` +
        (effect?.taunt ? '<span class="minion-taunt" aria-label="嘲讽">◆</span>' : '') +
        `<span class="minion-stat attack" aria-label="攻击力 ${minion.attack}">${minion.attack}</span>` +
        `<span class="minion-stat health" aria-label="生命值 ${minion.health}">${minion.health}</span>`;
      button.addEventListener('click', () => {
        this.callbacks.onPreviewMinion(minion);
        if (!actionable) return;
        if (spellTargetSide) this.callbacks.onAttackMinion(minion.id);
        else if (side === 'player') this.callbacks.onSelectAttacker(minion.id);
        else this.callbacks.onAttackMinion(minion.id);
      });
      button.addEventListener('pointerenter', () => this.callbacks.onHoverMinion(minion));
      button.addEventListener('pointerleave', () => this.callbacks.onHoverMinion(null));
      button.addEventListener('focus', () => this.callbacks.onHoverMinion(minion));
      button.addEventListener('blur', () => this.callbacks.onHoverMinion(null));
      row.appendChild(button);
    }
  }
}
