import { expect, test } from 'bun:test';

import { createGame, dispatch, playableUnoIndices, Rng } from '../../src/game';
import type { ActionResult, GameEvent } from '../../src/game/core/events';
import type { GameState, HearthCard } from '../../src/game/core/state';
import type { UnoAction, UnoCard, UnoColor, UnoValue } from '../../src/game/uno/types';

/**
 * Phase 1.5 关键路径测试：水晶经济、报牌、Nomercy、罚抽。
 * 规则定稿见 docs/GOALS.md §2。
 */

/** 断言行动成功并返回事件（类型守卫） */
function okEvents(res: ActionResult): GameEvent[] {
  if (!res.ok) throw new Error(`行动应成功：${res.error}`);
  return res.events;
}

/** 构造一个可控对局：指定玩家手牌，便于精确验证规则路径。
 *  默认顶牌为红色（手牌也全是红色 → 必然可打），opts 可覆盖。
 *  只替换玩家 0 的手牌；其他玩家保留 createGame 的 7 张初始牌。 */
function makeState(
  handSets: { color: string; value: string }[][],
  opts: Partial<GameState> = {}
): GameState {
  const n = Math.max(handSets.length, 2);
  const state = createGame(n, ['shield'], 1);
  const hand: UnoCard[] = handSets[0]!.map((c, i) => ({
    id: `t-0-${i}`,
    color: c.color === 'null' ? null : (c.color as UnoColor),
    value: c.value as UnoValue | UnoAction,
  }));
  state.players[0]!.hand = hand;
  if (!opts.topCard) {
    state.topCard = { id: 'top', color: 'red', value: '1' };
    state.chosenColor = 'red';
  }
  Object.assign(state, opts);
  return state;
}

function hearth(cardId: string, effectId: string): HearthCard {
  return { id: cardId, effectId };
}

const rng = new Rng(1);

test('数字牌打出 → 水晶冻结（本回合不可用，下回合解冻叠加）', () => {
  const s = makeState([[{ color: 'red', value: '5' }]], {
    topCard: { id: 'top', color: 'red', value: '1' },
    chosenColor: 'red',
  });
  const res = dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0 });
  expect(res.ok).toBe(true);
  expect(s.players[0]!.frozen).toBe(5);
  expect(s.players[0]!.free).toBe(0); // 冻结，本回合不可用
});

test('冻结水晶跨回合叠加解冻', () => {
  const s = makeState([
    [
      { color: 'red', value: '5' },
      { color: 'red', value: '3' },
    ],
  ]);
  s.players[0]!.frozen = 5;
  // 本回合再打一张 3 → frozen = 8
  dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 1 });
  expect(s.players[0]!.frozen).toBe(8);
  // 结束回合 → 8 全部解冻进 free
  const res = dispatch(s, rng, { type: 'endTurn', player: 0 });
  expect(res.ok).toBe(true);
  expect(s.players[0]!.free).toBe(8);
  expect(s.players[0]!.frozen).toBe(0);
});

test('炉石牌消耗 free 水晶', () => {
  const s = makeState([[{ color: 'red', value: '1' }]]);
  s.players[0]!.free = 3;
  s.players[0]!.hearthHand = [hearth('h0', 'bolt')]; // bolt 费用 1
  const res = dispatch(s, rng, { type: 'playHearth', player: 0, cardIdx: 0, targets: [1] });
  expect(res.ok).toBe(true);
  expect(s.players[0]!.free).toBe(2);
  expect(s.players[1]!.pendingDraw).toBe(2); // bolt 造成 2 罚抽
});

test('水晶不足 → 打炉石牌失败', () => {
  const s = makeState([[{ color: 'red', value: '1' }]]);
  s.players[0]!.free = 0;
  s.players[0]!.hearthHand = [hearth('h0', 'fireball')]; // 费用 3
  const res = dispatch(s, rng, { type: 'playHearth', player: 0, cardIdx: 0 });
  expect(res.ok).toBe(false);
});

test('暂停/反转后本回合仍可打炉石牌（暂停不打断）', () => {
  const s = makeState([
    [
      { color: 'red', value: 'skip' },
      { color: 'red', value: '1' },
    ],
    [],
  ]);
  // 打 skip
  dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0 });
  // 本回合仍能打炉石牌
  s.players[0]!.free = 1;
  s.players[0]!.hearthHand = [hearth('h0', 'bolt')];
  const res = dispatch(s, rng, { type: 'playHearth', player: 0, cardIdx: 0, targets: [1] });
  expect(res.ok).toBe(true);
});

test('Nomercy 全员跳过：跳过≥2人时自己额外行动', () => {
  const s = makeState([
    [
      { color: 'red', value: 'massSkip' },
      { color: 'red', value: '1' },
    ],
    [],
    [],
  ]);
  // 打 massSkip（2 个对手 → 跳过2人 → 额外+1）：applyUnoAction 在扣减前执行 → 1+1-1=1
  dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0, color: 'red' });
  expect(s.unoActionsLeft).toBe(1);
  // 还能再打一张 Uno（选了红 → 红牌可打；splice 后剩余牌左移到 index 0）
  const res = dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0 });
  expect(res.ok).toBe(true);
});

test('Nomercy 2人局出完 → 直接获胜（额外行动不生效）', () => {
  const s = makeState([[{ color: 'red', value: 'massSkip' }], []]);
  dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0 });
  expect(s.phase).toBe('gameOver'); // 出完手牌直接获胜
});

