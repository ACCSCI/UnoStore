import { expect, test } from 'bun:test';

import {
  canInitiateHearthPlay,
  createGame,
  dispatch,
  getHero,
  heroPowerCost,
  playableUnoIndices,
  Rng,
} from '../../src/game';
import type { ActionResult, GameEvent } from '../../src/game/core/events';
import { playerCapabilities } from '../../src/game/core/reducer';
import type { GameState, HearthCard, MinionState } from '../../src/game/core/state';
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
 *  只替换玩家 0 的手牌；其他玩家保留 createGame 的 5 张初始牌。 */
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

function minion(id: string, owner: number): MinionState {
  return {
    id,
    cardId: `card-${id}`,
    effectId: 'clockworkSquire',
    owner,
    attack: 3,
    health: 4,
    maxHealth: 4,
    exhausted: false,
  };
}

const rng = new Rng(1);

test('对局人数只接受 2–8 人', () => {
  for (let count = 2; count <= 8; count++)
    expect(createGame(count, ['shield'], count)).toBeTruthy();
  expect(() => createGame(1, ['shield'], 1)).toThrow('玩家人数必须为 2–8 人');
  expect(() => createGame(9, ['shield'], 9)).toThrow('玩家人数必须为 2–8 人');
});

test('开局每人 5 张 UNO + 3 张炉石，结束回合按是否出过 UNO 补牌', () => {
  const s = createGame(2, ['shield'], 2026);
  expect(s.players.every((player) => player.hand.length === 5)).toBe(true);
  expect(s.players.every((player) => player.hearthHand.length === 3)).toBe(true);
  okEvents(dispatch(s, new Rng(2027), { type: 'endTurn', player: 0 }));
  expect(s.players[0]!.hand).toHaveLength(6);
  expect(s.players[0]!.hearthHand).toHaveLength(4);
});

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

test('同色清场会弃掉全部同色 UNO、累计数字冻结水晶，且不触发被弃牌效果', () => {
  const s = makeState([
    [
      { color: 'red', value: 'colorDump' },
      { color: 'red', value: '9' },
      { color: 'red', value: 'draw2' },
      { color: 'blue', value: '4' },
    ],
  ]);
  const events = okEvents(dispatch(s, new Rng(20), { type: 'playUno', player: 0, cardIdx: 0 }));
  expect(s.players[0]!.hand.map((card) => `${card.color}:${card.value}`)).toEqual(['blue:4']);
  expect(s.players[0]!.frozen).toBe(9);
  expect(s.players[1]!.pendingDraw).toBe(0);
  expect(s.topCard.value).toBe('colorDump');
  expect(s.chosenColor).toBe('red');
  expect(events).toContainEqual({
    type: 'colorDump',
    player: 0,
    color: 'red',
    count: 2,
    cardIds: ['t-0-1', 't-0-2'],
    crystalFrozen: 9,
  });
});

test('同色清场可从多张同色手牌直接清空并获胜', () => {
  const s = makeState([
    [
      { color: 'red', value: 'colorDump' },
      { color: 'red', value: '3' },
      { color: 'red', value: 'skip' },
    ],
  ]);
  const events = okEvents(dispatch(s, new Rng(21), { type: 'playUno', player: 0, cardIdx: 0 }));
  expect(s.players[0]!.hand).toHaveLength(0);
  expect(s.phase).toBe('gameOver');
  expect(events.some((event) => event.type === 'unoCaught')).toBe(false);
});

test('炉石牌消耗 free 水晶', () => {
  const s = makeState([[{ color: 'red', value: '1' }]]);
  s.players[0]!.free = 3;
  s.players[0]!.hearthHand = [hearth('h0', 'bolt')]; // bolt 费用 1
  const res = dispatch(s, rng, { type: 'playHearth', player: 0, cardIdx: 0, targets: [1] });
  expect(res.ok).toBe(true);
  expect(s.players[0]!.free).toBe(2);
  expect(s.players[1]!.pendingDraw).toBe(3); // 强化后的闪电箭造成 3 罚抽
});

test('回声复制全场上一张炉石牌到自己手中，复制牌为 0 费并可正常打出', () => {
  const s = makeState([[{ color: 'red', value: '5' }], []]);
  s.turn = 1;
  s.players[1]!.free = 2;
  s.players[1]!.hearthHand = [hearth('opponent-shield', 'shield')];
  expect(dispatch(s, rng, { type: 'playHearth', player: 1, cardIdx: 0 }).ok).toBe(true);
  expect(s.lastHearthPlayed?.effectId).toBe('shield');

  s.turn = 0;
  s.players[0]!.free = 4;
  s.players[0]!.hearthHand = [hearth('own-echo', 'echo')];
  const echoed = okEvents(dispatch(s, rng, { type: 'playHearth', player: 0, cardIdx: 0 }));
  expect(echoed).toContainEqual({
    type: 'hearthDrawn',
    player: 0,
    cardIds: ['echo-copy-1'],
    reason: '回声',
  });
  expect(s.players[0]!.hearthHand).toEqual([
    { id: 'echo-copy-1', effectId: 'shield', costOverride: 0 },
  ]);
  expect(s.players[0]!.free).toBe(0);

  const copiedPlay = okEvents(dispatch(s, rng, { type: 'playHearth', player: 0, cardIdx: 0 }));
  expect(copiedPlay[0]).toMatchObject({
    type: 'hearthPlayed',
    cardId: 'echo-copy-1',
    effectId: 'shield',
    cost: 0,
  });
  expect(s.players[0]!.free).toBe(0);
  expect(s.players[0]!.shield).toBe(2);
});

test('回声可以复制随从牌，也可以复制另一张回声', () => {
  for (const effectId of ['clockworkSquire', 'echo']) {
    const s = makeState([[{ color: 'red', value: '5' }], []]);
    s.lastHearthPlayed = hearth(`previous-${effectId}`, effectId);
    s.players[0]!.free = 4;
    s.players[0]!.hearthHand = [hearth(`echo-for-${effectId}`, 'echo')];
    expect(dispatch(s, rng, { type: 'playHearth', player: 0, cardIdx: 0 }).ok).toBe(true);
    expect(s.players[0]!.hearthHand).toEqual([{ id: 'echo-copy-1', effectId, costOverride: 0 }]);
  }
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

for (const color of ['red', 'yellow', 'green', 'blue'] as const satisfies readonly UnoColor[]) {
  test(`Nomercy ${color} 全员跳过：当前回合不重复奖励行动，结束后跳过全员并绕回`, () => {
    const s = makeState(
      [
        [
          { color, value: 'massSkip' },
          { color, value: '1' },
        ],
        [],
        [],
      ],
      {
        topCard: { id: `top-${color}`, color, value: '5' },
        chosenColor: color,
      }
    );
    // 打 massSkip 后当前回合的 UNO 行动正常耗尽，不立即再奖励一次行动。
    expect(dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0 }).ok).toBe(true);
    expect(s.unoActionsLeft).toBe(0);
    expect(s.topCard.color).toBe(color);
    expect(s.chosenColor).toBe(color);
    expect(playableUnoIndices(s)).toEqual([]);
    const ended = dispatch(s, rng, { type: 'endTurn', player: 0 });
    expect(ended.ok).toBe(true);
    if (!ended.ok) throw new Error(ended.error);
    expect(ended.events.filter((event) => event.type === 'playerSkipped')).toEqual([
      { type: 'playerSkipped', player: 1 },
      { type: 'playerSkipped', player: 2 },
    ]);
    expect(s.turn).toBe(0);
    expect(s.unoActionsLeft).toBe(1);
  });
}

test('Nomercy 2人局以全员跳过出完 → 直接获胜', () => {
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
  expect(okEvents(res)).toContainEqual({ type: 'gameOver', winner: 0, reason: 'unoEmpty' });
});

test('+2 罚抽会给目标保留叠加应对窗口', () => {
  const s = makeState([
    [
      { color: 'red', value: 'draw2' },
      { color: 'red', value: '1' },
    ],
    [],
  ]);
  dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0 });
  expect(s.players[1]!.pendingDraw).toBe(2);
  expect(s.players[1]!.pendingDrawMin).toBe(2);
  const initialHand = s.players[1]!.hand.length;
  // 结束回合后不立即罚抽，先让目标决定叠加或接受。
  dispatch(s, rng, { type: 'endTurn', player: 0 });
  expect(s.turn).toBe(1);
  expect(s.players[1]!.hand.length).toBe(initialHand);
});

test('加牌允许同值或更大值叠加：+2 → +2 累计 4', () => {
  const s = makeState([
    [
      { color: 'red', value: 'draw2' },
      { color: 'red', value: '1' },
    ],
  ]);
  s.players[1]!.hand = [
    { id: 'p1-d2', color: 'blue', value: 'draw2' },
    { id: 'p1-keep', color: 'green', value: '5' },
  ];
  dispatch(s, new Rng(30), { type: 'playUno', player: 0, cardIdx: 0 });
  dispatch(s, new Rng(30), { type: 'endTurn', player: 0 });
  const result = dispatch(s, new Rng(30), { type: 'playUno', player: 1, cardIdx: 0 });
  expect(result.ok).toBe(true);
  expect(okEvents(result).find((event) => event.type === 'unoPlayed')).toMatchObject({
    card: { id: 'p1-d2', color: 'blue', value: 'draw2' },
    penaltyTarget: 0,
    penaltyTransferred: 2,
    penaltyAdded: 2,
  });
  expect(s.players[1]!.pendingDraw).toBe(0);
  expect(s.players[0]!.pendingDraw).toBe(4);
  expect(s.players[0]!.pendingDrawMin).toBe(2);
});

test('加牌允许 +2 → +4，但禁止 +4 → +2', () => {
  const upward = makeState([
    [
      { color: 'red', value: 'draw2' },
      { color: 'red', value: '1' },
    ],
    [],
    [],
  ]);
  upward.players[1]!.hand = [
    { id: 'p1-d4', color: null, value: 'wildDraw4' },
    { id: 'p1-keep', color: 'green', value: '5' },
  ];
  dispatch(upward, new Rng(31), { type: 'playUno', player: 0, cardIdx: 0 });
  dispatch(upward, new Rng(31), { type: 'endTurn', player: 0 });
  const upResult = dispatch(upward, new Rng(31), {
    type: 'playUno',
    player: 1,
    cardIdx: 0,
    color: 'blue',
  });
  expect(upResult.ok).toBe(true);
  expect(upward.players[2]!.pendingDraw).toBe(6);
  expect(upward.players[2]!.pendingDrawMin).toBe(4);

  const downward = makeState([
    [
      { color: 'null', value: 'wildDraw4' },
      { color: 'red', value: '1' },
    ],
  ]);
  downward.players[1]!.hand = [
    { id: 'p1-d2', color: 'red', value: 'draw2' },
    { id: 'p1-keep', color: 'green', value: '5' },
  ];
  dispatch(downward, new Rng(32), { type: 'playUno', player: 0, cardIdx: 0, color: 'red' });
  dispatch(downward, new Rng(32), { type: 'endTurn', player: 0 });
  const downResult = dispatch(downward, new Rng(32), {
    type: 'playUno',
    player: 1,
    cardIdx: 0,
  });
  expect(downResult.ok).toBe(false);
  expect(downward.players[1]!.pendingDraw).toBe(4);
});

