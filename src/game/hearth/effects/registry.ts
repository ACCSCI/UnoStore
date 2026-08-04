import type { GameEvent } from '../../core/events';
import type { Rng } from '../../core/rng';
import type { GameState, MinionState } from '../../core/state';

export type HearthTargeting =
  | { type: 'enemyPlayer'; count: 1 }
  | {
      type: 'players';
      count: 2;
      includeSelf: boolean;
      requireMinions?: boolean;
    }
  | { type: 'ownUnoCards'; count: number }
  | { type: 'giveCards'; count: number }
  | { type: 'minion'; count: 1; side: 'friendly' | 'enemy' | 'any' };

/** 只有可选 UNO 多于牌面数量时才需手动选择；否则规则层自动使用全部。 */
export function requiredOwnUnoCardCount(
  targeting: Extract<HearthTargeting, { type: 'ownUnoCards' }>,
  available: number
): number {
  return available <= targeting.count ? 0 : targeting.count;
}

/** 只有可选混合手牌多于牌面数量时才需手动选择。 */
export function requiredGiveCardCount(
  targeting: Extract<HearthTargeting, { type: 'giveCards' }>,
  available: number
): number {
  return available <= targeting.count ? 0 : targeting.count;
}

export type HearthKeywordId =
  | 'charge'
  | 'taunt'
  | 'battlecry'
  | 'deathrattle'
  | 'penaltyProxy'
  | 'boardClear';

export const HEARTH_KEYWORDS: Record<HearthKeywordId, { name: string; description: string }> = {
  charge: { name: '冲锋', description: '该随从从手牌召唤后，在本回合即可立即攻击。' },
  taunt: {
    name: '嘲讽',
    description: '敌人必须先攻击该玩家的嘲讽随从，才能攻击其其他随从或英雄。',
  },
  battlecry: { name: '战吼', description: '从手牌放置该随从时立即触发。' },
  deathrattle: { name: '亡语', description: '该随从死亡时触发。' },
  penaltyProxy: {
    name: '代罚',
    description: '你的英雄将要结算一整次罚抽时，由该随从承受等量伤害；过量伤害不会回到英雄。',
  },
  boardClear: {
    name: '清场',
    description: '会同时伤害或消灭多个场上随从；除非卡面另有说明，也会影响己方。',
  },
};

/** 可复用的清场属性：由规则层统一处理伤害、死亡、亡语和副作用。 */
export interface BoardClearEffect {
  mode: 'damage' | 'destroy';
  damage?: number;
  scope: 'all' | 'allOther';
  condition?: 'noOtherFriendlyMinions';
  selfUnoDrawback?: number;
}

/** 可复用的群体发牌属性：从公共 UNO 牌库向所有仍在场的敌方英雄发牌。 */
export interface MassUnoDealEffect {
  trigger: 'turnStart' | 'turnEnd' | 'anyTurnStart';
  countPerTarget: number;
}

/**
 * 效果上下文：effect 执行时携带的信息。
 * 所有 effect 都是纯函数 —— 只通过 ctx.state 读写，不产生副作用。
 */
export interface EffectCtx {
  state: GameState;
  /** 打出这张牌的玩家 */
  source: number;
  /** 当前正在结算的随从在其拥有者战场上的槽位索引（放置位置系统）；无随从时为 -1。 */
  sourceIndex: () => number;
  /** 目标玩家（效果需要指定目标时，由 UI/AI 选择后传入） */
  targets?: number[];
  /** 需要选色时（wild 类），由 UI/AI 提供 */
  color?: string | null;
  /** 由玩家显式选中的己方 UNO 手牌。 */
  unoCardIds?: string[];
  /** 由玩家显式选中的己方混合手牌（UNO 或炉石）。 */
  cardIds?: string[];
  /** 需要指定场上随从时，由 UI/AI 传入实例 id。 */
  targetMinionId?: string;
  /** 当前正在结算的随从实例；战吼/亡语使用。 */
  sourceMinionId?: string;
  /** 效果产生的公开事件，供界面演出与联机重放消费。 */
  events: GameEvent[];
  /** 效果可用的随机源（确定性） */
  rng: Rng;
  /** 统一强制抽牌入口；会结算护盾、罚抽替代随从、淘汰与公开事件。 */
  forceUnoDraw: (player: number, count: number, reason: string, groupEffectId?: string) => number;
}