test('自动报牌：手牌到 1 张触发 unoAlert', () => {
  const s = makeState([
    [
      { color: 'red', value: '5' },
      { color: 'red', value: '3' },
    ],
  ]);
  // 打 3 → 剩 1 张 → 自动报牌
  const res = dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 1 });
  expect(res.ok).toBe(true);
  expect(s.players[0]!.unoAlert).toBe(true);
});

test('未报牌出空 → 罚抽 4 并获胜', () => {
  const s = makeState([[{ color: 'red', value: '5' }]]);
  s.players[0]!.unoAlert = false; // 直接打最后一张，未报牌
  const res = dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0 });
  expect(res.ok).toBe(true);
  expect(s.players[0]!.pendingDraw).toBe(4);
  expect(s.phase).toBe('gameOver');
  expect(okEvents(res).some((e) => e.type === 'gameOver')).toBe(true);
});

test('已报牌出空 → 直接获胜不罚', () => {
  const s = makeState([[{ color: 'red', value: '5' }]]);
  s.players[0]!.unoAlert = true;
  const res = dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0 });
  expect(res.ok).toBe(true);
  expect(s.players[0]!.pendingDraw).toBe(0);
  expect(s.phase).toBe('gameOver');
});

test('+2 罚抽在目标回合开始生效并叠加', () => {
  const s = makeState([
    [
      { color: 'red', value: 'draw2' },
      { color: 'red', value: '1' },
    ],
    [],
  ]);
  dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0 });
  expect(s.players[1]!.pendingDraw).toBe(2);
  // 结束回合 → 1 号玩家开始，罚抽 2 张（7 初始 + 2 罚 + 1 回合抽 = 10）
  dispatch(s, rng, { type: 'endTurn', player: 0 });
  expect(s.turn).toBe(1);
  expect(s.players[1]!.hand.length).toBe(10);
});

test('打不出时抽 1 即止，抽后不能打出', () => {
  const s = makeState([[{ color: 'blue', value: '5' }]], {
    topCard: { id: 'top', color: 'red', value: '7' },
    chosenColor: 'red',
  });
  // 无匹配 → 抽 1
  const res = dispatch(s, rng, { type: 'drawUno', player: 0 });
  expect(res.ok).toBe(true);
  expect(s.players[0]!.hand.length).toBe(2);
  // 抽后不能打 Uno
  const res2 = dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 1 });
  expect(res2.ok).toBe(false);
});

test('可出牌时不能抽（drawUno 非法）', () => {
  const s = makeState([[{ color: 'red', value: '5' }]], {
    topCard: { id: 'top', color: 'red', value: '7' },
    chosenColor: 'red',
  });
  const res = dispatch(s, rng, { type: 'drawUno', player: 0 });
  expect(res.ok).toBe(false);
});

test('Wild 选色后成为当前颜色', () => {
  const s = makeState([
    [
      { color: 'null', value: 'wild' },
      { color: 'red', value: '5' },
    ],
  ]);
  dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0, color: 'blue' });
  expect(s.chosenColor).toBe('blue');
  // 蓝色牌现在可打
  const s2 = makeState([
    [
      { color: 'null', value: 'wild' },
      { color: 'blue', value: '5' },
    ],
  ]);
  dispatch(s2, rng, { type: 'playUno', player: 0, cardIdx: 0, color: 'blue' });
  expect(s2.chosenColor).toBe('blue');
});

test('同 seed 对局确定性：两次建局事件流一致', () => {
  const a = createGame(2, ['bolt', 'shield', 'draw2'], 99);
  const b = createGame(2, ['bolt', 'shield', 'draw2'], 99);
  expect(a.players[0]!.hand.map((c) => c.id)).toEqual(b.players[0]!.hand.map((c) => c.id));
  expect(a.unoDraw.map((c) => c.id)).toEqual(b.unoDraw.map((c) => c.id));
});

test('Rng 确定性：同 seed 序列一致', () => {
  const a = new Rng(7);
  const b = new Rng(7);
  for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
});

test('护盾抵消罚抽', () => {
  const s = makeState([[{ color: 'red', value: '1' }], [{ color: 'red', value: '5' }]]);
  s.players[1]!.shield = 1;
  s.players[0]!.hearthHand = [hearth('h0', 'bolt')];
  s.players[0]!.free = 1;
  dispatch(s, rng, { type: 'playHearth', player: 0, cardIdx: 0, targets: [1] });
  expect(s.players[1]!.pendingDraw).toBe(0);
  expect(s.players[1]!.shield).toBe(0);
});

test('playableUnoIndices 只返回可打的牌', () => {
  const s = makeState(
    [
      [
        { color: 'red', value: '5' },
        { color: 'blue', value: '2' },
      ],
    ],
    {
      topCard: { id: 'top', color: 'red', value: '1' },
      chosenColor: 'red',
    }
  );
  expect(playableUnoIndices(s)).toEqual([0]);
});

test('游戏结束后再行动被拒绝', () => {
  const s = makeState([[{ color: 'red', value: '5' }], []]);
  s.players[0]!.unoAlert = true;
  dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0 });
  expect(s.phase).toBe('gameOver');
  const res = dispatch(s, rng, { type: 'endTurn', player: 0 });
  expect(res.ok).toBe(false);
});
