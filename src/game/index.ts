import { EasyRandom, HardCombo, NormalHeuristic } from './ai/strategies';
import type { ActionResult, GameEvent } from './core/events';
import { createGame, dispatch } from './core/reducer';
import { Rng } from './core/rng';
import type { GameAction, GameState } from './core/state';
import { getDeck, PRESET_DECKS } from './hearth/decks';
import { canPlayOn, createUnoDeck } from './uno/deck';
import './hearth/cards';

export type { AiStrategy, BossRules } from './ai/types';
export type { ActionResult, GameAction, GameEvent, GameState };
export {
  canPlayOn,
  createGame,
  createUnoDeck,
  dispatch,
  EasyRandom,
  getDeck,
  HardCombo,
  NormalHeuristic,
  PRESET_DECKS,
  Rng,
};

/** 便捷：带默认牌组的建局 */
export function createDefaultGame(playerCount: number, seed = 42): GameState {
  return createGame(playerCount, getDeck('combo').cardIds, seed);
}

/** 便捷：取当前行动玩家的可打 Uno 手牌索引 */
export function playableUnoIndices(state: GameState): number[] {
  const hand = state.players[state.turn]!.hand;
  return hand
    .map((c, i) => (canPlayOn(c, state.topCard, state.chosenColor) ? i : -1))
    .filter((i) => i >= 0);
}
