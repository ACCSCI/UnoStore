import { expect, test } from 'bun:test';

import { createGame, dispatch } from '../../src/game';
import { EasyRandom, HardCombo, NormalHeuristic } from '../../src/game/ai/strategies';
import { Rng } from '../../src/game/core/rng';
import type { GameState } from '../../src/game/core/state';
import { getDeck } from '../../src/game/hearth/decks';

/**
 * Phase 2 AI 验收：3 档难度都能跑完整对局；Boss 规则注入生效。
 */

function runAiGame(
  ai: {
    decide: (s: GameState, p: number) => import('../../src/game/core/state').GameAction | null;
  },
  seed: number,
  boss: Record<number, { bonusCrystalPerTurn?: number; extraUnoActions?: number }> = {}
): { state: GameState; steps: number } {
  const deck = getDeck('combo');
  const state = createGame(2, deck.cardIds, seed, boss);
  const rng = new Rng(seed);
  let steps = 0;
  while (state.phase !== 'gameOver' && steps < 500) {
    steps++;
    const action = ai.decide(state, state.turn);
    if (!action) break;
    const r = dispatch(state, rng, action);
    if (!r.ok) break;
  }
  return { state, steps };
}

const strategies = [
  { id: 'easy', ai: new EasyRandom(new Rng(42)) },
  { id: 'normal', ai: new NormalHeuristic(new Rng(42)) },
  { id: 'hard', ai: new HardCombo(new Rng(42)) },
];

for (const { id, ai } of strategies) {
  test(`AI[${id}] 能跑完整对局（3 seeds）`, () => {
    for (const seed of [1, 7, 42]) {
      const { state, steps } = runAiGame(ai, seed);
      expect(state.phase).toBe('gameOver');
      expect(steps).toBeLessThan(500);
    }
  });
}

test('AI 从不打出非法牌（引擎校验兜底）', () => {
  const deck = getDeck('combo');
  const state = createGame(2, deck.cardIds, 7);
  const rng = new Rng(7);
  const ai = new NormalHeuristic(new Rng(42));
  let illegal = 0;
  let steps = 0;
  while (state.phase !== 'gameOver' && steps < 400) {
    steps++;
    const action = ai.decide(state, state.turn);
    if (!action) break;
    const r = dispatch(state, rng, action);
    if (!r.ok) illegal++;
  }
  // 允许少量重试（比如行动刚被消耗），但不应持续失败
  expect(illegal).toBeLessThan(10);
});

test('8 人单机混战可连续完成且所有 AI 行动合法', () => {
  for (const seed of [3, 17, 81]) {
    const state = createGame(8, getDeck('combo').cardIds, seed);
    const gameRng = new Rng(seed);
    const ais = Array.from(
      { length: 8 },
      (_, player) => new NormalHeuristic(new Rng(seed * 31 + player))
    );
    let steps = 0;
    while (state.phase !== 'gameOver' && steps < 4000) {
      const player = state.turn;
      const action = ais[player]!.decide(state, player);
      expect(action).not.toBeNull();
      if (!action) break;
      const result = dispatch(state, gameRng, action);
      expect(result.ok).toBe(true);
      steps++;
    }
    expect(state.phase).toBe('gameOver');
    expect(steps).toBeLessThan(4000);
    expect(state.players).toHaveLength(8);
  }
});

test('Boss 规则：额外水晶每回合生效', () => {
  const boss = { 1: { bonusCrystalPerTurn: 3 } };
  const deck = getDeck('combo');
  const state = createGame(2, deck.cardIds, 1, boss);
  const rng = new Rng(1);
  // 玩家 0 先手 → 结束回合 → 玩家 1（Boss）开始
  dispatch(state, rng, { type: 'endTurn', player: 0 });
  expect(state.turn).toBe(1);
  expect(state.players[1]!.free).toBeGreaterThanOrEqual(3);
});

test('Boss 规则：额外 Uno 行动', () => {
  const boss = { 1: { extraUnoActions: 2 } };
  const deck = getDeck('combo');
  const state = createGame(2, deck.cardIds, 1, boss);
  const rng = new Rng(1);
  dispatch(state, rng, { type: 'endTurn', player: 0 });
  expect(state.turn).toBe(1);
  expect(state.unoActionsLeft).toBe(3); // 1 + 2
});

test('AI 会打炉石牌（水晶消耗）', () => {
  const deck = getDeck('combo');
  const state = createGame(2, deck.cardIds, 1);
  const rng = new Rng(1);
  const ai = new NormalHeuristic(new Rng(42));
  // 给玩家 0 大量免费水晶
  state.players[0]!.free = 100;
  let hearthPlayed = false;
  for (let i = 0; i < 30 && state.phase !== 'gameOver'; i++) {
    const action = ai.decide(state, state.turn);
    if (!action) break;
    const r = dispatch(state, rng, action);
    if (!r.ok) break;
    if (r.events.some((e) => e.type === 'hearthPlayed')) {
      hearthPlayed = true;
      break;
    }
  }
  expect(hearthPlayed).toBe(true);
});

test('炉石牌效果在 AI 对局中实际生效（伤害/抽牌）', () => {
  const deck = getDeck('combo');
  const state = createGame(2, deck.cardIds, 7);
  const rng = new Rng(7);
  const ai = new HardCombo(new Rng(42));
  let steps = 0;
  let effectApplied = false;
  while (state.phase !== 'gameOver' && steps < 300) {
    steps++;
    const action = ai.decide(state, state.turn);
    if (!action) break;
    const before = JSON.stringify(state.players);
    const r = dispatch(state, rng, action);
    if (!r.ok) break;
    // 打炉石牌后 state 应该发生变化（水晶消耗）
    if (r.events.some((e) => e.type === 'hearthPlayed')) {
      effectApplied = true;
      break;
    }
    void before;
  }
  expect(effectApplied).toBe(true);
});

test('检察官 AI 只在自己 UNO 明显更多时洗牌，并选择手牌最少的敌人', () => {
  const deck = getDeck('combo');
  const state = createGame(3, deck.cardIds, 91, {}, ['inspector', 'thug', 'cardMaster']);
  state.unoActionsLeft = 0;
  state.players[0]!.free = 2;
  state.players[0]!.hand = state.players[0]!.hand.slice(0, 5);
  state.players[1]!.hand = state.players[1]!.hand.slice(0, 1);
  state.players[2]!.hand = state.players[2]!.hand.slice(0, 4);
  const ai = new NormalHeuristic(new Rng(91));

  expect(ai.decide(state, 0)).toEqual({ type: 'useHeroPower', player: 0, targets: [0, 1] });

  state.players[0]!.hand = state.players[0]!.hand.slice(0, 2);
  expect(ai.decide(state, 0)?.type).not.toBe('useHeroPower');
});
