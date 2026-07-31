import { getEffect } from '../hearth/effects/registry';
import {
  INITIAL_HEARTH_HAND,
  INITIAL_UNO_HAND,
  UNO_ACTIONS_PER_TURN,
  UNO_PENALTY_DRAW,
  unoCrystalValue,
} from '../uno/constants';
import { canPlayOn, createUnoDeck } from '../uno/deck';
import type { UnoAction, UnoCard } from '../uno/types';
import type { ActionResult, GameEvent } from './events';
import {
  advanceTurn,
  canPlayAny,
  checkUnoAlert,
  drawPublic,
  drawTurnCards,
  nextActiveFrom,
} from './flow';
import { Rng } from './rng';
import type { GameAction, GameState, HearthCard, PlayerState } from './state';

/**
 * 规则引擎核心：createGame 建局，dispatch 处理行动。
 * 全部为纯函数（state + rng 注入），可序列化、可重放、可联机同步。
 */

/** 构建一副私人炉石牌堆（按 effectId 列表洗牌） */
function buildHearthDeck(effectIds: string[], rng: Rng): HearthCard[] {
  return rng.shuffle(effectIds.map((id, i) => ({ id: `h-${i}`, effectId: id })));
}

/** 创建一局游戏：每人 7 Uno + 3 炉石；seed 决定整局（可复现） */
export function createGame(playerCount: number, hearthEffectIds: string[], seed = 42): GameState {
  const rng = new Rng(seed);
  const players: PlayerState[] = [];
  for (let i = 0; i < playerCount; i++) {
    const deck = buildHearthDeck(hearthEffectIds, rng);
    players.push({
      hand: [],
      hearthHand: deck.slice(0, INITIAL_HEARTH_HAND),
      hearthDeck: deck.slice(INITIAL_HEARTH_HAND),
      hearthPile: [],
      free: 0,
      frozen: 0,
      pendingDraw: 0,
      shield: 0,
      unoAlert: false,
      active: true,
    });
  }
  const unoDeck = rng.shuffle(createUnoDeck());
  // 开局顶牌必须有色（wild 类重弹，避免开局无颜色）
  let top = unoDeck.pop()!;
  while (top.color === null && unoDeck.length > 0) top = unoDeck.pop()!;
  const state: GameState = {
    players,
    unoDraw: unoDeck,
    unoDiscard: [top],
    turn: 0,
    direction: 1,
    phase: 'playUno',
    topCard: top,
    chosenColor: top.color,
    unoActionsLeft: UNO_ACTIONS_PER_TURN,
    massSkipUsed: false,
    skipQueue: [],
    pendingEvents: [],
    log: [],
  };
  // 发牌：每人 7 张
  for (let i = 0; i < INITIAL_UNO_HAND; i++) {
    for (let p = 0; p < playerCount; p++) {
      const c = state.unoDraw.pop();
      if (c) players[p]!.hand.push(c);
    }
  }
  state.pendingEvents.push({ type: 'gameStart' });
  startTurn(state, rng, 0);
  state.log.push(`对局开始：${playerCount} 人，seed=${seed}`);
  return state;
}

/** 行动分发：校验合法性 → 执行 → 产出事件 */
export function dispatch(state: GameState, rng: Rng, action: GameAction): ActionResult {
  if (state.phase === 'gameOver') return { ok: false, error: '对局已结束' };
  const p = state.players[action.player];
  if (!p?.active) return { ok: false, error: '无效玩家' };
  switch (action.type) {
    case 'playUno':
      return playUnoAction(state, action);
    case 'playHearth':
      return playHearthAction(state, rng, action);
    case 'drawUno':
      return drawUnoAction(state, rng, action);
    case 'endTurn':
      return endTurnAction(state, rng, action);
  }
}

/** 打 Uno 牌 */
function playUnoAction(
  state: GameState,
  action: Extract<GameAction, { type: 'playUno' }>
): ActionResult {
  if (action.player !== state.turn) return { ok: false, error: '不是你的回合' };
  if (state.unoActionsLeft <= 0) return { ok: false, error: '本回合 Uno 行动已用完' };
  const p = state.players[action.player]!;
  const card = p.hand[action.cardIdx];
  if (!card) return { ok: false, error: '无效的牌' };
  if (!canPlayOn(card, state.topCard, state.chosenColor))
    return { ok: false, error: '这张牌不能打出' };
  const events: GameEvent[] = [];
  // 出牌
  p.hand.splice(action.cardIdx, 1);
  state.unoDiscard.push(card);
  state.topCard = card;
  let crystal = 0;
  if (card.color !== null && /^\d$/.test(card.value)) {
    crystal = unoCrystalValue(card.value);
    p.frozen += crystal; // 冻结（本回合不可用，回合结束解冻）
    state.chosenColor = card.color;
  } else {
    // 功能牌：不产水晶
    applyUnoAction(state, action.player, card.value as UnoAction, action.color);
  }
  events.push({
    type: 'unoPlayed',
    player: action.player,
    cardId: card.id,
    crystalFrozen: crystal,
  });
  checkUnoAlert(state, action.player, events);
  // 出完 → 获胜（未报牌出空 → 罚抽 4）
  if (p.hand.length === 0) {
    if (!p.unoAlert) {
      p.pendingDraw += UNO_PENALTY_DRAW;
      events.push({ type: 'unoCaught', player: action.player, penalty: UNO_PENALTY_DRAW });
    }
    state.phase = 'gameOver';
    events.push({ type: 'gameOver', winner: action.player });
  } else {
    state.unoActionsLeft -= 1;
  }
  state.pendingEvents.push(...events);
  return { ok: true, events };
}

