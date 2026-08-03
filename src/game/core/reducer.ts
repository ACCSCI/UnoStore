import { buildHearthDeck, drawHearthCards } from '../hearth/draw';
import { addPenalty, discardRandomUno, discardUnoWhere } from '../hearth/effects/common';
import {
  type EffectCtx,
  getEffect,
  minionHasTaunt,
  requiredOwnUnoCardCount,
} from '../hearth/effects/registry';
import { DEFAULT_HERO_ID, getHero, getHeroEmote, type HeroId } from '../heroes';
import {
  INITIAL_HEARTH_HAND,
  INITIAL_UNO_HAND,
  MERCY_HAND_LIMIT,
  UNO_ACTIONS_PER_TURN,
  UNO_PENALTY_DRAW,
  unoCrystalValue,
} from '../uno/constants';
import { createUnoDeck } from '../uno/deck';
import type { UnoAction, UnoCard } from '../uno/types';
import type { ActionResult, GameEvent } from './events';
import {
  beginTurn,
  canPlayAny,
  canPlayUnoCard,
  checkUnoAlert,
  drawPublic,
  drawStackValue,
  nextActiveFrom,
} from './flow';
import { Rng } from './rng';
import {
  type BossRulesMap,
  type GameAction,
  type GameRules,
  type GameState,
  type HearthCard,
  MAX_MINIONS_PER_PLAYER,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type PlayerState,
} from './state';

/**
 * 规则引擎核心：createGame 建局，dispatch 处理行动。
 * 全部为纯函数（state + rng 注入），可序列化、可重放、可联机同步。
 */

/** 创建一局游戏：每人 5 UNO + 3 炉石；seed 决定整局（可复现）。
 *  bossRules[i] 为玩家 i 的特殊规则（剧情 Boss 用），索引对齐 players。 */
export function createGame(
  playerCount: number,
  hearthEffectIds: string[] | string[][],
  seed = 42,
  bossRules: BossRulesMap = {},
  heroIds: HeroId[] = [],
  rules: Partial<GameRules> = {}
): GameState {
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new RangeError(`玩家人数必须为 ${MIN_PLAYERS}–${MAX_PLAYERS} 人`);
  }
  const rng = new Rng(seed);
  const players: PlayerState[] = [];
  for (let i = 0; i < playerCount; i++) {
    const firstEntry = hearthEffectIds[0];
    const pool = Array.isArray(firstEntry)
      ? ((hearthEffectIds as string[][])[i] ?? firstEntry ?? [])
      : (hearthEffectIds as string[]);
    if (pool.length === 0) throw new RangeError('炉石出战牌库不能为空');
    const deck = buildHearthDeck(pool, rng, i, 0);
    const openingHearth: PlayerState['hearthHand'] = [];
    let openingCycle = 0;
    while (openingHearth.length < INITIAL_HEARTH_HAND) {
      if (deck.length === 0) {
        openingCycle += 1;
        deck.push(...buildHearthDeck(pool, rng, i, openingCycle));
      }
      const card = deck.pop();
      if (card) openingHearth.push(card);
    }
    players.push({
      hand: [],
      hearthHand: openingHearth,
      hearthDeck: deck,
      hearthPile: [],
      hearthPool: [...pool],
      hearthCycle: openingCycle,
      board: [],
      free: 0,
      frozen: 0,
      pendingDraw: 0,
      pendingDrawMin: 0,
      roulettePending: false,
      rouletteDrawer: null,
      rouletteTransfer: 0,
      heroId: heroIds[i] ?? DEFAULT_HERO_ID,
      heroPowerUses: 0,
      shield: 0,
      unoAlert: false,
      active: true,
    });
  }
  const unoDeck = rng.shuffle(createUnoDeck());
  // No Mercy 官方规则：开局翻到功能牌时忽略，继续翻到数字牌。
  let top = unoDeck.pop()!;
  while (!/^\d$/.test(top.value) && unoDeck.length > 0) top = unoDeck.pop()!;
  const state: GameState = {
    players,
    unoDraw: unoDeck,
    unoDiscard: [top],
    mercyPile: [],
    unoCycle: 0,
    bossRules,
    rules: { rouletteStacking: true, ...rules },
    turn: 0,
    direction: 1,
    phase: 'playUno',
    topCard: top,
    chosenColor: top.color,
    unoActionsLeft: UNO_ACTIONS_PER_TURN,
    massSkipUsed: false,
    unoPlayedThisTurn: false,
    turnSerial: 0,
    oraclePending: null,
    pendingUnoWinners: [],
    skipQueue: [],
    pendingEvents: [],
    log: [],
  };
  // 发牌：每人 5 张 UNO
  for (let i = 0; i < INITIAL_UNO_HAND; i++) {
    for (let p = 0; p < playerCount; p++) {
      const c = state.unoDraw.pop();
      if (c) players[p]!.hand.push(c);
    }
  }
  state.pendingEvents.push({ type: 'gameStart' });
  startTurn(state, rng, 0, bossRules);
  state.log.push(`对局开始：${playerCount} 人，seed=${seed}`);
  return state;
}

/** 行动分发：校验合法性 → 执行 → 产出事件 */
export function dispatch(state: GameState, rng: Rng, action: GameAction): ActionResult {
  const hadOneCard = state.players.map((player) => player.hand.length === 1);
  const result = dispatchAction(state, rng, action);
  if (!result.ok) return result;

  // 当前行动者一旦触发慈悲淘汰，立即由规则层推进；不能再等待已经淘汰
  // （甚至已经断线）的客户端点击“结束回合”。
  if (state.phase !== 'gameOver' && !state.players[state.turn]?.active) {
    const eliminated = state.turn;
    const skippedEvent: GameEvent = { type: 'playerSkipped', player: eliminated };
    result.events.push(skippedEvent);
    state.pendingEvents.push(skippedEvent);
    const next = nextActiveFrom(state, eliminated);
    result.events.push(...startTurn(state, rng, next, state.bossRules));
  }

  // 报 UNO 是“进入只剩一张 UNO 的瞬间”事件，而不是界面按当前手牌数轮询。
  // 因此交换、赠送、偷取等所有改变手牌的动作也共用这一入口，并且只触发一次。
  state.players.forEach((player, index) => {
    if (player.hand.length !== 1) {
      player.unoAlert = false;
      return;
    }
    if (hadOneCard[index] || player.unoAlert) return;
    player.unoAlert = true;
    const event: GameEvent = { type: 'unoAlert', player: index };
    result.events.push(event);
    state.pendingEvents.push(event);
  });
  return result;
}

function dispatchAction(state: GameState, rng: Rng, action: GameAction): ActionResult {
  if (state.phase === 'gameOver') return { ok: false, error: '对局已结束' };
  const p = state.players[action.player];
  if (!p?.active) return { ok: false, error: '无效玩家' };
  if (state.oraclePending && action.type !== 'resolveOracle' && action.type !== 'heroEmote') {
    return { ok: false, error: '请先完成窥镜先知的拿牌与弃牌' };
  }
  switch (action.type) {
    case 'playUno':
      return playUnoAction(state, rng, action);
    case 'playHearth':
      return playHearthAction(state, rng, action);
    case 'drawUno':
      return drawUnoAction(state, rng, action);
    case 'resolveRoulette':
      return resolveRouletteAction(state, rng, action);
    case 'useHeroPower':
      return useHeroPowerAction(state, rng, action);
    case 'resolveOracle':
      return resolveOracleAction(state, action);
    case 'heroEmote': {
      const emote = getHeroEmote(action.emoteId);
      if (!emote) return { ok: false, error: '未知的英雄语音' };
      const event: GameEvent = {
        type: 'heroEmote',
        player: action.player,
        heroId: p.heroId,
        emoteId: emote.id,
        text: emote.text,
      };
      state.pendingEvents.push(event);
      return { ok: true, events: [event] };
    }
    case 'attackMinion':
      return attackMinionAction(state, rng, action);
    case 'endTurn':
      return endTurnAction(state, rng, action);
  }
}