test('无法或不愿叠加时，结束回合抽取累计罚牌并跳到下一位', () => {
  const s = makeState([
    [
      { color: 'red', value: 'draw2' },
      { color: 'red', value: '1' },
    ],
  ]);
  s.players[1]!.hand = [{ id: 'p1-keep', color: 'green', value: '5' }];
  dispatch(s, new Rng(33), { type: 'playUno', player: 0, cardIdx: 0 });
  dispatch(s, new Rng(33), { type: 'endTurn', player: 0 });
  const before = s.players[1]!.hand.length;
  const result = dispatch(s, new Rng(33), { type: 'endTurn', player: 1 });
  expect(result.ok).toBe(true);
  expect(s.players[1]!.hand).toHaveLength(before + 3);
  expect(s.players[1]!.pendingDraw).toBe(0);
  expect(s.players[1]!.pendingDrawMin).toBe(0);
  expect(s.turn).toBe(0);
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

test('UNO 加牌被护盾抵消时，公开事件仍保留真实目标和加牌结果', () => {
  const s = makeState([
    [
      { color: 'red', value: 'draw2' },
      { color: 'red', value: '1' },
    ],
  ]);
  s.players[1]!.shield = 1;
  const events = okEvents(dispatch(s, new Rng(2300), { type: 'playUno', player: 0, cardIdx: 0 }));
  expect(s.players[1]!.pendingDraw).toBe(0);
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'unoPlayed',
      player: 0,
      penaltyTarget: 1,
      penaltyAdded: 2,
      penaltyPrevented: true,
    })
  );
});

test('被抓 UNO 罚抽入账，护盾可当场抵消', () => {
  // 手牌 1 张且从未报 UNO：直接打出即被抓（pendingDraw 入账，不设 minimum）
  const plain = makeState([[{ color: 'red', value: '1' }]]);
  const events = okEvents(dispatch(plain, new Rng(22), { type: 'playUno', player: 0, cardIdx: 0 }));
  expect(plain.players[0]!.pendingDraw).toBe(4);
  expect(events).toContainEqual({ type: 'unoCaught', player: 0, penalty: 4 });
  // 有护盾时当场抵消，不再进入结算
  const shielded = makeState([[{ color: 'red', value: '1' }]]);
  shielded.players[0]!.shield = 1;
  const shieldedEvents = okEvents(
    dispatch(shielded, new Rng(23), { type: 'playUno', player: 0, cardIdx: 0 })
  );
  expect(shielded.players[0]!.pendingDraw).toBe(0);
  expect(shielded.players[0]!.shield).toBe(0);
  expect(shieldedEvents).toContainEqual({ type: 'unoCaught', player: 0, penalty: 4 });
});