/**
 * 随从是否具备嘲讽：卡面自带（effect.taunt）或效果赋予（minion.taunt）。
 * 规则引擎与 UI 统一走这里，避免遗漏效果赋予的嘲讽。
 */
export function minionHasTaunt(minion: MinionState): boolean {
  return Boolean(minion.taunt || getEffect(minion.effectId)?.taunt);
}

/** 炉石效果定义（注册表条目） */
export interface HearthEffect {
  id: string;
  name: string;
  cost: number;
  description: string;
  kind?: 'spell' | 'minion';
  attack?: number;
  health?: number;
  /** 炉石式显式选目标协议；不满足时规则层拒绝出牌。 */
  targeting?: HearthTargeting;
  /** 是否必须选择目标玩家 */
  requiresTarget?: boolean;
  /** 是否必须选色 */
  requiresColor?: boolean;
  /** 随从死亡并移入墓地后结算。 */
  deathrattle?: (ctx: EffectCtx) => void;
  /** 显式战吼属性；无须选目标的战吼也能进入统一事件与关键词体系。 */
  battlecry?: boolean;
  /** 同时作用于多个随从的声明式清场效果。 */
  boardClear?: BoardClearEffect;
  /** 同时向所有仍在场敌方英雄发 UNO 牌的声明式持续效果。 */
  massUnoDeal?: MassUnoDealEffect;
  /** 该随从在拥有者回合开始/结束，或任意玩家回合开始时结算的持续效果。 */
  onTurnStart?: (ctx: EffectCtx) => void;
  onTurnEnd?: (ctx: EffectCtx) => void;
  onAnyTurnStart?: (ctx: EffectCtx) => void;
  /** 拥有者受到强制罚抽时，由该随从承受等量伤害并吞掉全部罚抽。 */
  absorbsPenalty?: boolean;
  /** 攻击不造成伤害，改为拥有者随机弃掉等同攻击力的 UNO 牌。 */
  discardsInsteadOfDamage?: boolean;
  /** 每次攻击时，拥有者弃掉所有点数严格小于该随从攻击前当前生命值的 UNO 数字牌。 */
  discardsNumbersBelowHealthOnAttack?: boolean;
  /** 嘲讽在场时，敌方随从不能攻击其非嘲讽随从或英雄。 */
  taunt?: boolean;
  /** 通用冲锋属性：任意带有该属性的随从从手牌召唤后当回合即可攻击。 */
  charge?: boolean;
  /** 该随从在场时降低英雄技能费用。 */
  heroPowerCostReduction?: number;
  /** 该随从在场时解除英雄技能每回合一次的限制。 */
  unlimitedHeroPower?: boolean;
  apply: (ctx: EffectCtx) => void;
}

/** 炉石卡牌（卡池中的实例，不含随机变数） */
export interface HearthCard {
  id: string;
  effectId: string;
  costOverride?: number;
}

/** 单张炉石牌实例的实际费用。 */
export function hearthCardCost(card: Pick<HearthCard, 'effectId' | 'costOverride'>): number {
  return card.costOverride ?? getEffect(card.effectId)?.cost ?? 0;
}

/** 预设牌组：炉石牌组由 effectId 列表构成 */
export interface HearthDeck {
  id: string;
  name: string;
  description: string;
  cardIds: string[];
}

/** 注册表：新增效果 = 调用 registerEffect，零改动核心状态机 */
const registry = new Map<string, HearthEffect>();

export function registerEffect(effect: HearthEffect): void {
  registry.set(effect.id, effect);
}

export function getEffect(id: string): HearthEffect | null {
  return registry.get(id) ?? null;
}

export function allEffects(): HearthEffect[] {
  return [...registry.values()];
}

/** 从效果定义推导可复用的炉石关键词，渲染层不再硬编码单张牌说明。 */
export function effectKeywords(effect: HearthEffect | null): HearthKeywordId[] {
  if (!effect) return [];
  const keywords: HearthKeywordId[] = [];
  if (effect.charge) keywords.push('charge');
  if (effect.taunt) keywords.push('taunt');
  if (
    effect.kind === 'minion' &&
    (effect.battlecry || effect.targeting || effect.requiresColor || effect.boardClear)
  ) {
    keywords.push('battlecry');
  }
  if (effect.deathrattle) keywords.push('deathrattle');
  if (effect.absorbsPenalty) keywords.push('penaltyProxy');
  if (effect.boardClear) keywords.push('boardClear');
  return keywords;
}
