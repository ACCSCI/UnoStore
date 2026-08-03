import { canPlayUnoCard } from '../core/flow';
import { canInitiateHearthPlay, heroPowerError } from '../core/reducer';
import type { Rng } from '../core/rng';
import type { GameAction, GameState } from '../core/state';
import { getEffect, minionHasTaunt, requiredOwnUnoCardCount } from '../hearth/effects/registry';
import type { AiStrategy, BossRules } from './types';

const COLORS = ['red', 'yellow', 'green', 'blue'] as const;

function randomColor(rng: Rng): (typeof COLORS)[number] {
  return COLORS[rng.int(COLORS.length)]!;
}

function playableUno(state: GameState, player: number) {
  return state.players[player]!.hand.map((c, i) => ({ c, i })).filter(({ c }) =>
    canPlayUnoCard(state, player, c)
  );
}

function unoPlayAction(
  state: GameState,
  player: number,
  pick: ReturnType<typeof playableUno>[number],
  rng: Rng
): GameAction {
  const swapTarget =
    pick.c.value === '7'
      ? state.players
          .map((entry, index) => ({ entry, index }))
          .filter(({ entry, index }) => entry.active && index !== player)
          .sort((a, b) => a.entry.hand.length - b.entry.hand.length)[0]?.index
      : undefined;
  return {
    type: 'playUno',
    player,
    cardIdx: pick.i,
    color:
      pick.c.color === null && pick.c.value !== 'wildColorRoulette' ? randomColor(rng) : undefined,
    ...(swapTarget === undefined ? {} : { targetPlayer: swapTarget }),
  };
}

/** 优先使用能额外清掉同色手牌的清场牌，其次用高点数数字牌积累水晶。 */
function strategicUnoPick(
  state: GameState,
  player: number,
  playable: ReturnType<typeof playableUno>
) {
  const hand = state.players[player]!.hand;
  const dump = playable
    .filter(({ c }) => c.value === 'colorDump' && c.color !== null)
    .map((entry) => ({
      ...entry,
      extraDiscard: hand.filter((card) => card.id !== entry.c.id && card.color === entry.c.color)
        .length,
    }))
    .filter((entry) => entry.extraDiscard > 0)
    .sort((a, b) => b.extraDiscard - a.extraDiscard)[0];
  if (dump) return dump;
  return (
    playable
      .filter(({ c }) => c.color !== null && /^\d$/.test(c.value))
      .sort((a, b) => Number(b.c.value) - Number(a.c.value))[0] ?? playable[0]
  );
}

function affordableHearth(state: GameState, player: number) {
  const p = state.players[player]!;
  if (p.pendingDrawMin > 0) return [];
  const largestEnemyHand = Math.max(
    0,
    ...state.players
      .filter((entry, i) => entry.active && i !== player)
      .map((entry) => entry.hand.length)
  );
  const penaltyEffects = new Set(['bolt', 'fireball', 'freeze2', 'manaBlast']);
  return p.hearthHand
    .map((c, i) => ({ c, i, effect: getEffect(c.effectId) }))
    .filter(
      (x) =>
        x.effect &&
        canInitiateHearthPlay(state, player, x.i) &&
        !(x.c.effectId === 'draw2' && p.hand.length <= 2) &&
        !(penaltyEffects.has(x.c.effectId) && largestEnemyHand <= 2) &&
        !(x.c.effectId === 'steal' && largestEnemyHand <= 1)
    )
    .map((x) => ({ c: x.c, i: x.i, cost: x.effect!.cost }));
}

