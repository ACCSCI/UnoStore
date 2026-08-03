import { DRAW_WHEN_STUCK } from '../uno/constants';
import { canPlayOn, createUnoDeck } from '../uno/deck';
import type { UnoCard } from '../uno/types';
import type { GameEvent } from './events';
import type { GameState } from './state';

/**
 * 回合流程辅助：抽牌、推进、报牌。
 * 所有函数都假定 state 已处于合法状态，由 reducer 负责校验行动合法性。
 */

/** 从公共牌堆抽 n 张；不足时把弃牌堆（除顶牌）洗回牌堆 */
export function drawPublic(
  state: GameState,
  rng: { shuffle<T>(arr: T[]): T[] },
  n: number
): UnoCard[] {
  const out: UnoCard[] = [];
  for (let i = 0; i < n; i++) {
    // 牌堆耗尽时：把弃牌堆（除顶牌）洗回牌堆
    if (state.unoDraw.length === 0 && (state.unoDiscard.length > 1 || state.mercyPile.length > 0)) {
      const top = state.unoDiscard.pop()!;
      state.unoDraw.push(...rng.shuffle([...state.unoDiscard, ...state.mercyPile]));
      state.unoDiscard = [top];
      state.mercyPile = [];
    }
    // 连弃牌都只剩顶牌时，生成新的一副牌。代数后缀保证实例 ID 唯一。
    if (state.unoDraw.length === 0) {
      state.unoCycle += 1;
      const regenerated = createUnoDeck().map((card) => ({
        ...card,
        id: `${card.id}-r${state.unoCycle}`,
      }));
      state.unoDraw.push(...rng.shuffle(regenerated));
      state.log.push(`UNO 牌库第 ${state.unoCycle} 次重建`);
    }
    const c = state.unoDraw.pop();
    if (c) out.push(c);
  }
  return out;
}

/** 从 from 沿当前方向找下一个活跃玩家 */
export function nextActiveFrom(state: GameState, from: number): number {
  const n = state.players.length;
  for (let k = 0; k < n; k++) {
    const i = (from + state.direction * (k + 1) + n * 2) % n;
    if (state.players[i]!.active) return i;
  }
  return from;
}

/** 当前玩家的下一个活跃玩家 */
export function nextActive(state: GameState): number {
  return nextActiveFrom(state, state.turn);
}

/** 推进 turn 到下一活跃玩家（skipQueue 由 beginTurn 在回合开始前消费） */
export function advanceTurn(state: GameState): number {
  return nextActive(state);
}

/** 回合开始前消费 skipQueue：每张 skip 跳过一个玩家（最多全部玩家） */
export function beginTurn(state: GameState, skipped: number[] = []): number {
  let next = nextActive(state);
  while (state.skipQueue.length > 0) {
    state.skipQueue.shift();
    skipped.push(next);
    next = nextActiveFrom(state, next);
  }
  return next;
}

/** 自动报牌：手牌剩 1 张时触发一次 */
export function checkUnoAlert(state: GameState, player: number, events: GameEvent[]): void {
  const p = state.players[player]!;
  if (p.hand.length === 1 && !p.unoAlert) {
    p.unoAlert = true;
    events.push({ type: 'unoAlert', player });
  }
}

/** 手牌有任意可出的牌 */
export function canPlayAny(state: GameState, player: number): boolean {
  return state.players[player]!.hand.some((card) => canPlayUnoCard(state, player, card));
}

/** 加牌数值；普通牌为 0。 */
export function drawStackValue(card: UnoCard): 0 | 2 | 4 | 6 | 10 {
  if (card.value === 'draw2') return 2;
  if (['draw4', 'wildDraw4', 'wildReverseDraw4'].includes(card.value)) return 4;
  if (card.value === 'wildDraw6') return 6;
  if (card.value === 'wildDraw10') return 10;
  return 0;
}

/** 带罚抽链约束的统一 UNO 合法性判断，供规则、AI 与 UI 共用。 */
export function canPlayUnoCard(state: GameState, player: number, card: UnoCard): boolean {
  if (state.players[player]?.roulettePending) return false;
  const rouletteTransfer = state.players[player]?.rouletteTransfer ?? 0;
  if (rouletteTransfer > 0) return drawStackValue(card) > 0;
  const pendingMin = state.players[player]?.pendingDrawMin ?? 0;
  if (pendingMin > 0) {
    return drawStackValue(card) >= pendingMin;
  }
  if (state.unoActionsLeft <= 0) return false;
  return canPlayOn(card, state.topCard, state.chosenColor);
}

/** 打不出时抽 1 即止 */
export function drawStuck(state: GameState, rng: { shuffle<T>(arr: T[]): T[] }): boolean {
  const drawn = drawPublic(state, rng, DRAW_WHEN_STUCK);
  if (drawn.length === 0) return false;
  state.players[state.turn]!.hand.push(...drawn);
  return true;
}
