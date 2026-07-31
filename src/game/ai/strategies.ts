import type { GameAction, GameState } from '../core/state';
import { getEffect } from '../hearth/effects/registry';
import { canPlayOn } from '../uno/deck';
import type { AiStrategy, BossRules } from './types';

const COLORS = ['red', 'yellow', 'green', 'blue'] as const;

function randomColor(): (typeof COLORS)[number] {
  return COLORS[Math.floor(Math.random() * COLORS.length)]!;
}

function playableUno(state: GameState, player: number) {
  return state.players[player]!.hand.map((c, i) => ({ c, i })).filter(({ c }) =>
    canPlayOn(c, state.topCard, state.chosenColor)
  );
}

function affordableHearth(state: GameState, player: number) {
  const p = state.players[player]!;
  return p.hearthHand
    .map((c, i) => ({ c, i, cost: getEffect(c.effectId)?.cost ?? 99 }))
    .filter((x) => x.cost <= p.free);
}

/** 简单：随机会出 */
export class EasyRandom implements AiStrategy {
  readonly id = 'easy';

  decide(state: GameState, player: number): GameAction | null {
    const playable = playableUno(state, player);
    if (playable.length > 0 && state.unoActionsLeft > 0) {
      const pick = playable[Math.floor(Math.random() * playable.length)]!;
      return {
        type: 'playUno',
        player,
        cardIdx: pick.i,
        color: pick.c.color === null ? randomColor() : undefined,
      };
    }
    if (state.unoActionsLeft > 0) return { type: 'drawUno', player };
    return { type: 'endTurn', player };
  }
}

/** 普通：规则优先 + 水晶管理 */
export class NormalHeuristic implements AiStrategy {
  readonly id = 'normal';

  decide(state: GameState, player: number): GameAction | null {
    // 1. 有水晶 → 打最贵的炉石牌（消费优先）
    const affordable = affordableHearth(state, player);
    if (affordable.length > 0) {
      affordable.sort((a, b) => b.cost - a.cost);
      const pick = affordable[0]!;
      return {
        type: 'playHearth',
        player,
        cardIdx: pick.i,
        targets: bestTarget(state, player, pick.c.effectId),
      };
    }
    // 2. 打 Uno 数字牌产水晶（优先大点数）
    const playable = playableUno(state, player);
    if (playable.length > 0 && state.unoActionsLeft > 0) {
      const numeric = playable
        .filter(({ c }) => c.color !== null && /^\d$/.test(c.value))
        .sort((a, b) => Number(b.c.value) - Number(a.c.value));
      const pick = numeric[0] ?? playable[0]!;
      return {
        type: 'playUno',
        player,
        cardIdx: pick.i,
        color: pick.c.color === null ? randomColor() : undefined,
      };
    }
    // 3. 打不出 → 抽
    if (state.unoActionsLeft > 0) return { type: 'drawUno', player };
    return { type: 'endTurn', player };
  }
}

/** 困难：连击规划 + 对手干扰（针对手牌最多的玩家） */
export class HardCombo implements AiStrategy {
  readonly id = 'hard';

  decide(state: GameState, player: number): GameAction | null {
    // 1. 有水晶 → 打炉石：优先 penalize 类（对卡最多的对手），其次最贵
    const affordable = affordableHearth(state, player);
    if (affordable.length > 0) {
      const targets = bestTarget(state, player, undefined);
      const penalizing = affordable.filter(
        (x) => x.c.effectId === 'fireball' || x.c.effectId === 'bolt'
      );
      const pool = penalizing.length > 0 ? penalizing : affordable;
      pool.sort((a, b) => b.cost - a.cost);
      const pick = pool[0]!;
      return {
        type: 'playHearth',
        player,
        cardIdx: pick.i,
        targets,
      };
    }
    // 2. 打 Uno：优先数字（产水晶），其次功能（skip/+2 控制节奏）
    const playable = playableUno(state, player);
    if (playable.length > 0 && state.unoActionsLeft > 0) {
      const numeric = playable
        .filter(({ c }) => c.color !== null && /^\d$/.test(c.value))
        .sort((a, b) => Number(b.c.value) - Number(a.c.value));
      const pick = numeric[0] ?? playable[0]!;
      return {
        type: 'playUno',
        player,
        cardIdx: pick.i,
        color: pick.c.color === null ? randomColor() : undefined,
      };
    }
    // 3. 打不出 → 抽
    if (state.unoActionsLeft > 0) return { type: 'drawUno', player };
    return { type: 'endTurn', player };
  }
}

/** 选最佳目标：手牌最多者（惩罚收益最大） */
function bestTarget(state: GameState, player: number, _effectId: string | undefined): number[] {
  const others = state.players
    .map((p, i) => ({ i, hand: p.hand.length }))
    .filter((x) => x.i !== player && state.players[x.i]!.active);
  if (others.length === 0) return [];
  others.sort((a, b) => b.hand - a.hand);
  return [others[0]!.i];
}

export type { AiStrategy, BossRules } from './types';

/** 组合 Boss 规则：给基础 AI 注入特殊规则 */
export function withBossRules(base: AiStrategy, boss: BossRules | null): AiStrategy {
  if (!boss) return base;
  return {
    id: `${base.id}-${boss.id}`,
    decide(state, player) {
      // Boss 特殊规则的额外行动由状态机在 startTurn 注入（见 reducer bossRules 参数）
      return base.decide(state, player);
    },
  };
}
