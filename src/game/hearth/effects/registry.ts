import type { Rng } from '../../core/rng';
import type { GameState } from '../../core/state';

/**
 * 效果上下文：effect 执行时携带的信息。
 * 所有 effect 都是纯函数 —— 只通过 ctx.state 读写，不产生副作用。
 */
export interface EffectCtx {
  state: GameState;
  /** 打出这张牌的玩家 */
  source: number;
  /** 目标玩家（效果需要指定目标时，由 UI/AI 选择后传入） */
  targets?: number[];
  /** 需要选色时（wild 类），由 UI/AI 提供 */
  color?: string | null;
  /** 效果可用的随机源（确定性） */
  rng: Rng;
}

/** 炉石效果定义（注册表条目） */
export interface HearthEffect {
  id: string;
  name: string;
  cost: number;
  description: string;
  /** 是否必须选择目标玩家 */
  requiresTarget?: boolean;
  /** 是否必须选色 */
  requiresColor?: boolean;
  apply: (ctx: EffectCtx) => void;
}

/** 炉石卡牌（卡池中的实例，不含随机变数） */
export interface HearthCard {
  id: string;
  effectId: string;
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