/** 打 Uno 牌 */
function playUnoAction(
  state: GameState,
  _rng: Rng,
  action: Extract<GameAction, { type: 'playUno' }>
): ActionResult {
  if (action.player !== state.turn) return { ok: false, error: '不是你的回合' };
  const p = state.players[action.player]!;
  if (state.unoActionsLeft <= 0 && p.pendingDrawMin <= 0 && p.rouletteTransfer <= 0)
    return { ok: false, error: '本回合 Uno 行动已用完' };
  if (p.roulettePending) return { ok: false, error: '请先结算颜色轮盘' };
  const card = p.hand[action.cardIdx];
  if (!card) return { ok: false, error: '无效的牌' };
  if (!canPlayUnoCard(state, action.player, card)) return { ok: false, error: '这张牌不能打出' };
  if (card.value === '7') {
    const target = action.targetPlayer;
    if (target === undefined || target === action.player || !state.players[target]?.active) {
      return { ok: false, error: '打出 7 必须选择一名仍在对局中的玩家交换手牌' };
    }
  }
  const events: GameEvent[] = [];
  state.unoPlayedThisTurn = true;
  const stackedPenalty = p.pendingDrawMin > 0 ? p.pendingDraw : p.rouletteTransfer;
  const clearsTwoPlayerReverseSkip =
    stackedPenalty > 0 &&
    state.players.filter((entry) => entry.active).length === 2 &&
    state.topCard?.value === 'wildReverseDraw4' &&
    state.skipQueue.length > 0;
  if (stackedPenalty > 0) {
    p.pendingDraw = 0;
    p.pendingDrawMin = 0;
    if (p.rouletteTransfer > 0) {
      state.log.push(`玩家 ${action.player} 将颜色轮盘已抽的 ${p.rouletteTransfer} 张通过加牌转移`);
      p.rouletteTransfer = 0;
    }
    // 双人局首张反转 +4 会暂存“跳过对手、罚抽回到自己”。若自己继续叠加，
    // 罚抽链已经被传回对手，原本的跳过标记必须撤销，给对手保留响应窗口。
    if (clearsTwoPlayerReverseSkip) state.skipQueue.shift();
  }
  // 出牌
  p.hand.splice(action.cardIdx, 1);
  let crystal = 0;
  if (card.value === 'colorDump' && card.color !== null) {
    const dumped = p.hand.filter((entry) => entry.color === card.color);
    p.hand = p.hand.filter((entry) => entry.color !== card.color);
    crystal = dumped
      .filter((entry) => /^\d$/.test(entry.value))
      .reduce((sum, entry) => sum + unoCrystalValue(entry.value), 0);
    p.frozen += crystal;
    // 被清掉的牌不触发各自效果；功能牌最后压在牌堆顶，继续维持当前颜色和牌面规则。
    state.unoDiscard.push(...dumped, card);
    events.push({
      type: 'colorDump',
      player: action.player,
      color: card.color,
      count: dumped.length,
      cardIds: dumped.map((entry) => entry.id),
      crystalFrozen: crystal,
    });
  } else {
    state.unoDiscard.push(card);
  }
  state.topCard = card;
  if (card.color !== null && /^\d$/.test(card.value)) {
    crystal = unoCrystalValue(card.value);
    p.frozen += crystal; // 冻结（本回合不可用，回合结束解冻）
    state.chosenColor = card.color;
    if (card.value === '7') swapHands(state, action.player, action.targetPlayer!, events);
    else if (card.value === '0') passHands(state, action.player, events);
  } else {
    // 功能牌：不产水晶
    applyUnoAction(state, action.player, card.value as UnoAction, action.color, stackedPenalty);
  }
  const penaltyAdded = drawStackValue(card);
  const penaltyTarget =
    penaltyAdded > 0 ? state.players.findIndex((entry) => entry.pendingDrawMin > 0) : -1;
  events.push({
    type: 'unoPlayed',
    player: action.player,
    cardId: card.id,
    card: { id: card.id, color: card.color, value: card.value },
    crystalFrozen: crystal,
    ...(penaltyTarget >= 0
      ? {
          penaltyTarget,
          penaltyAdded,
          penaltyTransferred: stackedPenalty,
        }
      : {}),
  });
  checkUnoAlert(state, action.player, events);
  // 出完先进入候选胜利；罚抽链或颜色轮盘必须全部完成后才能确认获胜。
  if (p.hand.length === 0) {
    // 同色清场可能从多张手牌直接归零，不应因没有经过“一张牌”状态而被抓 UNO。
    if (!p.unoAlert && card.value !== 'colorDump') {
      // 走共同罚抽入口：护盾当场抵消，否则入账到下一次回合开始时结算。
      addPenalty(state, action.player, UNO_PENALTY_DRAW);
      events.push({ type: 'unoCaught', player: action.player, penalty: UNO_PENALTY_DRAW });
    }
    queueUnoWinCandidate(state, action.player);
    settlePendingUnoWin(state, events);
  } else {
    state.unoActionsLeft = Math.max(0, state.unoActionsLeft - 1);
  }
  if (card.value === 'wildColorRoulette' && state.phase !== 'gameOver') {
    const target = state.players.findIndex((entry) => entry.roulettePending);
    // 这里只把输入权临时交给下家选色，不结算回合结束、冻结水晶或回合开始效果。
    // 轮盘抽完后会把控制权还给出牌者，让其继续炉石、技能与随从操作。
    state.turn = target;
    state.pendingEvents.push(...events);
    return { ok: true, events };
  }
  state.pendingEvents.push(...events);
  return { ok: true, events };
}