/** 应用 Uno 功能牌效果 */
function applyUnoAction(
  state: GameState,
  player: number,
  action: UnoAction,
  color?: UnoCard['color']
): void {
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
      addPenalty(state, nextActiveFrom(state, state.turn), 2);
      state.log.push(`玩家 ${player} 打出 +2`);
      break;
    case 'wild':
      state.chosenColor = color ?? null;
      state.log.push(`玩家 ${player} 打出变色`);
      break;
    case 'wildDraw4':
      state.chosenColor = color ?? null;
      addPenalty(state, nextActiveFrom(state, state.turn), 4);
      state.log.push(`玩家 ${player} 打出 +4`);
      break;
    case 'massSkip': {
      // Nomercy：所有其他活跃玩家各跳过 1 次（含 2 人局 —— 对手被跳过，自己连续行动）。
      // 跳过 ≥1 人时额外获得 1 次 Uno 行动（2 人局跳过 1 人同样给：自己连续两回合）。
      state.chosenColor = color ?? null;
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
  }
}

/** 给玩家加罚抽（护盾抵消） */
function addPenalty(state: GameState, player: number, count: number): void {
  const p = state.players[player]!;
  if (p.shield > 0) {
    p.shield -= 1;
    state.log.push(`玩家 ${player} 护盾抵消 ${count} 张罚抽`);
  } else {
    p.pendingDraw += count;
  }
}

/** 打炉石牌：扣 free 水晶 + 执行 effect */
function playHearthAction(
  state: GameState,
  rng: Rng,
  action: Extract<GameAction, { type: 'playHearth' }>
): ActionResult {
  if (action.player !== state.turn) return { ok: false, error: '不是你的回合' };
  const p = state.players[action.player]!;
  const card = p.hearthHand[action.cardIdx];
  if (!card) return { ok: false, error: '无效的牌' };
  const effect = getEffect(card.effectId);
  if (!effect) return { ok: false, error: '未知的效果' };
  if (p.free < effect.cost) return { ok: false, error: '水晶不足' };
  p.free -= effect.cost;
  p.hearthHand.splice(action.cardIdx, 1);
  p.hearthPile.push(card);
  effect.apply({ state, source: action.player, targets: action.targets, color: action.color, rng });
  const event: GameEvent = {
    type: 'hearthPlayed',
    player: action.player,
    cardId: card.id,
    cost: effect.cost,
  };
  state.pendingEvents.push(event);
  state.log.push(`玩家 ${action.player} 打出炉石牌 ${effect.name}（${effect.cost} 水晶）`);
  return { ok: true, events: [event] };
}

/** 打不出时抽 1 即止（抽后不能再打 Uno） */
function drawUnoAction(
  state: GameState,
  rng: Rng,
  action: Extract<GameAction, { type: 'drawUno' }>
): ActionResult {
  if (action.player !== state.turn) return { ok: false, error: '不是你的回合' };
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
  state.pendingEvents.push(event);
  return { ok: true, events: [event] };
}

/** 结束回合：冻结解冻 → 推进 → 下一人开始 */
function endTurnAction(
  state: GameState,
  rng: Rng,
  action: Extract<GameAction, { type: 'endTurn' }>
): ActionResult {
  if (action.player !== state.turn) return { ok: false, error: '不是你的回合' };
  const p = state.players[action.player]!;
  p.free += p.frozen; // 冻结叠加解冻
  p.frozen = 0;
  p.shield = 0;
  const event: GameEvent = { type: 'endTurn', player: action.player };
  state.pendingEvents.push(event);
  const next = advanceTurn(state);
  startTurn(state, rng, next);
  return { ok: true, events: [event] };
}

/** 开始某玩家回合：罚抽 → 抽 1 Uno + 1 炉石 → 重置行动 */
function startTurn(state: GameState, rng: Rng, player: number): void {
  const p = state.players[player]!;
  if (p.pendingDraw > 0) {
    const drawn = drawPublic(state, rng, p.pendingDraw);
    p.hand.push(...drawn);
    state.pendingEvents.push({
      type: 'drawPenalty',
      player,
      count: drawn.length,
      cardIds: drawn.map((c) => c.id),
    });
    p.pendingDraw = 0;
  }
  const { uno, hearth } = drawTurnCards(state, rng, player);
  state.pendingEvents.push({
    type: 'turnStart',
    player,
    drawUno: uno.join(','),
    drawHearth: hearth?.id ?? null,
  });
  state.turn = player;
  state.unoActionsLeft = UNO_ACTIONS_PER_TURN;
  state.massSkipUsed = false;
  state.phase = 'playUno';
  state.log.push(`玩家 ${player} 回合开始`);
}