test('代罚随从在结算入口拦截炉石法术罚抽', () => {
  const s = makeState([[{ color: 'red', value: '1' }], [{ color: 'red', value: '5' }]]);
  s.players[0]!.free = 1;
  s.players[0]!.hearthHand = [hearth('h0', 'bolt')];
  s.players[1]!.board = [
    {
      id: 'bulwark',
      cardId: 'bulwark-card',
      effectId: 'penaltyBulwark',
      owner: 1,
      attack: 5,
      health: 14,
      maxHealth: 14,
      exhausted: false,
    },
  ];
  dispatch(s, rng, { type: 'playHearth', player: 0, cardIdx: 0, targets: [1] });
  expect(s.players[1]!.pendingDraw).toBe(3); // 法术罚抽先入账（保留响应窗口）
  const before = s.players[1]!.hand.length;
  const events = okEvents(dispatch(s, rng, { type: 'endTurn', player: 0 }));
  expect(s.players[1]!.hand).toHaveLength(before); // 未真正抽牌
  expect(s.players[1]!.board[0]!.health).toBe(11); // 随从承受等量伤害
  expect(events.some((event) => event.type === 'penaltyRedirected')).toBe(true);
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

test('随从召唤后休眠，下个己方回合解锁攻击', () => {
  const s = createGame(2, ['clockworkSquire'], 11);
  s.players[0]!.free = 10;
  s.players[0]!.hearthHand = [hearth('summon-1', 'clockworkSquire')];
  const summon = dispatch(s, new Rng(11), { type: 'playHearth', player: 0, cardIdx: 0 });
  expect(okEvents(summon).some((event) => event.type === 'minionSummoned')).toBe(true);
  expect(s.players[0]!.board[0]).toMatchObject({ attack: 2, health: 3, exhausted: true });

  dispatch(s, new Rng(12), { type: 'endTurn', player: 0 });
  dispatch(s, new Rng(13), { type: 'endTurn', player: 1 });
  expect(s.players[0]!.board[0]!.exhausted).toBe(false);
});

test('余烬战狼拥有冲锋，放置后可以立即攻击', () => {
  const s = createGame(2, ['emberWolf'], 111);
  s.players[0]!.free = 2;
  s.players[0]!.hearthHand = [hearth('charge-wolf', 'emberWolf')];
  okEvents(dispatch(s, new Rng(111), { type: 'playHearth', player: 0, cardIdx: 0 }));
  expect(s.players[0]!.board[0]!.exhausted).toBe(false);
  expect(
    dispatch(s, new Rng(112), {
      type: 'attackMinion',
      player: 0,
      attackerId: 'm-charge-wolf',
      targetPlayer: 1,
    }).ok
  ).toBe(true);
});

test('冲锋是通用属性：雷蹄先锋与流星枪骑召唤当回合都能立即攻击', () => {
  for (const [index, effectId] of ['thunderhoofVanguard', 'meteorLancer'].entries()) {
    const s = createGame(2, [effectId], 108 + index);
    s.players[0]!.free = 10;
    s.players[0]!.hearthHand = [hearth(`charge-${effectId}`, effectId)];
    const beforeUno = s.players[0]!.hand.length;
    okEvents(dispatch(s, new Rng(108 + index), { type: 'playHearth', player: 0, cardIdx: 0 }));
    const minion = s.players[0]!.board[0]!;
    expect(minion.effectId).toBe(effectId);
    expect(minion.exhausted).toBe(false);
    if (effectId === 'meteorLancer') expect(s.players[0]!.hand).toHaveLength(beforeUno + 2);
    const attack = dispatch(s, new Rng(118 + index), {
      type: 'attackMinion',
      player: 0,
      attackerId: minion.id,
      targetPlayer: 1,
    });
    expect(attack.ok).toBe(true);
  }
});

test('虹彩指挥家登场时可重新指定当前 UNO 颜色', () => {
  const s = createGame(2, ['chromaticConductor'], 113);
  s.players[0]!.free = 3;
  s.players[0]!.hearthHand = [hearth('rainbow-1', 'chromaticConductor')];
  const missingColor = dispatch(s, new Rng(113), {
    type: 'playHearth',
    player: 0,
    cardIdx: 0,
  });
  expect(missingColor.ok).toBe(false);
  okEvents(
    dispatch(s, new Rng(113), {
      type: 'playHearth',
      player: 0,
      cardIdx: 0,
      color: 'blue',
    })
  );
  expect(s.chosenColor).toBe('blue');
  expect(s.players[0]!.board[0]).toMatchObject({ attack: 5, health: 5 });
});

test('命运馈赠选择两张混合手牌并交给指定对手', () => {
  const s = createGame(2, ['fatefulGift', 'shield', 'bolt'], 114);
  s.players[0]!.free = 2;
  s.players[0]!.hand = [{ id: 'gift-uno', color: 'red', value: '2' }];
  s.players[0]!.hearthHand = [hearth('gift-spell', 'fatefulGift'), hearth('gift-hearth', 'shield')];
  const beforeUno = s.players[1]!.hand.length;
  const beforeHearth = s.players[1]!.hearthHand.length;
  const events = okEvents(
    dispatch(s, new Rng(114), {
      type: 'playHearth',
      player: 0,
      cardIdx: 0,
      targets: [1],
      cardIds: ['gift-uno', 'gift-hearth'],
    })
  );
  expect(s.players[1]!.hand).toHaveLength(beforeUno + 1);
  expect(s.players[1]!.hearthHand).toHaveLength(beforeHearth + 1);
  expect(s.players[0]!.hand).toHaveLength(0);
  expect(s.players[0]!.hearthHand).toHaveLength(0);
  expect(events.some((event) => event.type === 'cardsGifted')).toBe(true);
});

test('每名玩家最多拥有 5 个场上随从，满场后卡牌从一开始就不可操作', () => {
  const s = createGame(2, ['clockworkSquire'], 15);
  s.players[0]!.free = 20;
  s.players[0]!.hearthHand = Array.from({ length: 6 }, (_, index) =>
    hearth(`summon-limit-${index}`, 'clockworkSquire')
  );
  for (let index = 0; index < 5; index++) {
    expect(canInitiateHearthPlay(s, 0, 0)).toBe(true);
    okEvents(dispatch(s, new Rng(15), { type: 'playHearth', player: 0, cardIdx: 0 }));
  }
  expect(s.players[0]!.board).toHaveLength(5);
  expect(canInitiateHearthPlay(s, 0, 0)).toBe(false);
  const overflow = dispatch(s, new Rng(15), { type: 'playHearth', player: 0, cardIdx: 0 });
  expect(overflow).toEqual({ ok: false, error: '战场已满（最多 5 个随从）' });
});

test('水晶不足的炉石牌不会进入目标选择流程', () => {
  const s = createGame(3, ['bolt'], 16);
  s.players[0]!.hearthHand = [hearth('disabled-target-spell', 'bolt')];
  s.players[0]!.free = 0;
  expect(canInitiateHearthPlay(s, 0, 0)).toBe(false);
  s.players[0]!.free = 10;
  expect(canInitiateHearthPlay(s, 0, 0)).toBe(true);
});

test('需要目标的炉石牌没有显式目标时拒绝结算', () => {
  const s = createGame(3, ['bolt'], 21);
  s.players[0]!.free = 5;
  s.players[0]!.hearthHand = [hearth('target-spell', 'bolt')];
  const result = dispatch(s, new Rng(21), { type: 'playHearth', player: 0, cardIdx: 0 });
  expect(result.ok).toBe(false);
  expect(s.players[0]!.free).toBe(5);
  expect(s.players[0]!.hearthHand).toHaveLength(1);
});

test('血契泰坦必须选择两张自己的 UNO 手牌，战吼只弃掉所选牌', () => {
  const s = createGame(2, ['bloodboundTitan'], 22);
  const cards: UnoCard[] = [
    { id: 'keep', color: 'red', value: '7' },
    { id: 'discard-a', color: 'blue', value: '2' },
    { id: 'discard-b', color: 'green', value: '3' },
  ];
  s.players[0]!.hand = cards;
  s.players[0]!.free = 10;
  s.players[0]!.hearthHand = [hearth('titan-card', 'bloodboundTitan')];
  const invalid = dispatch(s, new Rng(22), {
    type: 'playHearth',
    player: 0,
    cardIdx: 0,
    unoCardIds: ['discard-a'],
  });
  expect(invalid.ok).toBe(false);

  const topBefore = s.topCard.id;
  const events = okEvents(
    dispatch(s, new Rng(22), {
      type: 'playHearth',
      player: 0,
      cardIdx: 0,
      unoCardIds: ['discard-a', 'discard-b'],
    })
  );
  expect(s.players[0]!.hand.map((card) => card.id)).toEqual(['keep']);
  expect(s.topCard.id).toBe(topBefore);
  expect(s.players[0]!.board[0]).toMatchObject({ attack: 10, health: 10 });
  expect(events.some((event) => event.type === 'battlecry')).toBe(true);
  expect(events.some((event) => event.type === 'unoDiscarded')).toBe(true);
});

test('窥镜先知查看对手四张牌，并从中拿一张、弃一张', () => {
  const s = createGame(3, ['spyglassOracle'], 23);
  s.players[0]!.free = 10;
  s.players[0]!.hearthHand = [hearth('oracle-card', 'spyglassOracle')];
  const targetHand = s.players[2]!.hand.map((card) => card.id);
  const sourceCount = s.players[0]!.hand.length;
  const events = okEvents(
    dispatch(s, new Rng(23), {
      type: 'playHearth',
      player: 0,
      cardIdx: 0,
      targets: [2],
    })
  );
  const reveal = events.find((event) => event.type === 'handRevealed');
  expect(reveal).toMatchObject({ player: 0, targetPlayer: 2 });
  if (reveal?.type === 'handRevealed') {
    expect(reveal.cards).toHaveLength(4);
    expect(reveal.cards.every((card) => targetHand.includes(card.id))).toBe(true);
    const turnBeforeConfirm = s.turn;
    const takenId = reveal.cards[0]!.id;
    const discardedId = reveal.cards[1]!.id;
    const resolve = okEvents(
      dispatch(s, new Rng(24), {
        type: 'resolveOracle',
        player: 0,
        takeCardId: takenId,
        discardCardId: discardedId,
      })
    );
    expect(resolve.some((event) => event.type === 'oracleResolved')).toBe(true);
    expect(s.players[0]!.hand).toHaveLength(sourceCount + 1);
    expect(s.players[2]!.hand).toHaveLength(targetHand.length - 2);
    expect(s.oraclePending).toBeNull();
    expect(s.turn).toBe(turnBeforeConfirm);
    expect(s.players[0]!.hand.some((card) => card.id === takenId)).toBe(true);
    expect(s.players[2]!.hand.some((card) => card.id === discardedId)).toBe(false);
  }
});

test('强化抽牌术的三次抽取独立随机来自 UNO 或炉石牌库', () => {
  const outcomes = new Set<string>();
  for (let seed = 1; seed <= 24; seed++) {
    const s = createGame(2, ['draw2', 'shield'], seed);
    s.players[0]!.free = 2;
    s.players[0]!.hearthHand = [hearth(`mixed-${seed}`, 'draw2')];
    const events = okEvents(
      dispatch(s, new Rng(seed), { type: 'playHearth', player: 0, cardIdx: 0 })
    );
    const mixed = events.find((event) => event.type === 'mixedCardsDrawn');
    expect(mixed?.type).toBe('mixedCardsDrawn');
    if (mixed?.type === 'mixedCardsDrawn') {
      expect(mixed.unoCardIds.length + mixed.hearthCardIds.length).toBe(3);
      outcomes.add(`${mixed.unoCardIds.length}:${mixed.hearthCardIds.length}`);
    }
  }
  expect(outcomes).toContain('3:0');
  expect(outcomes).toContain('2:1');
  expect(outcomes).toContain('1:2');
  expect(outcomes).toContain('0:3');
});

test('奥术档案抽四张炉石，水晶充能一费换下回合五水晶', () => {
  const archive = createGame(2, ['arcaneArchive', 'shield'], 25);
  archive.players[0]!.free = 3;
  archive.players[0]!.hearthHand = [hearth('archive-card', 'arcaneArchive')];
  archive.players[0]!.hearthDeck = [];
  const archiveEvents = okEvents(
    dispatch(archive, new Rng(25), { type: 'playHearth', player: 0, cardIdx: 0 })
  );
  expect(archive.players[0]!.hearthHand).toHaveLength(4);
  expect(archiveEvents.find((event) => event.type === 'hearthDrawn')).toMatchObject({
    player: 0,
    reason: '奥术档案',
  });

  const charge = createGame(2, ['crystal2'], 26);
  charge.players[0]!.free = 1;
  charge.players[0]!.hearthHand = [hearth('charge-card', 'crystal2')];
  okEvents(dispatch(charge, new Rng(26), { type: 'playHearth', player: 0, cardIdx: 0 }));
  expect(charge.players[0]!.free).toBe(0);
  expect(charge.players[0]!.frozen).toBe(5);
});

test('灾厄发牌官在拥有者回合开始时给所有敌人各塞三张 UNO', () => {
  const s = createGame(4, ['calamityDealer'], 27);
  s.players[0]!.board = [
    {
      id: 'dealer',
      cardId: 'dealer-card',
      effectId: 'calamityDealer',
      owner: 0,
      attack: 5,
      health: 8,
      maxHealth: 8,
      exhausted: true,
    },
  ];
  s.players[2]!.active = false;
  s.turn = 3;
  const before = s.players.map((player) => player.hand.length);
  const events = okEvents(dispatch(s, new Rng(27), { type: 'endTurn', player: 3 }));
  expect(s.turn).toBe(0);
  expect(s.players[0]!.hand).toHaveLength(before[0]!);
  expect(s.players[1]!.hand).toHaveLength(before[1]! + 3);
  expect(s.players[2]!.hand).toHaveLength(before[2]!);
  expect(s.players[3]!.hand).toHaveLength(before[3]! + 4);
  expect(events.some((event) => event.type === 'minionTriggered')).toBe(true);
  expect(events).toContainEqual({
    type: 'massUnoDealt',
    player: 0,
    effectId: 'calamityDealer',
    targets: [1, 3],
    countPerTarget: 3,
  });
  expect(
    events
      .filter((event) => event.type === 'drawPenalty')
      .filter((event) => event.groupEffectId === 'calamityDealer')
      .map((event) => event.player)
  ).toEqual([1, 3]);
});

test('厄运司牌者在任意玩家回合开始时给所有敌人各塞两张 UNO', () => {
  const s = createGame(3, ['doomDealer'], 271);
  s.players[0]!.board = [
    {
      id: 'doom-dealer',
      cardId: 'doom-dealer-card',
      effectId: 'doomDealer',
      owner: 0,
      attack: 7,
      health: 9,
      maxHealth: 9,
      exhausted: true,
    },
  ];

  const beforeEnemyTurn = s.players.map((player) => player.hand.length);
  const enemyTurnEvents = okEvents(dispatch(s, new Rng(271), { type: 'endTurn', player: 0 }));
  expect(s.turn).toBe(1);
  expect(s.players[0]!.hand).toHaveLength(beforeEnemyTurn[0]! + 1);
  expect(s.players[1]!.hand).toHaveLength(beforeEnemyTurn[1]! + 2);
  expect(s.players[2]!.hand).toHaveLength(beforeEnemyTurn[2]! + 2);
  expect(enemyTurnEvents).toContainEqual({
    type: 'minionTriggered',
    player: 0,
    minionId: 'doom-dealer',
    effectId: 'doomDealer',
    trigger: 'anyTurnStart',
  });

  s.turn = 2;
  const beforeOwnerTurn = s.players.map((player) => player.hand.length);
  const ownerTurnEvents = okEvents(dispatch(s, new Rng(272), { type: 'endTurn', player: 2 }));
  expect(s.turn).toBe(0);
  expect(s.players[0]!.hand).toHaveLength(beforeOwnerTurn[0]!);
  expect(s.players[1]!.hand).toHaveLength(beforeOwnerTurn[1]! + 2);
  expect(s.players[2]!.hand).toHaveLength(beforeOwnerTurn[2]! + 3);
  expect(ownerTurnEvents.some((event) => event.type === 'minionTriggered')).toBe(true);
});

test('代罚壁垒吞掉整次罚抽，过量伤害只会摧毁随从', () => {
  const s = createGame(2, ['penaltyBulwark'], 28);
  s.players[0]!.board = [
    {
      id: 'attacker-overkill',
      cardId: 'attacker-overkill-card',
      effectId: 'stormDrake',
      owner: 0,
      attack: 5,
      health: 4,
      maxHealth: 4,
      exhausted: false,
    },
  ];
  s.players[1]!.board = [
    {
      id: 'bulwark',
      cardId: 'bulwark-card',
      effectId: 'penaltyBulwark',
      owner: 1,
      attack: 2,
      health: 2,
      maxHealth: 10,
      exhausted: false,
    },
  ];
  const before = s.players[1]!.hand.length;
  const events = okEvents(
    dispatch(s, new Rng(28), {
      type: 'attackMinion',
      player: 0,
      attackerId: 'attacker-overkill',
      targetPlayer: 1,
    })
  );
  expect(s.players[1]!.hand).toHaveLength(before);
  expect(s.players[1]!.board).toHaveLength(0);
  expect(events.find((event) => event.type === 'penaltyRedirected')).toMatchObject({ amount: 5 });
});

test('虚空赌徒在回合结束随机弃三张混合手牌，清空 UNO 后立即获胜', () => {
  const s = createGame(2, ['voidGambler'], 29);
  s.players[0]!.hand = [
    { id: 'gamble-a', color: 'red', value: '1' },
    { id: 'gamble-b', color: 'blue', value: '2' },
    { id: 'gamble-c', color: 'green', value: '3' },
  ];
  s.players[0]!.hearthHand = [];
  s.players[0]!.board = [
    {
      id: 'gambler',
      cardId: 'gambler-card',
      effectId: 'voidGambler',
      owner: 0,
      attack: 9,
      health: 9,
      maxHealth: 9,
      exhausted: false,
    },
  ];
  const events = okEvents(dispatch(s, new Rng(29), { type: 'endTurn', player: 0 }));
  expect(s.players[0]!.hand).toHaveLength(0);
  expect(s.phase).toBe('gameOver');
  expect(events).toContainEqual({ type: 'gameOver', winner: 0, reason: 'unoEmpty' });
});

test('虚空赌徒在打出的同一回合结束时立即触发', () => {
  const s = createGame(2, ['voidGambler', 'shield', 'bolt'], 291);
  s.players[0]!.free = 4;
  s.players[0]!.hand = Array.from({ length: 4 }, (_, index) => ({
    id: `same-turn-gambler-uno-${index}`,
    color: 'red' as const,
    value: String(index + 1) as UnoCard['value'],
  }));
  s.players[0]!.hearthHand = [
    hearth('same-turn-gambler', 'voidGambler'),
    hearth('same-turn-shield', 'shield'),
    hearth('same-turn-bolt', 'bolt'),
  ];

  const played = okEvents(dispatch(s, new Rng(291), { type: 'playHearth', player: 0, cardIdx: 0 }));
  const summoned = played.find((event) => event.type === 'minionSummoned');
  expect(summoned).toBeDefined();

  const ended = okEvents(dispatch(s, new Rng(292), { type: 'endTurn', player: 0 }));
  expect(ended).toContainEqual({
    type: 'minionTriggered',
    player: 0,
    minionId: summoned!.minionId,
    effectId: 'voidGambler',
    trigger: 'turnEnd',
  });
  const discarded = ended.find((event) => event.type === 'heroCardsDiscarded');
  expect(discarded).toBeDefined();
  if (discarded?.type === 'heroCardsDiscarded') {
    expect(discarded.unoCardIds.length + discarded.hearthCardIds.length).toBe(3);
  }
});

test('余烬凤凰死亡后令下一名对手抽四张 UNO', () => {
  const s = createGame(3, ['ashPhoenix'], 24);
  s.players[0]!.board = [
    {
      id: 'attacker',
      cardId: 'attacker-card',
      effectId: 'stormDrake',
      owner: 0,
      attack: 5,
      health: 6,
      maxHealth: 6,
      exhausted: false,
    },
  ];
  s.players[1]!.board = [
    {
      id: 'phoenix',
      cardId: 'phoenix-card',
      effectId: 'ashPhoenix',
      owner: 1,
      attack: 5,
      health: 4,
      maxHealth: 4,
      exhausted: false,
    },
  ];
  const before = s.players[2]!.hand.length;
  const events = okEvents(
    dispatch(s, new Rng(24), {
      type: 'attackMinion',
      player: 0,
      attackerId: 'attacker',
      targetPlayer: 1,
      targetMinionId: 'phoenix',
    })
  );
  expect(s.players[2]!.hand).toHaveLength(before + 4);
  expect(events.some((event) => event.type === 'deathrattle')).toBe(true);
});

test('随从互相攻击同时扣血，死亡牌进入坟场', () => {
  const s = createGame(2, ['clockworkSquire'], 12);
  s.players[0]!.board = [
    {
      id: 'attacker',
      cardId: 'a-card',
      effectId: 'emberWolf',
      owner: 0,
      attack: 3,
      health: 2,
      maxHealth: 2,
      exhausted: false,
    },
  ];
  s.players[1]!.board = [
    {
      id: 'defender',
      cardId: 'd-card',
      effectId: 'clockworkSquire',
      owner: 1,
      attack: 1,
      health: 2,
      maxHealth: 2,
      exhausted: false,
    },
  ];
  const result = dispatch(s, new Rng(12), {
    type: 'attackMinion',
    player: 0,
    attackerId: 'attacker',
    targetPlayer: 1,
    targetMinionId: 'defender',
  });
  expect(result.ok).toBe(true);
  expect(s.players[0]!.board[0]!.health).toBe(1);
  expect(s.players[1]!.board).toHaveLength(0);
  expect(s.players[1]!.hearthPile.at(-1)?.id).toBe('d-card');
});

test('直击玩家立即抽取攻击力等量 UNO，空牌库会无限重建', () => {
  const s = createGame(2, ['stormDrake'], 13);
  s.players[0]!.board = [
    {
      id: 'drake',
      cardId: 'drake-card',
      effectId: 'stormDrake',
      owner: 0,
      attack: 5,
      health: 4,
      maxHealth: 4,
      exhausted: false,
    },
  ];
  s.players[1]!.hand = [];
  s.unoDraw = [];
  s.unoDiscard = [s.topCard];
  const result = dispatch(s, new Rng(13), {
    type: 'attackMinion',
    player: 0,
    attackerId: 'drake',
    targetPlayer: 1,
  });
  expect(result.ok).toBe(true);
  expect(s.players[1]!.hand).toHaveLength(5);
  expect(new Set(s.players[1]!.hand.map((card) => card.id)).size).toBe(5);
  expect(s.unoCycle).toBe(1);
});

test('炉石牌库耗尽后按原牌表继续抽并保持唯一实例 ID', () => {
  const s = createGame(2, ['clockworkSquire', 'emberWolf'], 14);
  const p = s.players[0]!;
  p.hearthHand = [];
  p.hearthDeck = [];
  p.hearthPool = ['clockworkSquire', 'emberWolf'];
  p.hearthCycle = 9;
  dispatch(s, new Rng(14), { type: 'endTurn', player: 0 });
  dispatch(s, new Rng(15), { type: 'endTurn', player: 1 });
  expect(p.hearthHand).toHaveLength(1);
  expect(p.hearthHand[0]!.id).toContain('h-0-10-');
  expect(p.hearthCycle).toBe(10);
});

test('No Mercy 罚抽链支持彩色 +4、万能 +6、万能 +10 向上叠加', () => {
  const s = makeState([
    [
      { color: 'red', value: 'draw4' },
      { color: 'blue', value: '1' },
    ],
    [],
    [],
  ]);
  s.players[1]!.hand = [
    { id: 'p1-d6', color: null, value: 'wildDraw6' },
    { id: 'p1-keep', color: 'green', value: '1' },
  ];
  s.players[2]!.hand = [
    { id: 'p2-d10', color: null, value: 'wildDraw10' },
    { id: 'p2-keep', color: 'yellow', value: '1' },
  ];
  dispatch(s, new Rng(41), { type: 'playUno', player: 0, cardIdx: 0 });
  dispatch(s, new Rng(41), { type: 'endTurn', player: 0 });
  dispatch(s, new Rng(41), { type: 'playUno', player: 1, cardIdx: 0, color: 'blue' });
  dispatch(s, new Rng(41), { type: 'endTurn', player: 1 });
  dispatch(s, new Rng(41), { type: 'playUno', player: 2, cardIdx: 0, color: 'red' });
  expect(s.players[0]!.pendingDraw).toBe(20);
  expect(s.players[0]!.pendingDrawMin).toBe(10);
});

test('No Mercy 数字 7 必须指定玩家且只交换剩余 UNO 手牌', () => {
  const s = makeState([
    [
      { color: 'red', value: '7' },
      { color: 'blue', value: '1' },
    ],
    [],
  ]);
  s.players[1]!.hand = [
    { id: 'p1-a', color: 'green', value: '2' },
    { id: 'p1-b', color: 'green', value: '3' },
    { id: 'p1-c', color: 'green', value: '4' },
  ];
  s.players[0]!.hearthHand = [hearth('own-hearth', 'shield')];
  s.players[1]!.hearthHand = [
    hearth('target-hearth-a', 'bolt'),
    hearth('target-hearth-b', 'draw2'),
  ];
  const missingTarget = dispatch(s, new Rng(42), { type: 'playUno', player: 0, cardIdx: 0 });
  expect(missingTarget.ok).toBe(false);
  const events = okEvents(
    dispatch(s, new Rng(42), { type: 'playUno', player: 0, cardIdx: 0, targetPlayer: 1 })
  );
  expect(s.players[0]!.hand.map((card) => card.id)).toEqual(['p1-a', 'p1-b', 'p1-c']);
  expect(s.players[1]!.hand.map((card) => card.id)).toEqual(['t-0-1']);
  expect(s.players[0]!.hearthHand.map((card) => card.id)).toEqual(['own-hearth']);
  expect(s.players[1]!.hearthHand.map((card) => card.id)).toEqual([
    'target-hearth-a',
    'target-hearth-b',
  ]);
  expect(events.some((event) => event.type === 'handSwap')).toBe(true);
});

test('反转 +4 可以响应已有 +4，并把累计罚抽加四后反向传递', () => {
  const s = makeState([
    [
      { color: 'null', value: 'wildReverseDraw4' },
      { color: 'null', value: 'wildDraw6' },
    ],
    [],
  ]);
  s.players[0]!.pendingDraw = 4;
  s.players[0]!.pendingDrawMin = 4;
  expect(playableUnoIndices(s)).toEqual([0, 1]);
  const result = dispatch(s, new Rng(45), {
    type: 'playUno',
    player: 0,
    cardIdx: 0,
    color: 'red',
  });
  expect(result.ok).toBe(true);
  expect(s.direction).toBe(-1);
  expect(s.players[1]!.pendingDraw).toBe(8);
  expect(s.players[1]!.pendingDrawMin).toBe(4);
});

test('双人局空罚抽链打出反转 +4：跳过对手并由出牌者自己承受四张', () => {
  const s = makeState([
    [
      { color: 'null', value: 'wildReverseDraw4' },
      { color: 'red', value: '2' },
    ],
    [{ color: 'blue', value: '3' }],
  ]);
  const played = dispatch(s, new Rng(451), {
    type: 'playUno',
    player: 0,
    cardIdx: 0,
    color: 'red',
  });
  expect(played.ok).toBe(true);
  expect(s.direction).toBe(-1);
  expect(s.players[0]!.pendingDraw).toBe(4);
  expect(s.players[1]!.pendingDraw).toBe(0);
  expect(s.skipQueue).toEqual([1]);

  const ended = dispatch(s, new Rng(452), { type: 'endTurn', player: 0 });
  expect(ended.ok).toBe(true);
  expect(s.turn).toBe(0);
  expect(s.players[0]!.pendingDraw).toBe(0);
});

test('双人局连续反转 +4：自己可继续叠加并把八张罚抽传回对手', () => {
  const s = makeState([
    [
      { color: 'null', value: 'wildReverseDraw4' },
      { color: 'null', value: 'wildReverseDraw4' },
      { color: 'red', value: '2' },
    ],
    [{ color: 'blue', value: '3' }],
  ]);
  const rng = new Rng(453);
  const first = dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0, color: 'red' });
  expect(first.ok).toBe(true);
  expect(s.unoActionsLeft).toBe(0);
  expect(s.players[0]!.pendingDraw).toBe(4);
  expect(playableUnoIndices(s)).toEqual([0]);
  expect(playerCapabilities(s, 0).playableUnoIndices).toEqual([0]);

  const second = dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0, color: 'blue' });
  expect(second.ok).toBe(true);
  expect(s.players[0]!.pendingDraw).toBe(0);
  expect(s.players[1]!.pendingDraw).toBe(8);
  expect(s.players[1]!.pendingDrawMin).toBe(4);
  expect(s.skipQueue).toEqual([]);

  const ended = dispatch(s, rng, { type: 'endTurn', player: 0 });
  expect(ended.ok).toBe(true);
  expect(s.turn).toBe(1);
  expect(playableUnoIndices(s)).toEqual([]);
});