/** 应用 Uno 功能牌效果 */
function applyUnoAction(
  state: GameState,
  player: number,
  action: UnoAction,
  color?: UnoCard['color'],
  stackedPenalty = 0
): void {
  if (state.topCard.color !== null) state.chosenColor = state.topCard.color;
  switch (action) {
    case 'skip':
      state.skipQueue.push(1);
      state.log.push(`玩家 ${player} 打出跳过`);
      break;
    case 'reverse':
      if (state.players.length === 2) state.skipQueue.push(1);
      else state.direction = (state.direction * -1) as 1 | -1;
      state.log.push(`玩家 ${player} 打出反转`);
      break;
    case 'draw2':
      addPenalty(state, nextActiveFrom(state, state.turn), stackedPenalty + 2, 2);
      state.log.push(`玩家 ${player} 打出 +2，累计罚抽 ${stackedPenalty + 2}`);
      break;
    case 'draw4':
      addPenalty(state, nextActiveFrom(state, state.turn), stackedPenalty + 4, 4);
      state.log.push(`玩家 ${player} 打出彩色 +4，累计罚抽 ${stackedPenalty + 4}`);
      break;
    case 'wild':
      state.chosenColor = color ?? null;
      state.log.push(`玩家 ${player} 打出变色`);
      break;
    case 'wildDraw4':
      state.chosenColor = color ?? null;
      addPenalty(state, nextActiveFrom(state, state.turn), stackedPenalty + 4, 4);
      state.log.push(`玩家 ${player} 打出 +4，累计罚抽 ${stackedPenalty + 4}`);
      break;
    case 'wildReverseDraw4': {
      state.chosenColor = color ?? null;
      state.direction = (state.direction * -1) as 1 | -1;
      const twoPlayerOpening =
        state.players.filter((entry) => entry.active).length === 2 && stackedPenalty === 0;
      if (twoPlayerOpening) state.skipQueue.push(1);
      const target = twoPlayerOpening ? player : nextActiveFrom(state, state.turn);
      addPenalty(state, target, stackedPenalty + 4, 4);
      state.log.push(`玩家 ${player} 打出反转 +4，方向反转，累计罚抽 ${stackedPenalty + 4}`);
      break;
    }
    case 'wildDraw6':
      state.chosenColor = color ?? null;
      addPenalty(state, nextActiveFrom(state, state.turn), stackedPenalty + 6, 6);
      state.log.push(`玩家 ${player} 打出 +6，累计罚抽 ${stackedPenalty + 6}`);
      break;
    case 'wildDraw10':
      state.chosenColor = color ?? null;
      addPenalty(state, nextActiveFrom(state, state.turn), stackedPenalty + 10, 10);
      state.log.push(`玩家 ${player} 打出 +10，累计罚抽 ${stackedPenalty + 10}`);
      break;
    case 'wildColorRoulette': {
      state.chosenColor = null;
      const target = nextActiveFrom(state, state.turn);
      state.players[target]!.roulettePending = true;
      state.players[target]!.rouletteDrawer = player;
      state.log.push(`玩家 ${player} 打出颜色轮盘，等待玩家 ${target} 选色`);
      break;
    }
    case 'massSkip': {
      // Nomercy：所有其他活跃玩家各跳过 1 次（含 2 人局 —— 对手被跳过，自己连续行动）。
      // 跳过 ≥1 人时额外获得 1 次 Uno 行动（2 人局跳过 1 人同样给：自己连续两回合）。
      state.chosenColor = color ?? state.topCard.color;
      const others = state.players
        .map((pl, i) => (pl.active && i !== player ? i : -1))
        .filter((i) => i >= 0);
      state.skipQueue.push(...others);
      if (!state.massSkipUsed && others.length >= 1) {
        state.unoActionsLeft += 1;
        state.massSkipUsed = true;
      }
      state.log.push(`玩家 ${player} 打出全员跳过`);
      break;
    }
    case 'colorDump':
      state.chosenColor = color ?? state.topCard.color;
      state.log.push(`玩家 ${player} 打出同色清场`);
      break;
  }
}

/** No Mercy 7：出牌者必须与指定活跃玩家交换剩余 UNO 手牌。 */
function swapHands(
  state: GameState,
  player: number,
  targetPlayer: number,
  events: GameEvent[]
): void {
  const ownHand = state.players[player]!.hand;
  state.players[player]!.hand = state.players[targetPlayer]!.hand;
  state.players[targetPlayer]!.hand = ownHand;
  events.push({ type: 'handSwap', player, targetPlayer });
  state.log.push(`玩家 ${player} 与玩家 ${targetPlayer} 交换 UNO 手牌`);
}

/** No Mercy 0：所有活跃玩家按当前方向把手牌传给下一位。 */
function passHands(state: GameState, player: number, events: GameEvent[]): void {
  const active = state.players
    .map((entry, index) => (entry.active ? index : -1))
    .filter((index) => index >= 0);
  const snapshots = new Map(active.map((index) => [index, state.players[index]!.hand]));
  for (const donor of active) {
    const recipient = nextActiveFrom(state, donor);
    state.players[recipient]!.hand = snapshots.get(donor)!;
  }
  events.push({ type: 'handPass', player, direction: state.direction });
  state.log.push(`玩家 ${player} 打出 0，所有玩家按当前方向传递手牌`);
}

/** 打炉石牌：法术执行效果，随从则进入战场。 */
export function hearthPlayError(state: GameState, player: number, cardIdx: number): string | null {
  if (state.phase === 'gameOver') return '对局已结束';
  if (player !== state.turn) return '不是你的回合';
  const p = state.players[player];
  if (!p?.active) return '无效玩家';
  if (p.roulettePending) return '请先结算颜色轮盘';
  if (p.pendingDrawMin > 0) return '请先叠加罚抽牌或结束回合接受罚抽';
  const card = p.hearthHand[cardIdx];
  if (!card) return '无效的牌';
  const effect = getEffect(card.effectId);
  if (!effect) return '未知的效果';
  if (p.free < effect.cost) return '水晶不足';
  if (effect.kind === 'minion' && p.board.length >= MAX_MINIONS_PER_PLAYER) {
    return `战场已满（最多 ${MAX_MINIONS_PER_PLAYER} 个随从）`;
  }
  const targeting =
    effect.targeting ??
    (effect.requiresTarget ? { type: 'enemyPlayer' as const, count: 1 as const } : null);
  if (
    (targeting?.type === 'enemyPlayer' || targeting?.type === 'giveCards') &&
    state.players.filter((entry, index) => entry.active && index !== player).length < 1
  ) {
    return '没有可选择的对手';
  }
  if (targeting?.type === 'players') {
    const eligible = state.players.filter(
      (entry, index) =>
        entry.active &&
        (targeting.includeSelf || index !== player) &&
        (!targeting.requireMinions || entry.board.length > 0)
    );
    if (eligible.length < targeting.count) {
      return targeting.requireMinions
        ? `至少需要 ${targeting.count} 名拥有随从的活跃英雄`
        : `至少需要 ${targeting.count} 名可选的活跃英雄`;
    }
  }
  if (
    targeting?.type === 'ownUnoCards' &&
    !targeting.useAllWhenShort &&
    p.hand.length < targeting.count
  ) {
    return `自己的 UNO 手牌不足 ${targeting.count} 张`;
  }
  if (
    targeting?.type === 'giveCards' &&
    p.hand.length + p.hearthHand.length - 1 < targeting.count
  ) {
    return `除这张法术外，自己的手牌不足 ${targeting.count} 张`;
  }
  if (targeting?.type === 'minion') {
    const available = state.players.flatMap((entry, owner) =>
      entry.active &&
      (targeting.side === 'any' ||
        (targeting.side === 'friendly' && owner === player) ||
        (targeting.side === 'enemy' && owner !== player))
        ? entry.board
        : []
    );
    if (available.length === 0) return '场上没有可选择的随从';
  }
  return null;
}

export function canInitiateHearthPlay(state: GameState, player: number, cardIdx: number): boolean {
  return hearthPlayError(state, player, cardIdx) === null;
}

