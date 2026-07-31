import type { UnoCard } from '../uno/types';
import type { GameEvent } from './events';

/** Boss 特殊规则（剧情模式）：玩家 index → 规则 */
export interface BossRules {
  /** 每回合开始额外获得的水晶（直接进 free） */
  bonusCrystalPerTurn?: number;
  /** 每回合额外 Uno 行动 */
  extraUnoActions?: number;
}

export type BossRulesMap = Record<number, BossRules>;

/** 游戏阶段 */
export type GamePhase = 'playUno' | 'playHearth' | 'gameOver';

/** 玩家状态 */
export interface PlayerState {
  hand: UnoCard[];
  hearthHand: HearthCard[];
  /** 私人炉石牌堆（顶在末尾） */
  hearthDeck: HearthCard[];
  hearthPile: HearthCard[];
  /** 可用水晶（解冻后） */
  free: number;
  /** 冻结水晶（打出 Uno 数字牌获得，回合结束叠加进 free） */
  frozen: number;
  /** 待罚抽（+2/+4 叠加） */
  pendingDraw: number;
  /** 魔法护盾层数（抵消罚抽，回合结束清零） */
  shield: number;
  /** 已报 UNO */
  unoAlert: boolean;
  active: boolean;
}

/** 炉石牌实例（手牌/牌堆中） */
export interface HearthCard {
  id: string;
  effectId: string;
}

/** 游戏状态（可 JSON 序列化 + 确定性） */
export interface GameState {
  players: PlayerState[];
  /** 公共 Uno 牌堆（顶在末尾） */
  unoDraw: UnoCard[];
  /** 弃牌堆（顶在末尾） */
  unoDiscard: UnoCard[];
  /** Boss 特殊规则（玩家 index → 规则，剧情模式用） */
  bossRules: BossRulesMap;
  /** 当前行动玩家 index */
  turn: number;
  direction: 1 | -1;
  phase: GamePhase;
  /** 当前顶牌（弃牌堆末张） */
  topCard: UnoCard;
  /** 当前颜色（Wild 选色后） */
  chosenColor: UnoCard['color'];
  /** 本回合 Uno 行动余量（1 + MassSkip 奖励） */
  unoActionsLeft: number;
  /** 本回合是否已触发过 MassSkip 额外行动 */
  massSkipUsed: boolean;
  /** 待跳过计数（skip/massSkip 累积，nextActiveFrom 消费） */
  skipQueue: number[];
  /** 行动产出的事件（按序消费） */
  pendingEvents: GameEvent[];
  /** 对局记录（调试/重放） */
  log: string[];
}

/** 玩家行动（统一入口） */
export type GameAction =
  | { type: 'playUno'; player: number; cardIdx: number; color?: UnoCard['color'] }
  | {
      type: 'playHearth';
      player: number;
      cardIdx: number;
      targets?: number[];
      color?: string | null;
    }
  | { type: 'drawUno'; player: number }
  | { type: 'endTurn'; player: number };