test('四人局反转 +4：被罚玩家无可叠加牌时仍可结束回合接受罚抽', () => {
  const s = makeState([
    [
      { color: 'null', value: 'wildReverseDraw4' },
      { color: 'red', value: '2' },
    ],
    [],
    [],
    [],
  ]);
  s.players[3]!.hand = [
    { id: 'four-player-no-stack-a', color: 'red', value: '1' },
    { id: 'four-player-no-stack-b', color: 'blue', value: '3' },
  ];
  const rng = new Rng(454);

  const played = dispatch(s, rng, {
    type: 'playUno',
    player: 0,
    cardIdx: 0,
    color: 'yellow',
  });
  expect(played.ok).toBe(true);
  expect(s.direction).toBe(-1);
  expect(s.players[3]!.pendingDraw).toBe(4);

  expect(dispatch(s, rng, { type: 'endTurn', player: 0 }).ok).toBe(true);
  expect(s.turn).toBe(3);
  expect(playerCapabilities(s, 3)).toMatchObject({
    playableUnoIndices: [],
    hasAnyAction: false,
    canEndTurn: true,
  });

  const accepted = okEvents(dispatch(s, rng, { type: 'endTurn', player: 3 }));
  expect(accepted).toContainEqual(
    expect.objectContaining({ type: 'drawPenalty', player: 3, count: 4 })
  );
  expect(s.players[3]!.pendingDraw).toBe(0);
  expect(s.turn).toBe(2);
});

test('+10 与 +6 威胁下没有同级或更大加牌时，结束回合会接受完整罚抽', () => {
  for (const minimum of [10, 6] as const) {
    const s = makeState([
      [
        { color: 'red', value: '1' },
        { color: 'blue', value: '3' },
      ],
    ]);
    const player = s.players[0]!;
    player.pendingDraw = minimum;
    player.pendingDrawMin = minimum;
    s.unoActionsLeft = 0;

    expect(playerCapabilities(s, 0)).toMatchObject({
      playableUnoIndices: [],
      playableHearthIndices: [],
      readyMinionIds: [],
      heroPowerUsable: false,
      hasAnyAction: false,
      canEndTurn: true,
    });

    const events = okEvents(dispatch(s, new Rng(600 + minimum), { type: 'endTurn', player: 0 }));
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'drawPenalty', player: 0, count: minimum })
    );
    expect(player.pendingDraw).toBe(0);
    expect(Number(player.pendingDrawMin)).toBe(0);
    expect(s.turn).toBe(1);
  }
});

test('所有罚抽门槛在无合法叠加时都保留结束回合出口', () => {
  for (const minimum of [2, 4, 6, 10] as const) {
    const s = makeState([
      [
        { color: 'green', value: '5' },
        { color: 'null', value: minimum === 10 ? 'wildDraw6' : 'wild' },
      ],
    ]);
    const player = s.players[0]!;
    player.pendingDraw = minimum + 4;
    player.pendingDrawMin = minimum;

    const capabilities = playerCapabilities(s, 0);
    expect(capabilities.playableUnoIndices).toEqual([]);
    expect(capabilities.hasAnyAction).toBe(false);
    expect(capabilities.canEndTurn).toBe(true);

    const events = okEvents(dispatch(s, new Rng(700 + minimum), { type: 'endTurn', player: 0 }));
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'drawPenalty', player: 0, count: minimum + 4 })
    );
  }
});

test('颜色轮盘转移没有加牌可用时也能放弃转移并结束回合', () => {
  const s = makeState([
    [
      { color: 'red', value: '2' },
      { color: 'blue', value: '4' },
    ],
  ]);
  const player = s.players[0]!;
  player.rouletteTransfer = 3;
  s.unoActionsLeft = 0;

  expect(playerCapabilities(s, 0)).toMatchObject({
    playableUnoIndices: [],
    hasAnyAction: false,
    canEndTurn: true,
  });
  expect(dispatch(s, new Rng(803), { type: 'endTurn', player: 0 }).ok).toBe(true);
  expect(player.rouletteTransfer).toBe(0);
  expect(s.turn).toBe(1);
});