function playHearthAction(
  state: GameState,
  rng: Rng,
  action: Extract<GameAction, { type: 'playHearth' }>
): ActionResult {
  const initialError = hearthPlayError(state, action.player, action.cardIdx);
  if (initialError) return { ok: false, error: initialError };
  const p = state.players[action.player]!;
  const card = p.hearthHand[action.cardIdx]!;
  const effect = getEffect(card.effectId)!;
  const targeting =
    effect.targeting ??
    (effect.requiresTarget ? { type: 'enemyPlayer' as const, count: 1 as const } : null);
  let resolvedUnoCardIds = action.unoCardIds;
  if (targeting?.type === 'enemyPlayer' || targeting?.type === 'giveCards') {
    const targets = [...new Set(action.targets ?? [])];
    if (
      targets.length !== 1 ||
      targets.some((target) => target === action.player || !state.players[target]?.active)
    ) {
      return { ok: false, error: '必须显式选择一名仍在对局中的对手' };
    }
  }
  if (targeting?.type === 'players') {
    const targets = [...new Set(action.targets ?? [])];
    if (
      targets.length !== targeting.count ||
      targets.some(
        (target) =>
          !state.players[target]?.active ||
          (!targeting.includeSelf && target === action.player) ||
          (targeting.requireMinions && state.players[target]!.board.length === 0)
      )
    ) {
      return {
        ok: false,
        error: targeting.requireMinions
          ? `必须选择 ${targeting.count} 名各自拥有随从的活跃英雄`
          : `必须选择 ${targeting.count} 名活跃英雄`,
      };
    }
  }
  if (targeting?.type === 'ownUnoCards') {
    const selected = [...new Set(action.unoCardIds ?? [])];
    const handIds = new Set(p.hand.map((uno) => uno.id));
    const requiredCount = requiredOwnUnoCardCount(targeting, p.hand.length);
    if (selected.length !== requiredCount || selected.some((id) => !handIds.has(id))) {
      return { ok: false, error: `必须从自己的手牌中选择 ${requiredCount} 张 UNO 牌` };
    }
    if (targeting.useAllWhenShort && p.hand.length < targeting.count) {
      resolvedUnoCardIds = p.hand.map((uno) => uno.id);
    }
  }
  if (targeting?.type === 'giveCards') {
    const selected = [...new Set(action.cardIds ?? [])];
    const handIds = new Set([
      ...p.hand.map((uno) => uno.id),
      ...p.hearthHand.filter((entry) => entry.id !== card.id).map((entry) => entry.id),
    ]);
    if (selected.length !== targeting.count || selected.some((id) => !handIds.has(id))) {
      return { ok: false, error: `必须从自己的手牌中选择 ${targeting.count} 张牌` };
    }
  }
  if (effect.requiresColor && !['red', 'yellow', 'green', 'blue'].includes(action.color ?? '')) {
    return { ok: false, error: '必须选择红、黄、绿、蓝中的一种颜色' };
  }
  if (targeting?.type === 'minion') {
    const targetOwner = state.players.findIndex((entry) =>
      entry.board.some((minion) => minion.id === action.targetMinionId)
    );
    if (
      targetOwner < 0 ||
      (targeting.side === 'enemy' && targetOwner === action.player) ||
      (targeting.side === 'friendly' && targetOwner !== action.player) ||
      !state.players[targetOwner]?.active
    ) {
      return { ok: false, error: '必须显式选择一个合法的场上随从' };
    }
  }
  // 所有客户端输入必须在扣费和移除手牌前完成校验，拒绝请求不得修改权威状态。
  const minionPosition = effect.kind === 'minion' ? (action.position ?? p.board.length) : undefined;
  if (
    minionPosition !== undefined &&
    (!Number.isInteger(minionPosition) || minionPosition < 0 || minionPosition > p.board.length)
  ) {
    return { ok: false, error: '无效的随从放置位置' };
  }
  p.free -= effect.cost;
  p.hearthHand.splice(action.cardIdx, 1);
  const events: GameEvent[] = [];
  if (effect.kind === 'minion') {
    const attack = effect.attack ?? 0;
    const health = effect.health ?? 1;
    const minionId = `m-${card.id}`;
    // 放置位置系统：position 为战场槽位（0..board.length），默认追加到末尾
    const position = minionPosition!;
    p.board.splice(position, 0, {
      id: minionId,
      cardId: card.id,
      effectId: card.effectId,
      owner: action.player,
      attack,
      health,
      maxHealth: health,
      exhausted: !effect.charge,
    });
    events.push({
      type: 'minionSummoned',
      player: action.player,
      minionId,
      cardId: card.id,
      effectId: card.effectId,
      attack,
      health,
      position,
    });
    if (effect.targeting) {
      events.push({ type: 'battlecry', player: action.player, minionId, effectId: effect.id });
    }
    effect.apply(
      createEffectContext(state, rng, action.player, events, {
        targets: action.targets,
        unoCardIds: resolvedUnoCardIds,
        cardIds: action.cardIds,
        targetMinionId: action.targetMinionId,
        color: action.color,
        sourceMinionId: minionId,
      })
    );
  } else {
    p.hearthPile.push(card);
    effect.apply(
      createEffectContext(state, rng, action.player, events, {
        targets: action.targets,
        unoCardIds: resolvedUnoCardIds,
        cardIds: action.cardIds,
        targetMinionId: action.targetMinionId,
        color: action.color,
      })
    );
  }
  // 炉石效果也可能弃光 UNO；胜利条件与从手中打出最后一张 UNO 完全一致。
  if (p.active && p.hand.length === 0 && state.phase !== 'gameOver') {
    state.phase = 'gameOver';
    events.push({ type: 'gameOver', winner: action.player, reason: 'unoEmpty' });
  }
  applyMercyRule(state, events);
  const playedEvent: GameEvent = {
    type: 'hearthPlayed',
    player: action.player,
    cardId: card.id,
    effectId: card.effectId,
    cost: effect.cost,
    ...(action.targets ? { targets: action.targets } : {}),
    ...(action.targetMinionId ? { targetMinionId: action.targetMinionId } : {}),
  };
  events.unshift(playedEvent);
  state.pendingEvents.push(...events);
  state.log.push(`玩家 ${action.player} 打出炉石牌 ${effect.name}（${effect.cost} 水晶）`);
  return { ok: true, events };
}

/** 随从攻击：打随从时同时扣血；打玩家时立即罚抽等于攻击力的 UNO 牌。 */
function attackMinionAction(
  state: GameState,
  rng: Rng,
  action: Extract<GameAction, { type: 'attackMinion' }>
): ActionResult {
  if (action.player !== state.turn) return { ok: false, error: '不是你的回合' };
  if (action.targetPlayer === action.player) return { ok: false, error: '不能攻击自己' };
  const source = state.players[action.player]!;
  if (source.roulettePending) return { ok: false, error: '请先结算颜色轮盘' };
  if (source.pendingDrawMin > 0) return { ok: false, error: '请先叠加罚抽牌或结束回合接受罚抽' };
  const targetPlayer = state.players[action.targetPlayer];
  if (!targetPlayer?.active) return { ok: false, error: '无效的攻击目标' };
  const attacker = source.board.find((minion) => minion.id === action.attackerId);
  if (!attacker) return { ok: false, error: '找不到攻击随从' };
  if (attacker.exhausted) return { ok: false, error: '这个随从本回合不能攻击' };
  if (attacker.attack <= 0) return { ok: false, error: '这个随从没有攻击力' };

  const events: GameEvent[] = [];
  const attackDamage = attacker.attack;
  let drawCount = 0;
  let discardCount = 0;
  const defender = action.targetMinionId
    ? targetPlayer.board.find((minion) => minion.id === action.targetMinionId)
    : undefined;
  if (action.targetMinionId && !defender) return { ok: false, error: '找不到目标随从' };
  const hasTaunt = targetPlayer.board.some((minion) => minionHasTaunt(minion));
  if (hasTaunt && !(defender && minionHasTaunt(defender))) {
    return { ok: false, error: '必须先攻击具有嘲讽的随从' };
  }
  const attackerEffect = getEffect(attacker.effectId);
  if (attackerEffect?.discardsNumbersBelowHealthOnAttack) {
    const healthThreshold = attacker.health;
    const discarded = discardUnoWhere(
      createEffectContext(state, rng, action.player, events, {
        sourceMinionId: attacker.id,
      }),
      (card) => /^\d$/.test(card.value) && Number(card.value) < healthThreshold,
      `${attackerEffect.name}的攻击效果（点数小于当前生命值 ${healthThreshold}）`
    );
    state.log.push(
      `玩家 ${action.player} 的 ${attackerEffect.name} 发起攻击，使其拥有者弃掉 ${discarded} 张低点数 UNO`
    );
  }
  if (attackerEffect?.discardsInsteadOfDamage) {
    attacker.exhausted = true;
    const before = source.hand.length;
    discardRandomUno(
      createEffectContext(state, rng, action.player, events, {
        sourceMinionId: attacker.id,
      }),
      attacker.attack,
      `${attackerEffect.name}的攻击替代效果`
    );
    discardCount = before - source.hand.length;
    state.log.push(
      `玩家 ${action.player} 的 ${attackerEffect.name} 发起攻击，改为拥有者弃掉 ${discardCount} 张 UNO`
    );
  } else if (action.targetMinionId) {
    attacker.exhausted = true;
    defender!.health -= attacker.attack;
    attacker.health -= defender!.attack;
    destroyDeadMinions(state, rng, action.player, events);
    destroyDeadMinions(state, rng, action.targetPlayer, events);
  } else {
    attacker.exhausted = true;
    drawCount = resolveForcedUnoDraw(
      state,
      rng,
      action.targetPlayer,
      attacker.attack,
      events,
      `${getEffect(attacker.effectId)?.name ?? '随从'}的直接攻击`
    );
    state.log.push(
      `玩家 ${action.player} 的随从直击玩家 ${action.targetPlayer}，罚抽 ${drawCount} 张`
    );
  }
  const attackEvent: GameEvent = {
    type: 'minionAttack',
    player: action.player,
    attackerId: action.attackerId,
    attackerEffectId: attacker.effectId,
    targetPlayer: action.targetPlayer,
    ...(action.targetMinionId ? { targetMinionId: action.targetMinionId } : {}),
    attackDamage,
    ...(defender ? { counterDamage: defender.attack } : {}),
    drawCount,
    ...(discardCount > 0 ? { discardCount } : {}),
  };
  events.unshift(attackEvent);
  if (source.active && source.hand.length === 0) {
    state.phase = 'gameOver';
    events.push({ type: 'gameOver', winner: action.player, reason: 'unoEmpty' });
  }
  state.pendingEvents.push(...events);
  return { ok: true, events };
}

