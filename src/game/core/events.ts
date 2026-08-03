import type { UnoCard } from '../uno/types';

/** 游戏内所有事件的统一类型（渲染层、AI、联机只消费事件流） */
export type GameEvent =
  | { type: 'gameStart' }
  | { type: 'turnStart'; player: number; drawUno: string; drawHearth: string | null }
  | {
      type: 'unoPlayed';
      player: number;
      cardId: string;
      /** 公开牌面；联机客户端据此播放正确的 UNO 演出，不依赖私有手牌。 */
      card: UnoCard;
      crystalFrozen: number;
      penaltyTarget?: number;
      penaltyAdded?: number;
      penaltyTransferred?: number;
    }
  | {
      type: 'colorDump';
      player: number;
      color: string;
      count: number;
      cardIds: string[];
      crystalFrozen: number;
    }
  | { type: 'handSwap'; player: number; targetPlayer: number }
  | { type: 'handPass'; player: number; direction: 1 | -1 }
  | { type: 'playerSkipped'; player: number }
  | { type: 'playerEliminated'; player: number; cardCount: number }
  | {
      type: 'colorRoulette';
      player: number;
      color: string;
      count: number;
      cardIds: string[];
    }
  | { type: 'rouletteColorChosen'; player: number; drawer: number; color: string }
  | {
      type: 'rouletteCardDrawn';
      player: number;
      chooser: number;
      color: string;
      index: number;
      card: { id: string; color: string | null; value: string };
    }
  | {
      type: 'hearthPlayed';
      player: number;
      cardId: string;
      effectId: string;
      cost: number;
      targets?: number[];
      targetMinionId?: string;
    }
  | { type: 'heroPowerUsed'; player: number; heroId: string; cost: number; targets: number[] }
  | { type: 'heroEmote'; player: number; heroId: string; emoteId: string; text: string }
  | {
      type: 'heroCardsDiscarded';
      player: number;
      unoCardIds: string[];
      hearthCardIds: string[];
      reason?: string;
    }
  | { type: 'handsRemixed'; player: number; first: number; second: number }
  | {
      type: 'cardsGifted';
      player: number;
      targetPlayer: number;
      unoCardIds: string[];
      hearthCardIds: string[];
    }
  | { type: 'hearthDrawn'; player: number; cardIds: string[]; reason: string }
  | {
      type: 'mixedCardsDrawn';
      player: number;
      unoCardIds: string[];
      hearthCardIds: string[];
    }
  | { type: 'battlecry'; player: number; minionId: string; effectId: string }
  | { type: 'deathrattle'; player: number; minionId: string; effectId: string }
  | { type: 'unoDiscarded'; player: number; cardIds: string[]; reason: string }
  | {
      type: 'handRevealed';
      player: number;
      targetPlayer: number;
      cards: Array<{ id: string; color: string | null; value: string }>;
      chooseTakeAndDiscard?: boolean;
    }
  | {
      type: 'oracleResolved';
      player: number;
      targetPlayer: number;
      takenCardId: string;
      discardedCardId: string;
    }
  | {
      type: 'minionSummoned';
      player: number;
      minionId: string;
      cardId: string;
      effectId: string;
      attack: number;
      health: number;
      /** 放置位置（战场槽位索引），供演出与位置相关效果使用 */
      position: number;
    }
  | {
      type: 'minionAttack';
      player: number;
      attackerId: string;
      attackerEffectId: string;
      targetPlayer: number;
      targetMinionId?: string;
      attackDamage: number;
      counterDamage?: number;
      drawCount: number;
      discardCount?: number;
    }
  | {
      type: 'minionTransformed';
      player: number;
      targetPlayer: number;
      minionId: string;
      fromEffectId: string;
      toEffectId: string;
    }
  | {
      type: 'minionEmpowered';
      player: number;
      targetPlayer: number;
      minionId: string;
      stat: 'attack' | 'health';
      before: number;
      after: number;
    }
  | {
      type: 'minionBuffed';
      player: number;
      minionId: string;
      attackDelta: number;
      healthDelta: number;
      taunt: boolean;
    }
  | {
      type: 'minionsEqualized';
      player: number;
      affected: Array<{
        targetPlayer: number;
        minionId: string;
        beforeAttack: number;
        beforeHealth: number;
        beforeMaxHealth: number;
      }>;
    }
  | { type: 'minionDestroyed'; player: number; minionId: string }
  | { type: 'minionBoardsPassed'; player: number; direction: 1 | -1 }
  | {
      type: 'minionsExchanged';
      player: number;
      first: number;
      second: number;
      mode: 'one' | 'all';
      minionIds: string[];
    }
  | {
      type: 'minionsRedistributed';
      player: number;
      assignments: Array<{ minionId: string; from: number; to: number }>;
    }
  | {
      type: 'minionTriggered';
      player: number;
      minionId: string;
      effectId: string;
      trigger: 'turnStart' | 'turnEnd' | 'anyTurnStart';
    }
  | {
      type: 'penaltyRedirected';
      player: number;
      minionId: string;
      effectId: string;
      amount: number;
    }
  | { type: 'penaltyPrevented'; player: number; amount: number; reason: string }
  | { type: 'drawUno'; player: number; cardId: string }
  | { type: 'drawPenalty'; player: number; count: number; cardIds: string[] }
  | { type: 'unoAlert'; player: number }
  | { type: 'unoCaught'; player: number; penalty: number }
  | { type: 'massSkip'; player: number }
  | { type: 'endTurn'; player: number }
  | { type: 'gameOver'; winner: number; reason: 'unoEmpty' | 'lastStanding' };

/** 行动结果的统一返回：合法行动产出事件，非法行动返回错误 */
export type ActionResult = { ok: true; events: GameEvent[] } | { ok: false; error: string };