test('最后一张罚抽牌必须等整条罚抽链结算完才确认获胜', () => {
  const penalties = [
    { color: 'red', value: 'draw2' },
    { color: 'red', value: 'draw4' },
    { color: 'null', value: 'wildDraw4' },
    { color: 'null', value: 'wildDraw6' },
    { color: 'null', value: 'wildDraw10' },
  ];
  penalties.forEach((penalty, index) => {
    const s = makeState([[penalty], []]);
    s.players[0]!.unoAlert = true;
    const rng = new Rng(460 + index);
    const played = okEvents(
      dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0, color: 'red' })
    );
    expect(played.some((event) => event.type === 'gameOver')).toBe(false);
    expect(s.phase).not.toBe('gameOver');
    expect(s.pendingUnoWinners).toEqual([0]);

    okEvents(dispatch(s, rng, { type: 'endTurn', player: 0 }));
    expect(s.turn).toBe(1);
    const resolved = okEvents(dispatch(s, rng, { type: 'endTurn', player: 1 }));
    expect(resolved).toContainEqual({ type: 'gameOver', winner: 0, reason: 'unoEmpty' });
    expect(s.phase).toBe('gameOver');
  });
});

test('最后一张 +4 被下家用最后一张反转 +4 传回时，由反转者在链结算后获胜', () => {
  const s = makeState([[{ color: 'null', value: 'wildDraw4' }], []]);
  s.players[0]!.unoAlert = true;
  s.players[1]!.hand = [{ id: 'counter', color: null, value: 'wildReverseDraw4' }];
  s.players[1]!.unoAlert = true;
  const rng = new Rng(470);

  okEvents(dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0, color: 'red' }));
  okEvents(dispatch(s, rng, { type: 'endTurn', player: 0 }));
  expect(s.turn).toBe(1);
  expect(playableUnoIndices(s)).toEqual([0]);
  const countered = okEvents(
    dispatch(s, rng, { type: 'playUno', player: 1, cardIdx: 0, color: 'blue' })
  );
  expect(countered.some((event) => event.type === 'gameOver')).toBe(false);
  expect(s.pendingUnoWinners).toEqual([0, 1]);

  okEvents(dispatch(s, rng, { type: 'endTurn', player: 1 }));
  expect(s.turn).toBe(0);
  const resolved = okEvents(dispatch(s, rng, { type: 'endTurn', player: 0 }));
  expect(resolved).toContainEqual({ type: 'gameOver', winner: 1, reason: 'unoEmpty' });
  expect(s.players[0]!.hand.length).toBeGreaterThan(0);
});

test('欢呼事件只在任意玩家刚进入只剩一张 UNO 时触发一次', () => {
  const s = makeState([
    [
      { color: 'red', value: '2' },
      { color: 'red', value: '3' },
    ],
    [],
  ]);
  const first = okEvents(dispatch(s, new Rng(46), { type: 'playUno', player: 0, cardIdx: 0 }));
  expect(first.filter((event) => event.type === 'unoAlert')).toHaveLength(1);
  s.turn = 1;
  const emote = okEvents(
    dispatch(s, new Rng(46), { type: 'heroEmote', player: 0, emoteId: 'greeting' })
  );
  expect(emote.some((event) => event.type === 'heroEmote')).toBe(true);
  expect(emote.some((event) => event.type === 'unoAlert')).toBe(false);
});

test('No Mercy 数字 0 让所有活跃玩家按当前方向传递手牌', () => {
  const s = makeState([
    [
      { color: 'red', value: '0' },
      { color: 'red', value: '1' },
    ],
    [],
    [],
  ]);
  s.players[1]!.hand = [{ id: 'p1', color: 'blue', value: '2' }];
  s.players[2]!.hand = [
    { id: 'p2-a', color: 'green', value: '3' },
    { id: 'p2-b', color: 'green', value: '4' },
  ];
  okEvents(dispatch(s, new Rng(43), { type: 'playUno', player: 0, cardIdx: 0 }));
  expect(s.players[0]!.hand.map((card) => card.id)).toEqual(['p2-a', 'p2-b']);
  expect(s.players[1]!.hand.map((card) => card.id)).toEqual(['t-0-1']);
  expect(s.players[2]!.hand.map((card) => card.id)).toEqual(['p1']);
});

test('颜色轮盘临时交给下家选色，逐张公开抽牌后把行动权还给出牌者', () => {
  const s = makeState([
    [
      { color: 'null', value: 'wildColorRoulette' },
      { color: 'blue', value: '1' },
    ],
    [],
  ]);
  s.rules.rouletteStacking = false;
  s.unoDraw = [
    { id: 'roulette-red', color: 'red', value: '5' },
    { id: 'roulette-blue', color: 'blue', value: '2' },
    { id: 'roulette-wild', color: null, value: 'wildDraw6' },
  ];
  const playEvents = okEvents(dispatch(s, new Rng(44), { type: 'playUno', player: 0, cardIdx: 0 }));
  expect(playEvents.some((event) => event.type === 'endTurn' && event.player === 0)).toBe(false);
  expect(s.turn).toBe(1);
  expect(s.players[1]!.roulettePending).toBe(true);
  const chooserHandSize = s.players[1]!.hand.length;
  const events = okEvents(
    dispatch(s, new Rng(44), { type: 'resolveRoulette', player: 1, color: 'red' })
  );
  expect(events.find((event) => event.type === 'colorRoulette')).toMatchObject({ count: 3 });
  expect(events.filter((event) => event.type === 'rouletteCardDrawn')).toHaveLength(3);
  expect(events[0]).toEqual({
    type: 'rouletteColorChosen',
    player: 1,
    drawer: 0,
    color: 'red',
  });
  expect(s.players[0]!.hand).toHaveLength(4);
  expect(s.players[1]!.hand).toHaveLength(chooserHandSize);
  expect(s.turn).toBe(0);
  expect(s.unoActionsLeft).toBe(0);
  expect(s.players[1]!.roulettePending).toBe(false);
  expect(s.players[0]!.rouletteTransfer).toBe(0);
});

test('颜色轮盘叠加规则允许用加牌把已抽数量转给下一位', () => {
  const s = makeState([
    [
      { color: 'null', value: 'wildColorRoulette' },
      { color: 'null', value: 'wildReverseDraw4' },
      { color: 'blue', value: '1' },
    ],
    [],
  ]);
  expect(s.rules.rouletteStacking).toBe(true);
  s.unoDraw = [
    { id: 'roulette-transfer-red', color: 'red', value: '5' },
    { id: 'roulette-transfer-blue', color: 'blue', value: '2' },
  ];

  okEvents(dispatch(s, new Rng(441), { type: 'playUno', player: 0, cardIdx: 0 }));
  okEvents(dispatch(s, new Rng(441), { type: 'resolveRoulette', player: 1, color: 'red' }));
  expect(s.players[0]!.rouletteTransfer).toBe(2);
  expect(playableUnoIndices(s)).toEqual([0]);

  const events = okEvents(
    dispatch(s, new Rng(441), {
      type: 'playUno',
      player: 0,
      cardIdx: 0,
      color: 'blue',
    })
  );
  expect(s.players[0]!.rouletteTransfer).toBe(0);
  expect(s.players[0]!.hand.map((card) => card.id)).toEqual([
    't-0-2',
    'roulette-transfer-blue',
    'roulette-transfer-red',
  ]);
  expect(s.players[1]!.pendingDraw).toBe(6);
  expect(s.players[1]!.pendingDrawMin).toBe(4);
  expect(events.find((event) => event.type === 'unoPlayed')).toMatchObject({
    penaltyTransferred: 2,
    penaltyAdded: 4,
  });
});

test('最后一张颜色轮盘必须完成选色与公开抽牌，抽回手牌后不会提前获胜', () => {
  const s = makeState([[{ color: 'null', value: 'wildColorRoulette' }], []]);
  s.players[0]!.unoAlert = true;
  s.unoDraw = [
    { id: 'roulette-last-red', color: 'red', value: '5' },
    { id: 'roulette-last-wild', color: null, value: 'wild' },
  ];
  const rng = new Rng(471);
  const played = okEvents(dispatch(s, rng, { type: 'playUno', player: 0, cardIdx: 0 }));
  expect(played.some((event) => event.type === 'gameOver')).toBe(false);
  expect(s.phase).not.toBe('gameOver');
  expect(s.pendingUnoWinners).toEqual([0]);
  expect(s.turn).toBe(1);

  const resolved = okEvents(dispatch(s, rng, { type: 'resolveRoulette', player: 1, color: 'red' }));
  expect(resolved.some((event) => event.type === 'gameOver')).toBe(false);
  expect(s.players[0]!.hand).toHaveLength(2);
  expect(s.pendingUnoWinners).toEqual([]);
  expect(s.turn).toBe(0);
  expect(s.phase).not.toBe('gameOver');
});

test('嘲讽随从在场时禁止攻击非嘲讽随从和英雄', () => {
  const s = createGame(2, ['clockworkSquire', 'crystalGuardian'], 51);
  s.turn = 0;
  s.players[0]!.board = [
    {
      id: 'attacker',
      cardId: 'attacker-card',
      effectId: 'clockworkSquire',
      owner: 0,
      attack: 1,
      health: 2,
      maxHealth: 2,
      exhausted: false,
    },
  ];
  s.players[1]!.board = [
    {
      id: 'taunt',
      cardId: 'taunt-card',
      effectId: 'crystalGuardian',
      owner: 1,
      attack: 2,
      health: 5,
      maxHealth: 5,
      exhausted: false,
    },
    {
      id: 'plain-target',
      cardId: 'plain-target-card',
      effectId: 'clockworkSquire',
      owner: 1,
      attack: 1,
      health: 2,
      maxHealth: 2,
      exhausted: false,
    },
  ];
  const blocked = dispatch(s, new Rng(51), {
    type: 'attackMinion',
    player: 0,
    attackerId: 'attacker',
    targetPlayer: 1,
  });
  expect(blocked).toEqual({ ok: false, error: '必须先攻击嘲讽随从' });
  const nonTauntBlocked = dispatch(s, new Rng(51), {
    type: 'attackMinion',
    player: 0,
    attackerId: 'attacker',
    targetPlayer: 1,
    targetMinionId: 'plain-target',
  });
  expect(nonTauntBlocked).toEqual({ ok: false, error: '必须先攻击嘲讽随从' });
  expect(
    dispatch(s, new Rng(51), {
      type: 'attackMinion',
      player: 0,
      attackerId: 'attacker',
      targetPlayer: 1,
      targetMinionId: 'taunt',
    }).ok
  ).toBe(true);
});

test('英雄技能默认每回合一次，减费与无限次数随从会实时生效', () => {
  const s = createGame(2, ['shield', 'powerAcolyte', 'powerUnbound'], 52, {}, [
    'cardMaster',
    'thug',
  ]);
  s.players[0]!.free = 3;
  expect(
    dispatch(s, new Rng(52), {
      type: 'useHeroPower',
      player: 0,
      unoCardIds: [s.players[0]!.hand[0]!.id],
    }).ok
  ).toBe(true);
  expect(dispatch(s, new Rng(52), { type: 'useHeroPower', player: 0 })).toEqual({
    ok: false,
    error: '英雄技能每回合只能使用一次',
  });
  s.players[0]!.heroPowerUses = 0;
  s.players[0]!.free = 4;
  s.players[0]!.board = [
    {
      id: 'reducer',
      cardId: 'reducer-card',
      effectId: 'powerAcolyte',
      owner: 0,
      attack: 2,
      health: 4,
      maxHealth: 4,
      exhausted: false,
    },
    {
      id: 'unbound',
      cardId: 'unbound-card',
      effectId: 'powerUnbound',
      owner: 0,
      attack: 4,
      health: 6,
      maxHealth: 6,
      exhausted: false,
    },
  ];
  expect(
    dispatch(s, new Rng(53), {
      type: 'useHeroPower',
      player: 0,
      unoCardIds: [s.players[0]!.hand[0]!.id],
    }).ok
  ).toBe(true);
  expect(
    dispatch(s, new Rng(54), {
      type: 'useHeroPower',
      player: 0,
      unoCardIds: [s.players[0]!.hand[0]!.id],
    }).ok
  ).toBe(true);
  expect(s.players[0]!.free).toBe(4);
});