function createEffectContext(
  state: GameState,
  rng: Rng,
  source: number,
  events: GameEvent[],
  extras: Partial<
    Pick<
      EffectCtx,
      'targets' | 'unoCardIds' | 'cardIds' | 'targetMinionId' | 'color' | 'sourceMinionId'
    >
  > = {}
): EffectCtx {
  return {
    state,
    source,
    events,
    rng,
    forceUnoDraw: (player, count, reason) =>
      resolveForcedUnoDraw(state, rng, player, count, events, reason),
    sourceIndex: () => {
      const minionId = extras.sourceMinionId;
      if (!minionId) return -1;
      return state.players[source]?.board.findIndex((entry) => entry.id === minionId) ?? -1;
    },
    ...extras,
  };
}

/**
 * 罚抽结算统一入口（addPenalty 只是入账）：
 * 护盾优先抵消 → 代罚随从（absorbsPenalty）承受等量伤害（过量不回流）→ 才真正抽牌。
 * UNO 罚抽链、被抓 UNO、炉石罚抽效果、随从直击全部汇集到这里拦截。
 */
function resolveForcedUnoDraw(
  state: GameState,
  rng: Rng,
  player: number,
  count: number,
  events: GameEvent[],
  reason: string
): number {
  const target = state.players[player];
  if (!(target?.active && count > 0)) return 0;
  if (target.shield > 0) {
    target.shield -= 1;
    events.push({ type: 'penaltyPrevented', player, amount: count, reason: '护盾' });
    state.log.push(`玩家 ${player} 的护盾抵消 ${reason}：${count} 张`);
    return 0;
  }
  const absorber = target.board.find((minion) => getEffect(minion.effectId)?.absorbsPenalty);
  if (absorber) {
    absorber.health -= count;
    events.push({
      type: 'penaltyRedirected',
      player,
      minionId: absorber.id,
      effectId: absorber.effectId,
      amount: count,
    });
    state.log.push(`玩家 ${player} 的 ${absorber.effectId} 承受 ${count} 点罚抽伤害`);
    destroyDeadMinions(state, rng, player, events);
    return 0;
  }
  const drawn = drawPublic(state, rng, count);
  target.hand.push(...drawn);
  events.push({
    type: 'drawPenalty',
    player,
    count: drawn.length,
    cardIds: drawn.map((card) => card.id),
  });
  state.log.push(`玩家 ${player} 因${reason}强制抽取 ${drawn.length} 张 UNO`);
  applyMercyRule(state, events);
  return drawn.length;
}

function runMinionTrigger(
  state: GameState,
  rng: Rng,
  player: number,
  trigger: 'turnStart' | 'turnEnd',
  events: GameEvent[]
): void {
  const board = [...state.players[player]!.board];
  for (const minion of board) {
    if (!state.players[player]!.board.some((entry) => entry.id === minion.id)) continue;
    const effect = getEffect(minion.effectId);
    const hook = trigger === 'turnStart' ? effect?.onTurnStart : effect?.onTurnEnd;
    if (!hook) continue;
    events.push({
      type: 'minionTriggered',
      player,
      minionId: minion.id,
      effectId: minion.effectId,
      trigger,
    });
    hook(createEffectContext(state, rng, player, events, { sourceMinionId: minion.id }));
    if (state.phase === 'gameOver') return;
  }
}

/** 任意玩家回合开始触发：按玩家座位、再按场上顺序结算，保证联机重放确定性。 */
function runAnyTurnStartTriggers(state: GameState, rng: Rng, events: GameEvent[]): void {
  const boards = state.players.map((player) => [...player.board]);
  for (let owner = 0; owner < boards.length; owner++) {
    if (!state.players[owner]!.active) continue;
    for (const minion of boards[owner]!) {
      if (!state.players[owner]!.board.some((entry) => entry.id === minion.id)) continue;
      const hook = getEffect(minion.effectId)?.onAnyTurnStart;
      if (!hook) continue;
      events.push({
        type: 'minionTriggered',
        player: owner,
        minionId: minion.id,
        effectId: minion.effectId,
        trigger: 'anyTurnStart',
      });
      hook(createEffectContext(state, rng, owner, events, { sourceMinionId: minion.id }));
      if (state.phase === 'gameOver') return;
    }
  }
}

function destroyDeadMinions(state: GameState, rng: Rng, player: number, events: GameEvent[]): void {
  const p = state.players[player]!;
  const dead = p.board.filter((minion) => minion.health <= 0);
  if (dead.length === 0) return;
  p.board = p.board.filter((minion) => minion.health > 0);
  for (const minion of dead) {
    p.hearthPile.push({ id: minion.cardId, effectId: minion.effectId });
    events.push({ type: 'minionDestroyed', player, minionId: minion.id });
    const effect = getEffect(minion.effectId);
    if (effect?.deathrattle) {
      events.push({ type: 'deathrattle', player, minionId: minion.id, effectId: minion.effectId });
      effect.deathrattle(
        createEffectContext(state, rng, player, events, {
          sourceMinionId: minion.id,
        })
      );
    }
  }
  applyMercyRule(state, events);
}

/** 打不出时抽 1 即止（抽后不能再打 Uno） */
function drawUnoAction(
  state: GameState,
  rng: Rng,
  action: Extract<GameAction, { type: 'drawUno' }>
): ActionResult {
  if (action.player !== state.turn) return { ok: false, error: '不是你的回合' };
  if (state.players[action.player]!.roulettePending)
    return { ok: false, error: '请先结算颜色轮盘' };
  if (state.players[action.player]!.pendingDrawMin > 0)
    return { ok: false, error: '罚抽链中不能普通抽牌，请结束回合接受累计罚抽' };
  if (state.unoActionsLeft <= 0) return { ok: false, error: '本回合已不能再抽' };
  if (canPlayAny(state, state.turn)) return { ok: false, error: '还有可出的牌' };
  const drawn = drawPublic(state, rng, 1);
  if (drawn.length === 0) return { ok: false, error: '牌堆空了' };
  state.players[state.turn]!.hand.push(...drawn);
  state.unoActionsLeft = 0; // 抽后放弃本轮 Uno 行动
  const event: GameEvent = {
    type: 'drawUno',
    player: action.player,
    cardId: drawn.map((c) => c.id).join(','),
  };
  const events: GameEvent[] = [event];
  applyMercyRule(state, events);
  state.pendingEvents.push(...events);
  if (!state.players[action.player]!.active && state.phase !== 'gameOver') {
    const skipped: number[] = [];
    const next = beginTurn(state, skipped);
    const startEvents = startTurn(state, rng, next, state.bossRules);
    events.push(...startEvents);
  }
  return { ok: true, events };
}

