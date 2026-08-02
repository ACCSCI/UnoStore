import { drawPublic, nextActiveFrom } from '../../core/flow';
import type { GameState } from '../../core/state';
import { drawHearthCards } from '../draw';
import type { EffectCtx } from './registry';

export type MinionStat = 'attack' | 'health';

/**
 * 公共辅助：给目标玩家加罚抽（规则引擎与炉石效果共用的唯一入口）。
 * 护盾立即抵消；代罚随从在结算入口 resolveForcedUnoDraw 统一拦截。
 * 传入 minimum 表示 UNO 罚抽链（需要叠加或结束回合接受罚抽）；
 * 不传则只会入账 pendingDraw，在目标下回合开始时结算。
 */
export function addPenalty(
  state: GameState,
  player: number,
  count: number,
  minimum?: 2 | 4 | 6 | 10
): void {
  const p = state.players[player];
  if (!p) return;
  if (p.shield > 0) {
    p.shield -= 1;
    state.log.push(`玩家 ${player} 护盾抵消 ${count} 张罚抽`);
  } else {
    p.pendingDraw += count;
    if (minimum !== undefined) p.pendingDrawMin = minimum;
  }
}

/** 默认目标：当前玩家的下一个活跃玩家 */
export function defaultTarget(ctx: EffectCtx): number {
  return nextActiveFrom(ctx.state, ctx.state.turn);
}

/** 获得一张随机 Uno 牌加入手牌（从公共牌堆） */
export function drawUnoToHand(ctx: EffectCtx, count: number): void {
  const p = ctx.state.players[ctx.source]!;
  p.hand.push(...drawPublic(ctx.state, ctx.rng, count));
}

/** 从无限私人牌库抽炉石牌。 */
export function drawHearthToHand(ctx: EffectCtx, count: number, reason: string): void {
  const cards = drawHearthCards(ctx.state, ctx.rng, ctx.source, count);
  if (cards.length > 0) {
    ctx.events.push({
      type: 'hearthDrawn',
      player: ctx.source,
      cardIds: cards.map((card) => card.id),
      reason,
    });
  }
}

/** 每次独立随机 UNO / 炉石，结果允许全部落在同一种牌库。 */
export function drawMixedToHand(ctx: EffectCtx, count: number): void {
  const unoCards = [];
  const hearthCards = [];
  for (let index = 0; index < count; index++) {
    if (ctx.rng.int(2) === 0) unoCards.push(...drawPublic(ctx.state, ctx.rng, 1));
    else hearthCards.push(...drawHearthCards(ctx.state, ctx.rng, ctx.source, 1));
  }
  ctx.state.players[ctx.source]!.hand.push(...unoCards);
  ctx.events.push({
    type: 'mixedCardsDrawn',
    player: ctx.source,
    unoCardIds: unoCards.map((card) => card.id),
    hearthCardIds: hearthCards.map((card) => card.id),
  });
}

/** 随机弃掉至多 count 张己方 UNO，不改变桌面顶牌。 */
export function discardRandomUno(ctx: EffectCtx, count: number, reason: string): void {
  const player = ctx.state.players[ctx.source]!;
  const ids = new Set(
    ctx.rng
      .shuffle(player.hand)
      .slice(0, count)
      .map((card) => card.id)
  );
  if (ids.size === 0) return;
  const discarded = player.hand.filter((card) => ids.has(card.id));
  player.hand = player.hand.filter((card) => !ids.has(card.id));
  const insertAt = Math.max(0, ctx.state.unoDiscard.length - 1);
  ctx.state.unoDiscard.splice(insertAt, 0, ...discarded);
  ctx.events.push({
    type: 'unoDiscarded',
    player: ctx.source,
    cardIds: discarded.map((card) => card.id),
    reason,
  });
}

/** 按公开条件弃掉指定 UNO；保持桌面顶牌不变并产生统一演出事件。 */
export function discardUnoWhere(
  ctx: EffectCtx,
  predicate: (card: EffectCtx['state']['players'][number]['hand'][number]) => boolean,
  reason: string
): number {
  const player = ctx.state.players[ctx.source]!;
  const discarded = player.hand.filter(predicate);
  if (discarded.length === 0) return 0;
  const ids = new Set(discarded.map((card) => card.id));
  player.hand = player.hand.filter((card) => !ids.has(card.id));
  const insertAt = Math.max(0, ctx.state.unoDiscard.length - 1);
  ctx.state.unoDiscard.splice(insertAt, 0, ...discarded);
  ctx.events.push({
    type: 'unoDiscarded',
    player: ctx.source,
    cardIds: discarded.map((card) => card.id),
    reason,
  });
  return discarded.length;
}