test('多个灵能侍祭累计降低英雄技能费用，检察官可降至 0 费', () => {
  const s = createGame(2, ['powerAcolyte'], 53, {}, ['inspector', 'thug']);
  s.players[0]!.free = 0;
  s.players[0]!.board = ['first', 'second'].map((id) => ({
    id,
    cardId: `${id}-card`,
    effectId: 'powerAcolyte',
    owner: 0,
    attack: 4,
    health: 5,
    maxHealth: 5,
    exhausted: false,
  }));

  expect(heroPowerCost(s, 0)).toBe(0);
  const events = okEvents(
    dispatch(s, new Rng(53), { type: 'useHeroPower', player: 0, targets: [0, 1] })
  );
  expect(s.players[0]!.free).toBe(0);
  expect(events).toContainEqual({
    type: 'heroPowerUsed',
    player: 0,
    heroId: 'inspector',
    cost: 0,
    targets: [0, 1],
  });
});

test('卡牌大师以 1 费选择一张己方 UNO，换取所有玩家牌池中的一张随机炉石', () => {
  const s = createGame(3, [['shield'], ['bolt'], ['draw2']], 54, {}, [
    'cardMaster',
    'thug',
    'inspector',
  ]);
  const source = s.players[0]!;
  source.free = 1;
  const exchanged = source.hand[1]!;
  const topBefore = s.topCard.id;
  const unoBefore = source.hand.length;
  const hearthBefore = source.hearthHand.length;

  expect(
    dispatch(s, new Rng(54), {
      type: 'useHeroPower',
      player: 0,
      unoCardIds: [s.players[1]!.hand[0]!.id],
    })
  ).toEqual({ ok: false, error: '必须选择自己的一张 UNO 牌进行交换' });

  const events = okEvents(
    dispatch(s, new Rng(54), {
      type: 'useHeroPower',
      player: 0,
      unoCardIds: [exchanged.id],
    })
  );
  expect(getHero('cardMaster').powerCost).toBe(1);
  expect(source.free).toBe(0);
  expect(source.hand).toHaveLength(unoBefore - 1);
  expect(source.hearthHand).toHaveLength(hearthBefore + 1);
  const receivedEffectId = source.hearthHand.at(-1)?.effectId;
  expect(receivedEffectId).toBeDefined();
  expect(['shield', 'bolt', 'draw2']).toContain(receivedEffectId!);
  expect(s.unoDiscard.some((card) => card.id === exchanged.id)).toBe(true);
  expect(s.topCard.id).toBe(topBefore);
  expect(events).toContainEqual({
    type: 'unoDiscarded',
    player: 0,
    cardIds: [exchanged.id],
    reason: getHero('cardMaster').powerName,
  });
  expect(events.some((event) => event.type === 'hearthDrawn')).toBe(true);
});

test('暴徒以 2 费随机弃掉两张混合手牌，并给自己增加一层护盾', () => {
  const s = createGame(2, ['shield', 'bolt'], 55, {}, ['thug', 'cardMaster']);
  const source = s.players[0]!;
  source.free = 2;
  source.shield = 1;
  const before = source.hand.length + source.hearthHand.length;

  const events = okEvents(dispatch(s, new Rng(55), { type: 'useHeroPower', player: 0 }));
  expect(getHero('thug').powerCost).toBe(2);
  expect(source.free).toBe(0);
  expect(source.hand.length + source.hearthHand.length).toBe(before - 2);
  expect(source.shield).toBe(2);
  expect(events).toContainEqual(expect.objectContaining({ type: 'heroCardsDiscarded', player: 0 }));
  expect(dispatch(s, new Rng(55), { type: 'endTurn', player: 0 }).ok).toBe(true);
  expect(source.shield).toBe(2);
});

test('检察官洗混两名玩家的全部 UNO 与炉石手牌后完全随机分配', () => {
  const s = createGame(3, ['shield'], 55, {}, ['inspector', 'thug', 'cardMaster']);
  s.players[0]!.free = 2;
  s.players[0]!.hand = s.players[0]!.hand.slice(0, 2);
  s.players[1]!.hand = s.players[1]!.hand.slice(0, 5);
  s.players[0]!.hearthHand = [hearth('inspect-hearth-a', 'shield')];
  s.players[1]!.hearthHand = [
    hearth('inspect-hearth-b', 'shield'),
    hearth('inspect-hearth-c', 'shield'),
  ];
  const originalUnoIds = [...s.players[0]!.hand, ...s.players[1]!.hand]
    .map((card) => card.id)
    .sort();
  const originalHearthIds = [...s.players[0]!.hearthHand, ...s.players[1]!.hearthHand]
    .map((card) => card.id)
    .sort();
  const events = okEvents(
    dispatch(s, new Rng(55), { type: 'useHeroPower', player: 0, targets: [0, 1] })
  );
  expect(events.some((event) => event.type === 'handsRemixed')).toBe(true);
  expect(s.players[0]!.hand.length + s.players[1]!.hand.length).toBe(7);
  expect(s.players[0]!.hearthHand.length + s.players[1]!.hearthHand.length).toBe(3);
  expect([...s.players[0]!.hand, ...s.players[1]!.hand].map((card) => card.id).sort()).toEqual(
    originalUnoIds
  );
  expect(
    [...s.players[0]!.hearthHand, ...s.players[1]!.hearthHand].map((card) => card.id).sort()
  ).toEqual(originalHearthIds);
  expect([
    s.players[0]!.hand.length + s.players[0]!.hearthHand.length,
    s.players[1]!.hand.length + s.players[1]!.hearthHand.length,
  ]).not.toEqual([3, 7]);
});

test('检察官洗牌后任一参与者清空 UNO 都会立即获胜', () => {
  for (const [seed, winner] of [
    [1, 0],
    [7, 1],
  ] as const) {
    const s = createGame(3, ['shield'], seed, {}, ['inspector', 'thug', 'cardMaster']);
    s.players[0]!.free = 2;
    s.players[0]!.hand = [{ id: `last-${seed}`, color: 'red', value: '1' }];
    s.players[1]!.hand = [];
    s.players[0]!.hearthHand = [];
    s.players[1]!.hearthHand = [];
    const events = okEvents(
      dispatch(s, new Rng(seed), { type: 'useHeroPower', player: 0, targets: [0, 1] })
    );
    expect(s.phase).toBe('gameOver');
    expect(events).toContainEqual({ type: 'gameOver', winner, reason: 'unoEmpty' });
  }
});

test('赎罪斗士攻击时不伤害目标，改为拥有者随机弃掉等同攻击力的 UNO', () => {
  const s = createGame(2, ['penitentChampion'], 47);
  s.players[0]!.hand = Array.from({ length: 5 }, (_, index) => ({
    id: `penitent-${index}`,
    color: 'red' as const,
    value: '1' as const,
  }));
  s.players[0]!.board = [
    {
      id: 'penitent',
      cardId: 'penitent-card',
      effectId: 'penitentChampion',
      owner: 0,
      attack: 4,
      health: 6,
      maxHealth: 6,
      exhausted: false,
    },
  ];
  const targetBefore = s.players[1]!.hand.length;
  const events = okEvents(
    dispatch(s, new Rng(47), {
      type: 'attackMinion',
      player: 0,
      attackerId: 'penitent',
      targetPlayer: 1,
    })
  );
  expect(s.players[0]!.hand).toHaveLength(1);
  expect(s.players[1]!.hand).toHaveLength(targetBefore);
  expect(s.players[0]!.board[0]!.exhausted).toBe(true);
  expect(events.find((event) => event.type === 'minionAttack')).toMatchObject({
    drawCount: 0,
    discardCount: 4,
  });
});

test('血尺裁决者攻击时按攻击前当前生命值弃掉全部低点数 UNO', () => {
  const s = createGame(2, ['bloodMeasureArbiter'], 72);
  s.players[0]!.hand = [
    { id: 'number-0', color: 'red', value: '0' },
    { id: 'number-2', color: 'yellow', value: '2' },
    { id: 'number-3', color: 'green', value: '3' },
    { id: 'number-4', color: 'blue', value: '4' },
    { id: 'number-8', color: 'red', value: '8' },
    { id: 'action-skip', color: 'blue', value: 'skip' },
  ];
  s.players[0]!.board = [
    {
      id: 'blood-measure',
      cardId: 'blood-measure-card',
      effectId: 'bloodMeasureArbiter',
      owner: 0,
      attack: 2,
      health: 4,
      maxHealth: 4,
      exhausted: false,
    },
  ];
  s.players[1]!.board = [
    {
      id: 'counter-target',
      cardId: 'counter-card',
      effectId: 'clockworkSquire',
      owner: 1,
      attack: 1,
      health: 5,
      maxHealth: 5,
      exhausted: false,
    },
  ];

  const events = okEvents(
    dispatch(s, new Rng(72), {
      type: 'attackMinion',
      player: 0,
      attackerId: 'blood-measure',
      targetPlayer: 1,
      targetMinionId: 'counter-target',
    })
  );

  expect(s.players[0]!.hand.map((card) => card.id)).toEqual([
    'number-4',
    'number-8',
    'action-skip',
  ]);
  expect(s.players[0]!.board[0]!.health).toBe(3);
  expect(events.find((event) => event.type === 'unoDiscarded')).toMatchObject({
    player: 0,
    cardIds: ['number-0', 'number-2', 'number-3'],
  });
});

test('三费变形术必须明确选择随从，并将其变成无效果的 1/1 绵羊', () => {
  const s = createGame(2, ['polymorph'], 48);
  s.players[0]!.free = 3;
  s.players[0]!.hearthHand = [hearth('polymorph-card', 'polymorph')];
  s.players[1]!.board = [
    {
      id: 'transform-target',
      cardId: 'transform-card',
      effectId: 'calamityDealer',
      owner: 1,
      attack: 5,
      health: 6,
      maxHealth: 8,
      exhausted: false,
    },
  ];
  const missingTarget = dispatch(s, new Rng(48), {
    type: 'playHearth',
    player: 0,
    cardIdx: 0,
  });
  expect(missingTarget.ok).toBe(false);
  const events = okEvents(
    dispatch(s, new Rng(48), {
      type: 'playHearth',
      player: 0,
      cardIdx: 0,
      targetMinionId: 'transform-target',
    })
  );
  expect(s.players[1]!.board[0]).toMatchObject({
    effectId: 'sheepToken',
    attack: 1,
    health: 1,
    maxHealth: 1,
  });
  expect(events.some((event) => event.type === 'minionTransformed')).toBe(true);
});

test('四费众生平等无需目标，将全场随从统一为 1/1 并保留原有效果', () => {
  const s = createGame(3, ['equalityOfAll'], 49);
  s.players[0]!.free = 4;
  s.players[0]!.hearthHand = [hearth('equality-card', 'equalityOfAll')];
  s.players[0]!.board = [
    {
      id: 'friendly-equality-target',
      cardId: 'friendly-equality-card',
      effectId: 'calamityDealer',
      owner: 0,
      attack: 8,
      health: 6,
      maxHealth: 11,
      exhausted: false,
    },
  ];
  s.players[1]!.board = [
    {
      id: 'enemy-equality-target',
      cardId: 'enemy-equality-card',
      effectId: 'crystalGuardian',
      owner: 1,
      attack: 4,
      health: 3,
      maxHealth: 7,
      exhausted: true,
    },
  ];

  const events = okEvents(
    dispatch(s, new Rng(49), {
      type: 'playHearth',
      player: 0,
      cardIdx: 0,
    })
  );

  expect(s.players[0]!.board[0]).toMatchObject({
    effectId: 'calamityDealer',
    attack: 1,
    health: 1,
    maxHealth: 1,
    exhausted: false,
  });
  expect(s.players[1]!.board[0]).toMatchObject({
    effectId: 'crystalGuardian',
    attack: 1,
    health: 1,
    maxHealth: 1,
    exhausted: true,
  });
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'minionsEqualized',
      player: 0,
      affected: expect.arrayContaining([
        expect.objectContaining({
          targetPlayer: 0,
          minionId: 'friendly-equality-target',
          beforeAttack: 8,
          beforeHealth: 6,
          beforeMaxHealth: 11,
        }),
        expect.objectContaining({
          targetPlayer: 1,
          minionId: 'enemy-equality-target',
          beforeAttack: 4,
          beforeHealth: 3,
          beforeMaxHealth: 7,
        }),
      ]),
    })
  );
});