/** 结束回合：未出 UNO 则补 1 张 UNO；总是补 1 张炉石，然后推进。 */
function endTurnAction(
  state: GameState,
  rng: Rng,
  action: Extract<GameAction, { type: 'endTurn' }>
): ActionResult {
  if (action.player !== state.turn) return { ok: false, error: '不是你的回合' };
  const p = state.players[action.player]!;
  if (p.roulettePending) return { ok: false, error: '请先结算颜色轮盘' };
  const events: GameEvent[] = [];
  if (p.rouletteTransfer > 0) {
    state.log.push(`玩家 ${action.player} 放弃转移颜色轮盘的 ${p.rouletteTransfer} 张`);
    p.rouletteTransfer = 0;
    if (settlePendingUnoWin(state, events)) {
      state.pendingEvents.push(...events);
      return { ok: true, events };
    }
  }
  if (p.pendingDrawMin > 0) {
    resolveDrawPenalty(state, rng, action.player, events);
    if (state.phase === 'gameOver') {
      state.pendingEvents.push(...events);
      return { ok: true, events };
    }
    if (settlePendingUnoWin(state, events)) {
      state.pendingEvents.push(...events);
      return { ok: true, events };
    }
  }
  if (p.active) runMinionTrigger(state, rng, action.player, 'turnEnd', events);
  if (p.active && p.hand.length === 0) {
    queueUnoWinCandidate(state, action.player);
    settlePendingUnoWin(state, events);
  }
  if (state.phase === 'gameOver') {
    state.pendingEvents.push(...events);
    return { ok: true, events };
  }
  if (p.active && !state.unoPlayedThisTurn) {
    const drawn = drawPublic(state, rng, 1);
    p.hand.push(...drawn);
    if (drawn[0]) events.push({ type: 'drawUno', player: action.player, cardId: drawn[0].id });
    applyMercyRule(state, events);
  }
  if (p.active) {
    const hearth = drawHearthCards(state, rng, action.player, 1);
    if (hearth.length > 0) {
      events.push({
        type: 'hearthDrawn',
        player: action.player,
        cardIds: hearth.map((card) => card.id),
        reason: '回合结束',
      });
    }
  }
  if (!p.active) {
    state.pendingEvents.push(...events);
    if (state.players.filter((player) => player.active).length <= 1) return { ok: true, events };
    const event: GameEvent = { type: 'endTurn', player: action.player };
    events.push(event);
    const skipped: number[] = [];
    const next = beginTurn(state, skipped);
    const skipEvents: GameEvent[] = skipped.map((player) => ({ type: 'playerSkipped', player }));
    state.pendingEvents.push(event, ...skipEvents);
    const startEvents = startTurn(state, rng, next, state.bossRules);
    return { ok: true, events: [...events, ...skipEvents, ...startEvents] };
  }
  p.free += p.frozen; // 冻结叠加解冻
  p.frozen = 0;
  p.shield = 0;
  const event: GameEvent = { type: 'endTurn', player: action.player };
  events.push(event);
  state.pendingEvents.push(...events);
  // 结束回合：先解冻水晶，再推进到下一位（skipQueue 在 beginTurn 消费）
  const skipped: number[] = [];
  const next = beginTurn(state, skipped);
  const skipEvents: GameEvent[] = skipped.map((player) => ({ type: 'playerSkipped', player }));
  state.pendingEvents.push(...skipEvents);
  const startEvents = startTurn(state, rng, next, state.bossRules);
  return { ok: true, events: [...events, ...skipEvents, ...startEvents] };
}

/** 开始某玩家回合：不可叠加的效果罚抽立即结算；UNO 加牌链保留应对窗口。 */
function startTurn(
  state: GameState,
  rng: Rng,
  player: number,
  bossRules: BossRulesMap = {}
): GameEvent[] {
  const events: GameEvent[] = [];
  const p = state.players[player]!;
  state.turn = player;
  state.turnSerial += 1;
  state.unoPlayedThisTurn = false;
  p.rouletteTransfer = 0;
  p.heroPowerUses = 0;
  for (const minion of p.board) minion.exhausted = false;
  if (p.pendingDraw > 0 && p.pendingDrawMin === 0) {
    resolveDrawPenalty(state, rng, player, events);
    if (!p.active || state.phase === 'gameOver') {
      state.pendingEvents.push(...events);
      if (state.phase === 'gameOver') return events;
      const next = nextActiveFrom(state, player);
      const skippedEvent: GameEvent = { type: 'playerSkipped', player };
      state.pendingEvents.push(skippedEvent);
      return [...events, skippedEvent, ...startTurn(state, rng, next, bossRules)];
    }
  }
  // Boss 特殊规则：额外水晶直接进 free（本回合可用）
  const boss = bossRules[player];
  if (boss?.bonusCrystalPerTurn) {
    p.free += boss.bonusCrystalPerTurn;
    state.log.push(`玩家 ${player} Boss 规则：+${boss.bonusCrystalPerTurn} 水晶`);
  }
  runMinionTrigger(state, rng, player, 'turnStart', events);
  if (state.phase !== 'gameOver') runAnyTurnStartTriggers(state, rng, events);
  if (!p.active || state.phase === 'gameOver') {
    state.pendingEvents.push(...events);
    if (state.phase === 'gameOver') return events;
    const next = nextActiveFrom(state, player);
    const skippedEvent: GameEvent = { type: 'playerSkipped', player };
    state.pendingEvents.push(skippedEvent);
    return [...events, skippedEvent, ...startTurn(state, rng, next, bossRules)];
  }
  events.push({
    type: 'turnStart',
    player,
    drawUno: '',
    drawHearth: null,
  });
  state.unoActionsLeft = (boss?.extraUnoActions ?? 0) + UNO_ACTIONS_PER_TURN;
  state.massSkipUsed = false;
  state.phase = 'playUno';
  state.log.push(`玩家 ${player} 回合开始`);
  state.pendingEvents.push(...events);
  return events;
}

function resolveDrawPenalty(
  state: GameState,
  rng: Rng,
  player: number,
  events: GameEvent[]
): number {
  const p = state.players[player]!;
  if (p.pendingDraw <= 0) return 0;
  const count = p.pendingDraw;
  p.pendingDraw = 0;
  p.pendingDrawMin = 0;
  const drawn = resolveForcedUnoDraw(state, rng, player, count, events, '累计罚抽');
  state.log.push(`玩家 ${player} 接受累计罚抽 ${count} 张，实际抽取 ${drawn} 张`);
  return drawn;
}