/** 随机弃掉至多 count 张混合手牌，UNO 与炉石分别进入各自弃牌区。 */
export function discardRandomCards(ctx: EffectCtx, count: number, reason: string): void {
  const player = ctx.state.players[ctx.source]!;
  const candidates = [
    ...player.hand.map((card) => ({ kind: 'uno' as const, id: card.id })),
    ...player.hearthHand.map((card) => ({ kind: 'hearth' as const, id: card.id })),
  ];
  const selected = ctx.rng.shuffle(candidates).slice(0, count);
  const unoIds = new Set(selected.filter((card) => card.kind === 'uno').map((card) => card.id));
  const hearthIds = new Set(
    selected.filter((card) => card.kind === 'hearth').map((card) => card.id)
  );
  if (unoIds.size + hearthIds.size === 0) return;
  const discardedUno = player.hand.filter((card) => unoIds.has(card.id));
  const discardedHearth = player.hearthHand.filter((card) => hearthIds.has(card.id));
  player.hand = player.hand.filter((card) => !unoIds.has(card.id));
  player.hearthHand = player.hearthHand.filter((card) => !hearthIds.has(card.id));
  ctx.state.unoDiscard.splice(Math.max(0, ctx.state.unoDiscard.length - 1), 0, ...discardedUno);
  player.hearthPile.push(...discardedHearth);
  ctx.events.push({
    type: 'heroCardsDiscarded',
    player: ctx.source,
    unoCardIds: [...unoIds],
    hearthCardIds: [...hearthIds],
    reason,
  });
}

/** 翻倍指定随从的攻击或生命，并生成公开事件供界面表现。 */
export function doubleMinionStat(ctx: EffectCtx, stat: MinionStat): void {
  if (!ctx.targetMinionId) return;
  for (let owner = 0; owner < ctx.state.players.length; owner++) {
    const minion = ctx.state.players[owner]!.board.find((entry) => entry.id === ctx.targetMinionId);
    if (!minion) continue;
    const before = stat === 'attack' ? minion.attack : minion.maxHealth;
    if (stat === 'attack') minion.attack *= 2;
    else {
      minion.maxHealth *= 2;
      minion.health *= 2;
    }
    ctx.events.push({
      type: 'minionEmpowered',
      player: ctx.source,
      targetPlayer: owner,
      minionId: minion.id,
      stat,
      before,
      after: before * 2,
    });
    return;
  }
}

/** 所有活跃玩家把整块随从场按当前出牌方向交给下一位。 */
export function passMinionBoards(ctx: EffectCtx): void {
  const active = ctx.state.players
    .map((player, index) => (player.active ? index : -1))
    .filter((index) => index >= 0);
  if (active.length < 2) return;
  const original = new Map(active.map((owner) => [owner, [...ctx.state.players[owner]!.board]]));
  for (const source of active) {
    const target = nextActiveFrom(ctx.state, source);
    const board = original.get(source) ?? [];
    for (const minion of board) minion.owner = target;
    ctx.state.players[target]!.board = board;
  }
  ctx.events.push({
    type: 'minionBoardsPassed',
    player: ctx.source,
    direction: ctx.state.direction,
  });
}

/** 从两名目标各随机取一个随从并交换。 */
export function exchangeRandomMinions(ctx: EffectCtx): void {
  const [first, second] = ctx.targets ?? [];
  if (first === undefined || second === undefined) return;
  const firstBoard = ctx.state.players[first]?.board;
  const secondBoard = ctx.state.players[second]?.board;
  if (!(firstBoard?.length && secondBoard?.length)) return;
  const firstIndex = ctx.rng.int(firstBoard.length);
  const secondIndex = ctx.rng.int(secondBoard.length);
  const firstMinion = firstBoard[firstIndex]!;
  const secondMinion = secondBoard[secondIndex]!;
  firstBoard[firstIndex] = secondMinion;
  secondBoard[secondIndex] = firstMinion;
  secondMinion.owner = first;
  firstMinion.owner = second;
  ctx.events.push({
    type: 'minionsExchanged',
    player: ctx.source,
    first,
    second,
    mode: 'one',
    minionIds: [firstMinion.id, secondMinion.id],
  });
}