test('攻击与生命翻倍牌只允许选择己方随从，并实时更新战场数值', () => {
  const s = createGame(2, ['berserkerOath', 'vitalSurge'], 61);
  s.players[0]!.free = 10;
  s.players[0]!.hearthHand = [
    hearth('oath-card', 'berserkerOath'),
    hearth('surge-card', 'vitalSurge'),
  ];
  s.players[0]!.board = [
    {
      id: 'friendly-target',
      cardId: 'friendly-card',
      effectId: 'clockworkSquire',
      owner: 0,
      attack: 3,
      health: 4,
      maxHealth: 4,
      exhausted: false,
    },
  ];
  s.players[1]!.board = [
    {
      id: 'enemy-target',
      cardId: 'enemy-card',
      effectId: 'clockworkSquire',
      owner: 1,
      attack: 3,
      health: 4,
      maxHealth: 4,
      exhausted: false,
    },
  ];
  expect(
    dispatch(s, new Rng(61), {
      type: 'playHearth',
      player: 0,
      cardIdx: 0,
      targetMinionId: 'enemy-target',
    }).ok
  ).toBe(false);
  const attackEvents = okEvents(
    dispatch(s, new Rng(61), {
      type: 'playHearth',
      player: 0,
      cardIdx: 0,
      targetMinionId: 'friendly-target',
    })
  );
  expect(s.players[0]!.board[0]!.attack).toBe(6);
  expect(attackEvents).toContainEqual(
    expect.objectContaining({ type: 'minionEmpowered', stat: 'attack', before: 3, after: 6 })
  );
  okEvents(
    dispatch(s, new Rng(62), {
      type: 'playHearth',
      player: 0,
      cardIdx: 0,
      targetMinionId: 'friendly-target',
    })
  );
  expect(s.players[0]!.board[0]).toMatchObject({ health: 8, maxHealth: 8 });
});

test('翻倍战吼随从登场时强化另一个己方随从', () => {
  const s = createGame(2, ['warcryCommander'], 62);
  s.players[0]!.free = 10;
  s.players[0]!.hearthHand = [hearth('commander-card', 'warcryCommander')];
  s.players[0]!.board = [
    {
      id: 'warcry-target',
      cardId: 'warcry-target-card',
      effectId: 'emberWolf',
      owner: 0,
      attack: 4,
      health: 3,
      maxHealth: 3,
      exhausted: false,
    },
  ];
  const events = okEvents(
    dispatch(s, new Rng(62), {
      type: 'playHearth',
      player: 0,
      cardIdx: 0,
      targetMinionId: 'warcry-target',
    })
  );
  expect(s.players[0]!.board[0]!.attack).toBe(8);
  expect(s.players[0]!.board[1]).toMatchObject({
    effectId: 'warcryCommander',
    attack: 8,
    health: 8,
  });
  expect(events.some((event) => event.type === 'battlecry')).toBe(true);
});

test('七费 UNO 湮灭弃五张己方 UNO，四费强制征牌给对手塞五张 UNO', () => {
  const purge = createGame(2, ['unoAnnihilation'], 63);
  purge.players[0]!.free = 7;
  purge.players[0]!.hand = Array.from({ length: 5 }, (_, index) => ({
    id: `purge-${index}`,
    color: 'red' as const,
    value: String(index) as UnoCard['value'],
  }));
  purge.players[0]!.hearthHand = [hearth('purge-card', 'unoAnnihilation')];
  okEvents(
    dispatch(purge, new Rng(63), {
      type: 'playHearth',
      player: 0,
      cardIdx: 0,
    })
  );
  expect(purge.players[0]!.hand).toHaveLength(0);
  expect(purge.phase).toBe('gameOver');

  const burden = createGame(2, ['forcedConscription'], 64);
  burden.players[0]!.free = 4;
  burden.players[0]!.hearthHand = [hearth('burden-card', 'forcedConscription')];
  const before = burden.players[1]!.hand.length;
  okEvents(
    dispatch(burden, new Rng(64), {
      type: 'playHearth',
      player: 0,
      cardIdx: 0,
      targets: [1],
    })
  );
  expect(burden.players[1]!.hand).toHaveLength(before + 5);
});

test('UNO 湮灭超过五张时仍必须明确选择五张', () => {
  const purge = createGame(2, ['unoAnnihilation'], 631);
  purge.players[0]!.free = 7;
  purge.players[0]!.hand = Array.from({ length: 6 }, (_, index) => ({
    id: `long-purge-${index}`,
    color: 'green' as const,
    value: String(index) as UnoCard['value'],
  }));
  purge.players[0]!.hearthHand = [hearth('long-purge-card', 'unoAnnihilation')];

  const missingSelection = dispatch(purge, new Rng(631), {
    type: 'playHearth',
    player: 0,
    cardIdx: 0,
  });
  expect(missingSelection).toMatchObject({ ok: false });

  const selectedIds = purge.players[0]!.hand.slice(0, 5).map((card) => card.id);
  okEvents(
    dispatch(purge, new Rng(631), {
      type: 'playHearth',
      player: 0,
      cardIdx: 0,
      unoCardIds: selectedIds,
    })
  );
  expect(purge.players[0]!.hand).toHaveLength(1);
  expect(purge.players[0]!.hand[0]!.id).toBe('long-purge-5');
});

test('UNO 湮灭只检查费用，UNO 不足五张时弃掉现有全部手牌', () => {
  const purge = createGame(2, ['unoAnnihilation'], 65);
  purge.players[0]!.free = 7;
  purge.players[0]!.hand = Array.from({ length: 3 }, (_, index) => ({
    id: `short-purge-${index}`,
    color: 'blue' as const,
    value: String(index) as UnoCard['value'],
  }));
  purge.players[0]!.hearthHand = [hearth('short-purge-card', 'unoAnnihilation')];

  expect(canInitiateHearthPlay(purge, 0, 0)).toBe(true);
  okEvents(
    dispatch(purge, new Rng(65), {
      type: 'playHearth',
      player: 0,
      cardIdx: 0,
    })
  );

  expect(purge.players[0]!.free).toBe(0);
  expect(purge.players[0]!.hand).toHaveLength(0);
  expect(purge.players[0]!.hearthHand).toHaveLength(0);
});

test('UNO 湮灭在没有 UNO 手牌时也能消耗费用空放', () => {
  const purge = createGame(2, ['unoAnnihilation'], 66);
  purge.players[0]!.free = 7;
  purge.players[0]!.hand = [];
  purge.players[0]!.hearthHand = [hearth('empty-purge-card', 'unoAnnihilation')];

  expect(canInitiateHearthPlay(purge, 0, 0)).toBe(true);
  okEvents(dispatch(purge, new Rng(66), { type: 'playHearth', player: 0, cardIdx: 0 }));

  expect(purge.players[0]!.free).toBe(0);
  expect(purge.players[0]!.hearthHand).toHaveLength(0);
});

test('手牌达到 25 张触发慈悲规则淘汰并产生明确事件', () => {
  const s = makeState([
    [
      { color: 'red', value: 'draw2' },
      { color: 'blue', value: '1' },
    ],
    [],
  ]);
  s.players[1]!.hand = Array.from({ length: 24 }, (_, index) => ({
    id: `mercy-${index}`,
    color: 'blue' as const,
    value: '1' as const,
  }));
  s.players[1]!.hearthHand = [hearth('mercy-hand', 'clockworkSquire')];
  s.players[1]!.hearthDeck = [hearth('mercy-deck', 'clockworkSquire')];
  s.players[1]!.board = [
    {
      id: 'mercy-minion',
      cardId: 'mercy-board-card',
      effectId: 'clockworkSquire',
      owner: 1,
      attack: 1,
      health: 2,
      maxHealth: 2,
      exhausted: false,
    },
  ];
  dispatch(s, new Rng(45), { type: 'playUno', player: 0, cardIdx: 0 });
  dispatch(s, new Rng(45), { type: 'endTurn', player: 0 });
  const events = okEvents(dispatch(s, new Rng(45), { type: 'endTurn', player: 1 }));
  expect(s.players[1]!.active).toBe(false);
  expect(s.players[1]!.hand).toHaveLength(0);
  expect(s.players[1]!.hearthHand).toHaveLength(0);
  expect(s.players[1]!.hearthDeck).toHaveLength(0);
  expect(s.players[1]!.board).toHaveLength(0);
  expect(events.some((event) => event.type === 'playerEliminated' && event.player === 1)).toBe(
    true
  );
  expect(s.phase).toBe('gameOver');
  expect(events).toContainEqual({ type: 'gameOver', winner: 0, reason: 'lastStanding' });
});

test('当前玩家在行动中被慈悲淘汰后立即跳到下一名玩家，无需再点结束回合', () => {
  const s = createGame(3, ['shield'], 71);
  s.turn = 0;
  s.players[0]!.hand = Array.from({ length: 25 }, (_, index) => ({
    id: `mercy-current-${index}`,
    color: 'red' as const,
    value: String(index % 10) as UnoValue,
  }));
  s.players[0]!.hearthHand = [hearth('mercy-shield', 'shield')];
  s.players[0]!.free = 2;

  const events = okEvents(dispatch(s, new Rng(71), { type: 'playHearth', player: 0, cardIdx: 0 }));
  expect(s.players[0]!.active).toBe(false);
  expect(s.turn).toBe(1);
  expect(events).toContainEqual({ type: 'playerEliminated', player: 0, cardCount: 25 });
  expect(events).toContainEqual({ type: 'playerSkipped', player: 0 });
  expect(events.some((event) => event.type === 'turnStart' && event.player === 1)).toBe(true);
});

test('战阵轮转按当前方向传递完整随从场并更新所有权', () => {
  const s = createGame(3, ['battlefieldRotation'], 81);
  s.players[0]!.free = 4;
  s.players[0]!.hearthHand = [hearth('rotation', 'battlefieldRotation')];
  s.players[0]!.board = [minion('m0', 0)];
  s.players[1]!.board = [minion('m1', 1)];
  s.players[2]!.board = [minion('m2', 2)];

  const events = okEvents(dispatch(s, new Rng(81), { type: 'playHearth', player: 0, cardIdx: 0 }));
  expect(s.players[0]!.board.map((entry) => entry.id)).toEqual(['m2']);
  expect(s.players[1]!.board.map((entry) => entry.id)).toEqual(['m0']);
  expect(s.players[2]!.board.map((entry) => entry.id)).toEqual(['m1']);
  expect(
    s.players.every((player, owner) => player.board.every((entry) => entry.owner === owner))
  ).toBe(true);
  expect(events).toContainEqual(
    expect.objectContaining({ type: 'minionBoardsPassed', player: 0, direction: 1 })
  );
});

test('单骑易位要求显式选择两名有随从的英雄并各交换一个随从', () => {
  const s = createGame(3, ['duelOfAllegiance'], 82);
  s.players[0]!.free = 3;
  s.players[0]!.hearthHand = [hearth('duel', 'duelOfAllegiance')];
  s.players[0]!.board = [minion('a', 0)];
  s.players[1]!.board = [minion('b', 1)];
  const missing = dispatch(s, new Rng(82), { type: 'playHearth', player: 0, cardIdx: 0 });
  expect(missing.ok).toBe(false);

  const events = okEvents(
    dispatch(s, new Rng(82), { type: 'playHearth', player: 0, cardIdx: 0, targets: [0, 1] })
  );
  expect(s.players[0]!.board[0]!.id).toBe('b');
  expect(s.players[1]!.board[0]!.id).toBe('a');
  expect(s.players[0]!.board[0]!.owner).toBe(0);
  expect(s.players[1]!.board[0]!.owner).toBe(1);
  expect(events.some((event) => event.type === 'minionsExchanged' && event.mode === 'one')).toBe(
    true
  );
});