/** 颜色轮盘由下家临时选色、出牌者抽牌；结算后控制权还给出牌者。 */
function resolveRouletteAction(
  state: GameState,
  rng: Rng,
  action: Extract<GameAction, { type: 'resolveRoulette' }>
): ActionResult {
  if (action.player !== state.turn) return { ok: false, error: '不是你的回合' };
  const p = state.players[action.player]!;
  if (!p.roulettePending) return { ok: false, error: '当前没有颜色轮盘需要结算' };
  const drawer = p.rouletteDrawer;
  if (drawer === null || !state.players[drawer])
    return { ok: false, error: '颜色轮盘缺少抽牌玩家' };
  const drawPlayer = state.players[drawer]!;
  const drawn: UnoCard[] = [];
  const events: GameEvent[] = [
    { type: 'rouletteColorChosen', player: action.player, drawer, color: action.color },
  ];
  do {
    const card = drawPublic(state, rng, 1)[0];
    if (!card) break;
    drawn.push(card);
    drawPlayer.hand.push(card);
    events.push({
      type: 'rouletteCardDrawn',
      player: drawer,
      chooser: action.player,
      color: action.color,
      index: drawn.length,
      card: { id: card.id, color: card.color, value: card.value },
    });
  } while (drawn.at(-1)?.color !== action.color);
  p.roulettePending = false;
  p.rouletteDrawer = null;
  state.chosenColor = action.color;
  state.unoActionsLeft = 0;
  events.push({
    type: 'colorRoulette',
    player: drawer,
    color: action.color,
    count: drawn.length,
    cardIds: drawn.map((card) => card.id),
  });
  state.log.push(
    `玩家 ${action.player} 颜色轮盘选择 ${action.color}，玩家 ${drawer} 抽取 ${drawn.length} 张`
  );
  applyMercyRule(state, events);
  if (state.rules.rouletteStacking && drawPlayer.active) {
    drawPlayer.rouletteTransfer = drawn.length;
  }
  if (state.phase === 'gameOver') {
    state.pendingEvents.push(...events);
    return { ok: true, events };
  }
  if (settlePendingUnoWin(state, events)) {
    state.pendingEvents.push(...events);
    return { ok: true, events };
  }
  if (!drawPlayer.active) {
    const next = nextActiveFrom(state, drawer);
    state.pendingEvents.push(...events);
    const startEvents = startTurn(state, rng, next, state.bossRules);
    return { ok: true, events: [...events, ...startEvents] };
  }
  state.turn = drawer;
  state.pendingEvents.push(...events);
  return { ok: true, events };
}

/** 当前英雄技能的实际费用。每个在场减费效果独立累计，最低为 0。 */
export function heroPowerCost(state: GameState, player: number): number {
  const p = state.players[player];
  if (!p) return 2;
  const reduction = p.board.reduce(
    (total, minion) => total + (getEffect(minion.effectId)?.heroPowerCostReduction ?? 0),
    0
  );
  return Math.max(0, getHero(p.heroId).powerCost - reduction);
}

export function heroPowerError(
  state: GameState,
  player: number,
  targets: number[] = [],
  unoCardIds: string[] = []
): string | null {
  if (state.phase === 'gameOver') return '对局已结束';
  if (player !== state.turn) return '不是你的回合';
  const p = state.players[player];
  if (!p?.active) return '无效玩家';
  if (p.roulettePending) return '请先结算颜色轮盘';
  if (p.pendingDrawMin > 0) return '请先叠加罚抽牌或结束回合接受罚抽';
  const unlimited = p.board.some((minion) => getEffect(minion.effectId)?.unlimitedHeroPower);
  if (!unlimited && p.heroPowerUses >= 1) return '英雄技能每回合只能使用一次';
  const cost = heroPowerCost(state, player);
  if (p.free < cost) return '水晶不足';
  if (p.heroId === 'cardMaster') {
    const unique = [...new Set(unoCardIds)];
    if (unique.length !== 1 || !p.hand.some((card) => card.id === unique[0])) {
      return '必须选择自己的一张 UNO 牌进行交换';
    }
  }
  if (p.heroId === 'inspector') {
    const unique = [...new Set(targets)];
    if (unique.length !== 2 || unique.some((target) => !state.players[target]?.active)) {
      return '必须选择两名不同的在场玩家';
    }
  }
  return null;
}

/** UI、AI 与“收工”提示共用的唯一可操作能力快照。 */
export function playerCapabilities(state: GameState, player: number) {
  const p = state.players[player];
  const isTurn = state.phase !== 'gameOver' && state.turn === player && Boolean(p?.active);
  if (!(p && isTurn)) {
    return {
      playableUnoIndices: [] as number[],
      playableHearthIndices: [] as number[],
      readyMinionIds: [] as string[],
      heroPowerUsable: false,
      mustResolveRoulette: false,
      mustResolveOracle: false,
      hasAnyAction: false,
    };
  }
  const mustResolveOracle = state.oraclePending?.source === player;
  const mustResolveRoulette = p.roulettePending;
  if (mustResolveOracle || mustResolveRoulette) {
    return {
      playableUnoIndices: [],
      playableHearthIndices: [],
      readyMinionIds: [],
      heroPowerUsable: false,
      mustResolveRoulette,
      mustResolveOracle,
      hasAnyAction: true,
    };
  }
  const canRespondToPenalty = p.pendingDrawMin > 0;
  const canTransferRoulette = p.rouletteTransfer > 0;
  const playableUnoIndices =
    state.unoActionsLeft > 0 || canRespondToPenalty || canTransferRoulette
      ? p.hand
          .map((card, index) => (canPlayUnoCard(state, player, card) ? index : -1))
          .filter((index) => index >= 0)
      : [];
  const blockedByPenalty = p.pendingDrawMin > 0;
  const playableHearthIndices = blockedByPenalty
    ? []
    : p.hearthHand
        .map((_, index) => (canInitiateHearthPlay(state, player, index) ? index : -1))
        .filter((index) => index >= 0);
  const readyMinionIds = blockedByPenalty
    ? []
    : p.board.filter((minion) => !minion.exhausted && minion.attack > 0).map((minion) => minion.id);
  const heroTargets =
    p.heroId === 'inspector'
      ? state.players
          .map((entry, index) => (entry.active ? index : -1))
          .filter((index) => index >= 0)
          .slice(0, 2)
      : [];
  const heroUnoCardIds = p.heroId === 'cardMaster' ? p.hand.slice(0, 1).map((card) => card.id) : [];
  const heroPowerUsable =
    !blockedByPenalty && heroPowerError(state, player, heroTargets, heroUnoCardIds) === null;
  return {
    playableUnoIndices,
    playableHearthIndices,
    readyMinionIds,
    heroPowerUsable,
    mustResolveRoulette,
    mustResolveOracle,
    hasAnyAction:
      playableUnoIndices.length > 0 ||
      playableHearthIndices.length > 0 ||
      readyMinionIds.length > 0 ||
      heroPowerUsable,
  };
}

function resolveOracleAction(
  state: GameState,
  action: Extract<GameAction, { type: 'resolveOracle' }>
): ActionResult {
  const pending = state.oraclePending;
  if (!pending || pending.source !== action.player) {
    return { ok: false, error: '当前没有需要结算的窥镜先知效果' };
  }
  if (
    action.takeCardId === action.discardCardId ||
    !pending.cardIds.includes(action.takeCardId) ||
    !pending.cardIds.includes(action.discardCardId)
  ) {
    return { ok: false, error: '必须从展示的牌中选择不同的拿取牌与弃置牌' };
  }
  const target = state.players[pending.target]!;
  const taken = target.hand.find((card) => card.id === action.takeCardId);
  const discarded = target.hand.find((card) => card.id === action.discardCardId);
  if (!(taken && discarded)) return { ok: false, error: '展示的牌已经发生变化' };
  target.hand = target.hand.filter(
    (card) => card.id !== action.takeCardId && card.id !== action.discardCardId
  );
  state.players[action.player]!.hand.push(taken);
  state.unoDiscard.splice(Math.max(0, state.unoDiscard.length - 1), 0, discarded);
  state.oraclePending = null;
  const events: GameEvent[] = [
    {
      type: 'oracleResolved',
      player: action.player,
      targetPlayer: pending.target,
      takenCardId: taken.id,
      discardedCardId: discarded.id,
    },
  ];
  checkUnoAlert(state, pending.target, events);
  applyMercyRule(state, events);
  state.pendingEvents.push(...events);
  return { ok: true, events };
}