/** 每次决策使用一个就绪随从；优先击杀能换掉的敌方随从，否则直击手牌最少的玩家。 */
function minionAttack(state: GameState, player: number, rng: Rng): GameAction | null {
  if (state.players[player]!.pendingDrawMin > 0) return null;
  const attacker = state.players[player]!.board.find((minion) => !minion.exhausted);
  if (!attacker) return null;
  const enemies = rng.shuffle(
    state.players.map((p, i) => ({ p, i })).filter(({ p, i }) => p.active && i !== player)
  );
  // 嘲讽必须先处理；不能因为其他随从可被击杀而生成非法目标。
  for (const { p, i } of enemies) {
    const taunts = p.board.filter((minion) => minionHasTaunt(minion));
    if (taunts.length > 0) {
      const target = [...taunts].sort(
        (a, b) => Number(b.health <= attacker.attack) - Number(a.health <= attacker.attack)
      )[0]!;
      return {
        type: 'attackMinion',
        player,
        attackerId: attacker.id,
        targetPlayer: i,
        targetMinionId: target.id,
      };
    }
  }
  for (const { p, i } of enemies) {
    const target = [...p.board]
      .filter((minion) => minion.health <= attacker.attack)
      .sort((a, b) => b.attack - a.attack)[0];
    if (target) {
      return {
        type: 'attackMinion',
        player,
        attackerId: attacker.id,
        targetPlayer: i,
        targetMinionId: target.id,
      };
    }
  }
  // 无值得换掉的随从时直击英雄：优先手牌最少的玩家（最接近清空 UNO）。
  enemies.sort(
    (a, b) =>
      a.p.hand.length - b.p.hand.length ||
      b.p.board.reduce((sum, minion) => sum + minion.attack, 0) -
        a.p.board.reduce((sum, minion) => sum + minion.attack, 0)
  );
  const target = enemies[0];
  return target
    ? { type: 'attackMinion', player, attackerId: attacker.id, targetPlayer: target.i }
    : null;
}

/** 简单：随机会出（注入确定性 rng） */
export class EasyRandom implements AiStrategy {
  readonly id = 'easy';
  private rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  decide(state: GameState, player: number): GameAction | null {
    const oracle = oracleAction(state, player, this.rng);
    if (oracle) return oracle;
    if (state.players[player]!.roulettePending)
      return { type: 'resolveRoulette', player, color: randomColor(this.rng) };
    const playable = playableUno(state, player);
    if (playable.length > 0 && state.unoActionsLeft > 0) {
      const pick = playable[this.rng.int(playable.length)]!;
      return unoPlayAction(state, player, pick, this.rng);
    }
    const attack = minionAttack(state, player, this.rng);
    if (attack) return attack;
    if (state.players[player]!.pendingDrawMin > 0) return { type: 'endTurn', player };
    const hero = heroAction(state, player);
    if (hero) return hero;
    return { type: 'endTurn', player };
  }
}

/** 普通：规则优先 + 水晶管理 */
export class NormalHeuristic implements AiStrategy {
  readonly id = 'normal';
  private rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  decide(state: GameState, player: number): GameAction | null {
    const oracle = oracleAction(state, player, this.rng);
    if (oracle) return oracle;
    if (state.players[player]!.roulettePending)
      return { type: 'resolveRoulette', player, color: randomColor(this.rng) };
    const playable = playableUno(state, player);
    if (playable.length > 0 && state.unoActionsLeft > 0) {
      const pick = strategicUnoPick(state, player, playable)!;
      return unoPlayAction(state, player, pick, this.rng);
    }
    const attack = minionAttack(state, player, this.rng);
    if (attack) return attack;
    if (state.players[player]!.pendingDrawMin > 0) return { type: 'endTurn', player };
    const hero = heroAction(state, player);
    if (hero) return hero;
    // 1. 有水晶 → 打最贵的炉石牌（消费优先）
    const affordable = affordableHearth(state, player);
    if (affordable.length > 0) {
      affordable.sort((a, b) => b.cost - a.cost);
      const pick = affordable[0]!;
      return {
        type: 'playHearth',
        player,
        cardIdx: pick.i,
        targets: bestTarget(state, player, pick.c.effectId, this.rng),
        targetMinionId: bestMinionTarget(state, player, pick.c.effectId),
        unoCardIds: selectedUnoCards(state, player, pick.c.effectId),
        cardIds: selectedGiftCards(state, player, pick.c.effectId, pick.c.id),
        color: getEffect(pick.c.effectId)?.requiresColor ? randomColor(this.rng) : undefined,
      };
    }
    // 3. 打不出 → 抽
    return { type: 'endTurn', player };
  }
}