test('军团易帜交换两名英雄的全部随从场', () => {
  const s = createGame(3, ['armyExchange'], 83);
  s.players[0]!.free = 6;
  s.players[0]!.hearthHand = [hearth('army', 'armyExchange')];
  s.players[0]!.board = [minion('a0', 0), minion('a1', 0)];
  s.players[2]!.board = [minion('c0', 2)];
  okEvents(
    dispatch(s, new Rng(83), { type: 'playHearth', player: 0, cardIdx: 0, targets: [0, 2] })
  );
  expect(s.players[0]!.board.map((entry) => entry.id)).toEqual(['c0']);
  expect(s.players[2]!.board.map((entry) => entry.id)).toEqual(['a0', 'a1']);
  expect(s.players[2]!.board.every((entry) => entry.owner === 2)).toBe(true);
});

test('混沌点将保留全场随从且在活跃玩家间均匀随机重分', () => {
  const s = createGame(4, ['chaosConscription'], 84);
  s.players[0]!.free = 7;
  s.players[0]!.hearthHand = [hearth('chaos', 'chaosConscription')];
  for (let owner = 0; owner < 4; owner++) {
    s.players[owner]!.board = [minion(`m${owner}a`, owner), minion(`m${owner}b`, owner)];
  }
  const before = s.players.flatMap((player) => player.board.map((entry) => entry.id)).sort();
  const events = okEvents(dispatch(s, new Rng(84), { type: 'playHearth', player: 0, cardIdx: 0 }));
  const after = s.players.flatMap((player) => player.board.map((entry) => entry.id)).sort();
  expect(after).toEqual(before);
  expect(
    s.players.every((player, owner) => player.board.every((entry) => entry.owner === owner))
  ).toBe(true);
  expect(s.players.every((player) => player.board.length <= 5)).toBe(true);
  expect(events.some((event) => event.type === 'minionsRedistributed')).toBe(true);
});

test('跳过效果结算时会标明具体被禁用的玩家', () => {
  const s = makeState([[{ color: 'red', value: '1' }], [], []]);
  s.turn = 2;
  s.players[2]!.hand = [
    { id: 'p2-skip', color: 'red', value: 'skip' },
    { id: 'p2-keep', color: 'blue', value: '1' },
  ];
  dispatch(s, new Rng(46), { type: 'playUno', player: 2, cardIdx: 0 });
  const events = okEvents(dispatch(s, new Rng(46), { type: 'endTurn', player: 2 }));
  expect(events.some((event) => event.type === 'playerSkipped' && event.player === 0)).toBe(true);
  expect(s.turn).toBe(1);
});

test('列阵指挥官：放置在中间时两侧随从获得 +1/+1 和嘲讽', () => {
  const s = makeState([[{ color: 'red', value: '1' }], [{ color: 'red', value: '5' }]]);
  s.players[0]!.free = 3;
  s.players[0]!.hearthHand = [hearth('h0', 'formationCommander')];
  s.players[0]!.board = [
    {
      id: 'left',
      cardId: 'left-card',
      effectId: 'clockworkSquire',
      owner: 0,
      attack: 2,
      health: 3,
      maxHealth: 3,
      exhausted: true,
    },
    {
      id: 'right',
      cardId: 'right-card',
      effectId: 'clockworkSquire',
      owner: 0,
      attack: 2,
      health: 3,
      maxHealth: 3,
      exhausted: true,
    },
  ];
  const events = okEvents(
    dispatch(s, new Rng(30), { type: 'playHearth', player: 0, cardIdx: 0, position: 1 })
  );
  expect(s.players[0]!.board.map((m) => m.id)).toEqual(['left', 'm-h0', 'right']);
  expect(s.players[0]!.board[0]!.attack).toBe(3);
  expect(s.players[0]!.board[0]!.health).toBe(4);
  expect(s.players[0]!.board[0]!.maxHealth).toBe(4);
  expect(s.players[0]!.board[0]!.taunt).toBe(true);
  expect(s.players[0]!.board[2]!.attack).toBe(3);
  expect(s.players[0]!.board[2]!.taunt).toBe(true);
  expect(s.players[0]!.board[1]!.taunt).toBeUndefined();
  expect(events.some((event) => event.type === 'minionBuffed')).toBe(true);
});

test('列阵指挥官：放置在末尾时只有一侧相邻随从获得增益', () => {
  const s = makeState([[{ color: 'red', value: '1' }], [{ color: 'red', value: '5' }]]);
  s.players[0]!.free = 3;
  s.players[0]!.hearthHand = [hearth('h0', 'formationCommander')];
  s.players[0]!.board = [
    {
      id: 'left',
      cardId: 'left-card',
      effectId: 'clockworkSquire',
      owner: 0,
      attack: 2,
      health: 3,
      maxHealth: 3,
      exhausted: true,
    },
  ];
  okEvents(dispatch(s, new Rng(31), { type: 'playHearth', player: 0, cardIdx: 0, position: 1 }));
  expect(s.players[0]!.board.map((m) => m.id)).toEqual(['left', 'm-h0']);
  expect(s.players[0]!.board[0]!.attack).toBe(3);
  expect(s.players[0]!.board[0]!.taunt).toBe(true);
});

test('随从放置位置越界会被拒绝', () => {
  const s = makeState([[{ color: 'red', value: '1' }], [{ color: 'red', value: '5' }]]);
  s.players[0]!.free = 3;
  s.players[0]!.hearthHand = [hearth('h0', 'formationCommander')];
  const res = dispatch(s, new Rng(32), {
    type: 'playHearth',
    player: 0,
    cardIdx: 0,
    position: 3,
  });
  expect(res.ok).toBe(false);
  expect(s.players[0]!.board).toHaveLength(0);
  expect(s.players[0]!.free).toBe(3);
  expect(s.players[0]!.hearthHand.map((card) => card.id)).toEqual(['h0']);
});

test('效果赋予的嘲讽随从必须先被攻击', () => {
  const s = makeState([[{ color: 'red', value: '1' }], [{ color: 'red', value: '5' }]]);
  s.players[0]!.board = [
    {
      id: 'attacker',
      cardId: 'attacker-card',
      effectId: 'stormDrake',
      owner: 0,
      attack: 5,
      health: 4,
      maxHealth: 4,
      exhausted: false,
    },
  ];
  s.players[1]!.board = [
    {
      id: 'buffed',
      cardId: 'buffed-card',
      effectId: 'clockworkSquire',
      owner: 1,
      attack: 2,
      health: 3,
      maxHealth: 3,
      exhausted: false,
      taunt: true,
    },
    {
      id: 'plain',
      cardId: 'plain-card',
      effectId: 'clockworkSquire',
      owner: 1,
      attack: 2,
      health: 3,
      maxHealth: 3,
      exhausted: false,
    },
  ];
  const blocked = dispatch(s, new Rng(33), {
    type: 'attackMinion',
    player: 0,
    attackerId: 'attacker',
    targetPlayer: 1,
    targetMinionId: 'plain',
  });
  expect(blocked.ok).toBe(false);
  const allowed = dispatch(s, new Rng(34), {
    type: 'attackMinion',
    player: 0,
    attackerId: 'attacker',
    targetPlayer: 1,
    targetMinionId: 'buffed',
  });
  expect(allowed.ok).toBe(true);
});

test('低费余烬横扫对称造成 2 点清场伤害，只消灭残血随从', () => {
  const s = createGame(2, ['cinderSweep'], 2301);
  s.players[0]!.free = 2;
  s.players[0]!.hearthHand = [hearth('sweep', 'cinderSweep')];
  const friendly = minion('friendly', 0);
  const enemy = minion('enemy', 1);
  enemy.health = 2;
  s.players[0]!.board = [friendly];
  s.players[1]!.board = [enemy];

  const events = okEvents(
    dispatch(s, new Rng(2302), { type: 'playHearth', player: 0, cardIdx: 0 })
  );

  expect(s.players[0]!.board[0]!.health).toBe(2);
  expect(s.players[1]!.board).toHaveLength(0);
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'minionsCleared',
      effectId: 'cinderSweep',
      mode: 'damage',
      damage: 2,
      selfDrawback: 0,
    })
  );
});

test('失稳新星造成中等全场伤害，并在清场后结算自己的罚抽副作用', () => {
  const s = createGame(2, ['unstableNova'], 2311);
  s.players[0]!.free = 4;
  s.players[0]!.hearthHand = [hearth('nova', 'unstableNova')];
  const survivor = minion('survivor', 0);
  survivor.health = 7;
  survivor.maxHealth = 7;
  s.players[0]!.board = [survivor];
  s.players[1]!.board = [minion('victim', 1)];
  const handBefore = s.players[0]!.hand.length;

  const events = okEvents(
    dispatch(s, new Rng(2312), { type: 'playHearth', player: 0, cardIdx: 0 })
  );
  const clear = events.find(
    (event): event is Extract<GameEvent, { type: 'minionsCleared' }> =>
      event.type === 'minionsCleared'
  );

  expect(s.players[0]!.board[0]!.health).toBe(2);
  expect(s.players[1]!.board).toHaveLength(0);
  expect(s.players[0]!.hand).toHaveLength(handBefore + 2);
  expect(clear).toMatchObject({ selfDrawback: 2, selfDrawn: 2 });
});

test('尘爆工兵只在没有其他己方随从时触发条件清场', () => {
  const blocked = createGame(2, ['dustchargeSapper'], 2321);
  blocked.players[0]!.free = 3;
  blocked.players[0]!.hearthHand = [hearth('sapper-blocked', 'dustchargeSapper')];
  blocked.players[0]!.board = [minion('ally', 0)];
  blocked.players[1]!.board = [minion('enemy-blocked', 1)];
  const blockedEvents = okEvents(
    dispatch(blocked, new Rng(2322), { type: 'playHearth', player: 0, cardIdx: 0 })
  );
  expect(blocked.players[1]!.board[0]!.health).toBe(4);
  expect(blockedEvents).toContainEqual(
    expect.objectContaining({ type: 'minionsCleared', conditionMet: false, affected: [] })
  );

  const active = createGame(2, ['dustchargeSapper'], 2323);
  active.players[0]!.free = 3;
  active.players[0]!.hearthHand = [hearth('sapper-active', 'dustchargeSapper')];
  const enemy = minion('enemy-active', 1);
  enemy.health = 3;
  active.players[1]!.board = [enemy];
  const activeEvents = okEvents(
    dispatch(active, new Rng(2324), { type: 'playHearth', player: 0, cardIdx: 0 })
  );
  expect(active.players[0]!.board.map((entry) => entry.effectId)).toEqual(['dustchargeSapper']);
  expect(active.players[1]!.board).toHaveLength(0);
  expect(activeEvents.some((event) => event.type === 'minionsCleared')).toBe(true);
});

test('高费终局坍缩与末日宣告者提供逆天清场，但承担大量 UNO 副作用', () => {
  const collapse = createGame(2, ['finalCollapse'], 2331);
  collapse.players[0]!.free = 8;
  collapse.players[0]!.hearthHand = [hearth('collapse', 'finalCollapse')];
  collapse.players[0]!.board = [minion('collapse-own', 0)];
  collapse.players[1]!.board = [minion('collapse-enemy', 1)];
  const collapseHand = collapse.players[0]!.hand.length;
  okEvents(dispatch(collapse, new Rng(2332), { type: 'playHearth', player: 0, cardIdx: 0 }));
  expect(collapse.players.every((player) => player.board.length === 0)).toBe(true);
  expect(collapse.players[0]!.hand).toHaveLength(collapseHand + 5);

  const herald = createGame(2, ['apocalypseHerald'], 2333);
  herald.players[0]!.free = 9;
  herald.players[0]!.hearthHand = [hearth('herald', 'apocalypseHerald')];
  herald.players[0]!.board = [minion('herald-own', 0)];
  herald.players[1]!.board = [minion('herald-enemy', 1)];
  const heraldHand = herald.players[0]!.hand.length;
  okEvents(dispatch(herald, new Rng(2334), { type: 'playHearth', player: 0, cardIdx: 0 }));
  expect(herald.players[0]!.board.map((entry) => entry.effectId)).toEqual(['apocalypseHerald']);
  expect(herald.players[1]!.board).toHaveLength(0);
  expect(herald.players[0]!.hand).toHaveLength(heraldHand + 4);
});
