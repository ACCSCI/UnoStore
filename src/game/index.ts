import { EasyRandom, HardCombo, NormalHeuristic } from './ai/strategies';
import type { ActionResult, GameEvent } from './core/events';
import { canPlayUnoCard } from './core/flow';
import {
  canInitiateHearthPlay,
  createGame,
  dispatch,
  hearthPlayError,
  heroPowerCost,
  heroPowerError,
} from './core/reducer';
import { Rng } from './core/rng';
import type { GameAction, GameState } from './core/state';
import { getDeck, PRESET_DECKS } from './hearth/decks';
import { canPlayOn, createUnoDeck } from './uno/deck';
import './hearth/cards';

export type { AiStrategy, BossRules } from './ai/types';
export type { HeroDefinition, HeroId } from './heroes';
export { DEFAULT_HERO_ID, getHero, HEROES } from './heroes';
export type { LoadoutProfile, SavedHearthDeck } from './loadout';
export {
  activeDeck,
  battleDeckSizeIssue,
  createDeckId,
  loadLoadoutProfile,
  MAX_CARD_COPIES,
  MAX_CUSTOM_DECK_SIZE,
  MIN_CUSTOM_DECK_SIZE,
  saveLoadoutProfile,
} from './loadout';
export type { ActionResult, GameAction, GameEvent, GameState };
export {
  canInitiateHearthPlay,
  canPlayOn,
  createGame,
  createUnoDeck,
  dispatch,
  EasyRandom,
  getDeck,
  HardCombo,
  hearthPlayError,
  heroPowerCost,
  heroPowerError,
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
    .map((card, index) => (canPlayUnoCard(state, state.turn, card) ? index : -1))
    .filter((i) => i >= 0);
}