function useHeroPowerAction(
  state: GameState,
  rng: Rng,
  action: Extract<GameAction, { type: 'useHeroPower' }>
): ActionResult {
  const targets = [...new Set(action.targets ?? [])];
  const unoCardIds = [...new Set(action.unoCardIds ?? [])];
  const error = heroPowerError(state, action.player, targets, unoCardIds);
  if (error) return { ok: false, error };
  const source = state.players[action.player]!;
  const cost = heroPowerCost(state, action.player);
  source.free -= cost;
  source.heroPowerUses += 1;
  const events: GameEvent[] = [
    { type: 'heroPowerUsed', player: action.player, heroId: source.heroId, cost, targets },
  ];

  if (source.heroId === 'cardMaster') {
    const exchanged = source.hand.find((card) => card.id === unoCardIds[0])!;
    source.hand = source.hand.filter((card) => card.id !== exchanged.id);
    state.unoDiscard.splice(Math.max(0, state.unoDiscard.length - 1), 0, exchanged);
    const sharedPool = state.players
      .filter((player) => player.active)
      .flatMap((player) => player.hearthPool);
    const drawn = [
      {
        id: `hero-${action.player}-${state.log.length}-${source.heroPowerUses}-0`,
        effectId: sharedPool[rng.int(sharedPool.length)]!,
      },
    ];
    source.hearthHand.push(...drawn);
    events.push({
      type: 'unoDiscarded',
      player: action.player,
      cardIds: [exchanged.id],
      reason: getHero(source.heroId).powerName,
    });
    events.push({
      type: 'hearthDrawn',
      player: action.player,
      cardIds: drawn.map((card) => card.id),
      reason: getHero(source.heroId).powerName,
    });
    checkUnoAlert(state, action.player, events);
    if (source.hand.length === 0) {
      state.phase = 'gameOver';
      events.push({ type: 'gameOver', winner: action.player, reason: 'unoEmpty' });
    }
  } else if (source.heroId === 'thug') {
    const candidates = [
      ...source.hand.map((card) => ({ kind: 'uno' as const, id: card.id })),
      ...source.hearthHand.map((card) => ({ kind: 'hearth' as const, id: card.id })),
    ];
    const selected = rng.shuffle(candidates).slice(0, 2);
    const unoIds = new Set(selected.filter((card) => card.kind === 'uno').map((card) => card.id));
    const hearthIds = new Set(
      selected.filter((card) => card.kind === 'hearth').map((card) => card.id)
    );
    const discardedUno = source.hand.filter((card) => unoIds.has(card.id));
    const discardedHearth = source.hearthHand.filter((card) => hearthIds.has(card.id));
    source.hand = source.hand.filter((card) => !unoIds.has(card.id));
    source.hearthHand = source.hearthHand.filter((card) => !hearthIds.has(card.id));
    state.unoDiscard.splice(Math.max(0, state.unoDiscard.length - 1), 0, ...discardedUno);
    source.hearthPile.push(...discardedHearth);
    events.push({
      type: 'heroCardsDiscarded',
      player: action.player,
      unoCardIds: [...unoIds],
      hearthCardIds: [...hearthIds],
    });
    source.shield += 1;
    if (source.hand.length === 0) {
      state.phase = 'gameOver';
      events.push({ type: 'gameOver', winner: action.player, reason: 'unoEmpty' });
    }
  } else {
    const [first, second] = targets as [number, number];
    const mixed = rng.shuffle([
      ...state.players[first]!.hand.map((card) => ({ kind: 'uno' as const, card })),
      ...state.players[first]!.hearthHand.map((card) => ({ kind: 'hearth' as const, card })),
      ...state.players[second]!.hand.map((card) => ({ kind: 'uno' as const, card })),
      ...state.players[second]!.hearthHand.map((card) => ({ kind: 'hearth' as const, card })),
    ]);
    const firstUno: UnoCard[] = [];
    const secondUno: UnoCard[] = [];
    const firstHearth: HearthCard[] = [];
    const secondHearth: HearthCard[] = [];
    for (const entry of mixed) {
      const giveToFirst = rng.int(2) === 0;
      if (entry.kind === 'uno') (giveToFirst ? firstUno : secondUno).push(entry.card);
      else (giveToFirst ? firstHearth : secondHearth).push(entry.card);
    }
    state.players[first]!.hand = firstUno;
    state.players[first]!.hearthHand = firstHearth;
    state.players[second]!.hand = secondUno;
    state.players[second]!.hearthHand = secondHearth;
    events.push({ type: 'handsRemixed', player: action.player, first, second });
  }

  applyMercyRule(state, events);
  state.pendingEvents.push(...events);
  state.log.push(`玩家 ${action.player} 使用英雄技能 ${getHero(source.heroId).powerName}`);
  return { ok: true, events };
}

/** No Mercy 慈悲规则：手牌达到 25 张立即淘汰；仅剩一人时直接获胜。 */
function applyMercyRule(state: GameState, events: GameEvent[]): void {
  for (let player = 0; player < state.players.length; player++) {
    const p = state.players[player]!;
    if (!p.active || p.hand.length < MERCY_HAND_LIMIT) continue;
    const cardCount = p.hand.length;
    state.mercyPile.push(...p.hand);
    p.hand = [];
    p.hearthPile.push(
      ...p.hearthHand,
      ...p.hearthDeck,
      ...p.board.map((minion) => ({ id: minion.cardId, effectId: minion.effectId }))
    );
    p.hearthHand = [];
    p.hearthDeck = [];
    p.board = [];
    p.active = false;
    p.free = 0;
    p.frozen = 0;
    p.pendingDraw = 0;
    p.pendingDrawMin = 0;
    p.roulettePending = false;
    p.rouletteDrawer = null;
    p.rouletteTransfer = 0;
    p.heroPowerUses = 0;
    p.shield = 0;
    p.unoAlert = false;
    events.push({ type: 'playerEliminated', player, cardCount });
    state.log.push(`玩家 ${player} 手牌达到 ${cardCount} 张，触发慈悲规则淘汰`);
  }
  const active = state.players
    .map((player, index) => (player.active ? index : -1))
    .filter((index) => index >= 0);
  if (active.length === 1 && state.phase !== 'gameOver') {
    state.pendingUnoWinners = [];
    state.phase = 'gameOver';
    events.push({ type: 'gameOver', winner: active[0]!, reason: 'lastStanding' });
  }
}

function queueUnoWinCandidate(state: GameState, player: number): void {
  if (!state.pendingUnoWinners.includes(player)) state.pendingUnoWinners.push(player);
}

/** 罚抽可继续叠加、或颜色轮盘尚未完成时，任何清空手牌都只是候选胜利。 */
function hasUnresolvedUnoEffect(state: GameState): boolean {
  return state.players.some(
    (player) =>
      player.active &&
      (player.pendingDrawMin > 0 || player.roulettePending || player.rouletteTransfer > 0)
  );
}

function settlePendingUnoWin(state: GameState, events: GameEvent[]): boolean {
  state.pendingUnoWinners = state.pendingUnoWinners.filter((player) => {
    const candidate = state.players[player];
    return Boolean(candidate?.active && candidate.hand.length === 0);
  });
  if (
    state.phase === 'gameOver' ||
    state.pendingUnoWinners.length === 0 ||
    hasUnresolvedUnoEffect(state)
  )
    return false;
  const winner = state.pendingUnoWinners[0]!;
  state.pendingUnoWinners = [];
  state.phase = 'gameOver';
  events.push({ type: 'gameOver', winner, reason: 'unoEmpty' });
  return true;
}