/** 困难：连击规划 + 对手干扰（针对手牌最多的玩家） */
export class HardCombo implements AiStrategy {
  readonly id = 'hard';
  private rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  decide(state: GameState, player: number): GameAction | null {
    const oracle = oracleAction(state, player, this.rng);
    if (oracle) return oracle;
    if (state.players[player]!.roulettePending)
      return { type: 'resolveRoulette', player, color: randomColor(this.rng) };
    const playable = playableUno(state, player);
    if (playable.length > 0 && state.unoActionsLeft > 0) {
      const pick = strategicUnoPick(state, player, playable)!;
      return unoPlayAction(state, player, pick, this.rng);
    }
    const attack = minionAttack(state, player, this.rng);
    if (attack) return attack;
    if (state.players[player]!.pendingDrawMin > 0) return { type: 'endTurn', player };
    const hero = heroAction(state, player);
    if (hero) return hero;
    // 1. 有水晶 → 打炉石：优先 penalize 类（对卡最多的对手），其次最贵
    const affordable = affordableHearth(state, player);
    if (affordable.length > 0) {
      const penaltyUses = state.log.filter(
        (line) =>
          line.startsWith(`玩家 ${player} 打出炉石牌`) &&
          (line.includes('火球术') || line.includes('闪电箭') || line.includes('法力风暴'))
      ).length;
      const available =
        penaltyUses >= 2
          ? affordable.filter((x) => !['fireball', 'bolt', 'manaBlast'].includes(x.c.effectId))
          : affordable;
      const penalizing = available.filter(
        (x) => x.c.effectId === 'fireball' || x.c.effectId === 'bolt'
      );
      const pool = penalizing.length > 0 ? penalizing : available;
      if (pool.length === 0) return decideUnoOrEnd(state, player, this.rng);
      pool.sort((a, b) => b.cost - a.cost);
      const pick = pool[0]!;
      return {
        type: 'playHearth',
        player,
        cardIdx: pick.i,
        targets: bestTarget(state, player, pick.c.effectId, this.rng),
        targetMinionId: bestMinionTarget(state, player, pick.c.effectId),
        unoCardIds: selectedUnoCards(state, player, pick.c.effectId),
        cardIds: selectedGiftCards(state, player, pick.c.effectId, pick.c.id),
        color: getEffect(pick.c.effectId)?.requiresColor ? randomColor(this.rng) : undefined,
      };
    }
    // 3. 打不出 → 抽
    return { type: 'endTurn', player };
  }
}

function heroAction(state: GameState, player: number): GameAction | null {
  const source = state.players[player]!;
  const targets =
    source.heroId === 'inspector'
      ? [
          player,
          state.players
            .map((entry, index) => ({ entry, index }))
            .filter(({ entry, index }) => entry.active && index !== player)
            .sort((a, b) => b.entry.hand.length - a.entry.hand.length)[0]?.index ?? -1,
        ]
      : [];
  const unoCardIds =
    source.heroId === 'cardMaster' ? source.hand.slice(0, 1).map((card) => card.id) : [];
  if (heroPowerError(state, player, targets, unoCardIds)) return null;
  return {
    type: 'useHeroPower',
    player,
    ...(targets.length ? { targets } : {}),
    ...(unoCardIds.length ? { unoCardIds } : {}),
  };
}