/** 交换两名目标的完整随从场。 */
export function exchangeAllMinions(ctx: EffectCtx): void {
  const [first, second] = ctx.targets ?? [];
  if (first === undefined || second === undefined) return;
  const firstBoard = ctx.state.players[first]?.board;
  const secondBoard = ctx.state.players[second]?.board;
  if (!(firstBoard && secondBoard)) return;
  ctx.state.players[first]!.board = secondBoard;
  ctx.state.players[second]!.board = firstBoard;
  for (const minion of secondBoard) minion.owner = first;
  for (const minion of firstBoard) minion.owner = second;
  ctx.events.push({
    type: 'minionsExchanged',
    player: ctx.source,
    first,
    second,
    mode: 'all',
    minionIds: [...firstBoard, ...secondBoard].map((minion) => minion.id),
  });
}

/** 收集全场随从，洗混后均匀随机发给所有活跃玩家；每人仍不会超过 5 个。 */
export function redistributeAllMinions(ctx: EffectCtx): void {
  const active = ctx.state.players
    .map((player, index) => (player.active ? index : -1))
    .filter((index) => index >= 0);
  const gathered = active.flatMap((owner) =>
    ctx.state.players[owner]!.board.map((minion) => ({ minion, from: owner }))
  );
  if (active.length === 0 || gathered.length === 0) return;
  for (const owner of active) ctx.state.players[owner]!.board = [];
  const shuffled = ctx.rng.shuffle(gathered);
  const recipients: number[] = [];
  while (recipients.length < shuffled.length) recipients.push(...ctx.rng.shuffle(active));
  const assignments = shuffled.map(({ minion, from }, index) => {
    const to = recipients[index]!;
    minion.owner = to;
    ctx.state.players[to]!.board.push(minion);
    return { minionId: minion.id, from, to };
  });
  ctx.events.push({ type: 'minionsRedistributed', player: ctx.source, assignments });
}

/** 弃掉玩家明确选择的 UNO 牌，但压在当前顶牌下方，不改变 UNO 出牌条件。 */
export function discardSelectedUno(ctx: EffectCtx, reason: string): void {
  const selected = new Set(ctx.unoCardIds ?? []);
  if (selected.size === 0) return;
  const player = ctx.state.players[ctx.source]!;
  const discarded = player.hand.filter((card) => selected.has(card.id));
  player.hand = player.hand.filter((card) => !selected.has(card.id));
  const insertAt = Math.max(0, ctx.state.unoDiscard.length - 1);
  ctx.state.unoDiscard.splice(insertAt, 0, ...discarded);
  ctx.events.push({
    type: 'unoDiscarded',
    player: ctx.source,
    cardIds: discarded.map((card) => card.id),
    reason,
  });
}

/** 把明确选择的混合手牌交给一名对手，并保留 UNO / 炉石各自的牌型。 */
export function giveSelectedCards(ctx: EffectCtx, target: number): void {
  const selected = new Set(ctx.cardIds ?? []);
  if (selected.size === 0 || target === ctx.source) return;
  const source = ctx.state.players[ctx.source]!;
  const recipient = ctx.state.players[target]!;
  const unoCards = source.hand.filter((card) => selected.has(card.id));
  const hearthCards = source.hearthHand.filter((card) => selected.has(card.id));
  source.hand = source.hand.filter((card) => !selected.has(card.id));
  source.hearthHand = source.hearthHand.filter((card) => !selected.has(card.id));
  recipient.hand.push(...unoCards);
  recipient.hearthHand.push(...hearthCards);
  ctx.events.push({
    type: 'cardsGifted',
    player: ctx.source,
    targetPlayer: target,
    unoCardIds: unoCards.map((card) => card.id),
    hearthCardIds: hearthCards.map((card) => card.id),
  });
}

/** 随机公开目标玩家至多 count 张 UNO 手牌，不改变其顺序和归属。 */
export function revealUnoHand(
  ctx: EffectCtx,
  target: number,
  count: number,
  chooseTakeAndDiscard = false
): void {
  const hand = ctx.state.players[target]?.hand ?? [];
  const cards = ctx.rng.shuffle(hand).slice(0, count);
  if (chooseTakeAndDiscard && cards.length >= 2) {
    ctx.state.oraclePending = {
      source: ctx.source,
      target,
      cardIds: cards.map((card) => card.id),
    };
  }
  ctx.events.push({
    type: 'handRevealed',
    player: ctx.source,
    targetPlayer: target,
    cards: cards.map(({ id, color, value }) => ({ id, color, value })),
    ...(chooseTakeAndDiscard && cards.length >= 2 ? { chooseTakeAndDiscard: true } : {}),
  });
}