function decideUnoOrEnd(state: GameState, player: number, rng: Rng): GameAction {
  const playable = playableUno(state, player);
  if (playable.length > 0 && state.unoActionsLeft > 0) {
    const pick = strategicUnoPick(state, player, playable)!;
    return unoPlayAction(state, player, pick, rng);
  }
  return { type: 'endTurn', player };
}

/** 只按公开威胁与随机破局选目标，玩家 0 没有任何特殊权重。 */
function bestTarget(
  state: GameState,
  player: number,
  effectId: string | undefined,
  rng: Rng
): number[] {
  const targeting = effectId ? getEffect(effectId)?.targeting : null;
  if (targeting?.type === 'players') {
    return rng
      .shuffle(
        state.players
          .map((entry, i) => ({ entry, i }))
          .filter(
            ({ entry, i }) =>
              entry.active &&
              (targeting.includeSelf || i !== player) &&
              (!targeting.requireMinions || entry.board.length > 0)
          )
      )
      .slice(0, targeting.count)
      .map(({ i }) => i);
  }
  const others = rng
    .shuffle(
      state.players.map((p, i) => ({
        i,
        threat:
          (10 - Math.min(10, p.hand.length)) * 3 + p.board.reduce((sum, m) => sum + m.attack, 0),
      }))
    )
    .filter((x) => x.i !== player && state.players[x.i]!.active);
  if (others.length === 0) return [];
  others.sort((a, b) => b.threat - a.threat);
  return [others[0]!.i];
}

function oracleAction(state: GameState, player: number, rng: Rng): GameAction | null {
  const pending = state.oraclePending;
  if (!pending || pending.source !== player || pending.cardIds.length < 2) return null;
  const shuffled = rng.shuffle(pending.cardIds);
  return {
    type: 'resolveOracle',
    player,
    takeCardId: shuffled[0]!,
    discardCardId: shuffled[1]!,
  };
}

function selectedUnoCards(
  state: GameState,
  player: number,
  effectId: string
): string[] | undefined {
  const effect = getEffect(effectId);
  if (effect?.targeting?.type !== 'ownUnoCards') return undefined;
  const required = requiredOwnUnoCardCount(effect.targeting, state.players[player]!.hand.length);
  if (required === 0) return undefined;
  return [...state.players[player]!.hand]
    .sort((a, b) => {
      const aNumber = /^\d$/.test(a.value) ? Number(a.value) : 20;
      const bNumber = /^\d$/.test(b.value) ? Number(b.value) : 20;
      return aNumber - bNumber;
    })
    .slice(0, required)
    .map((card) => card.id);
}

function selectedGiftCards(
  state: GameState,
  player: number,
  effectId: string,
  sourceCardId: string
): string[] | undefined {
  const effect = getEffect(effectId);
  if (effect?.targeting?.type !== 'giveCards') return undefined;
  const source = state.players[player]!;
  return [
    ...source.hand.map((card) => ({ id: card.id, priority: /^\d$/.test(card.value) ? 0 : 2 })),
    ...source.hearthHand
      .filter((card) => card.id !== sourceCardId)
      .map((card) => ({ id: card.id, priority: getEffect(card.effectId)?.cost ?? 1 })),
  ]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, effect.targeting.count)
    .map((card) => card.id);
}

function bestMinionTarget(state: GameState, player: number, effectId: string): string | undefined {
  const targeting = getEffect(effectId)?.targeting;
  if (targeting?.type !== 'minion') return undefined;
  const candidates = state.players
    .flatMap((entry, owner) =>
      entry.board.map((minion) => ({ minion, owner, score: minion.attack + minion.health }))
    )
    .filter(
      ({ owner }) =>
        targeting.side === 'any' ||
        (targeting.side === 'friendly' && owner === player) ||
        (targeting.side === 'enemy' && owner !== player)
    );
  const enemies = candidates.filter(({ owner }) => owner !== player);
  return (enemies.length > 0 ? enemies : candidates).sort((a, b) => b.score - a.score)[0]?.minion
    .id;
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
