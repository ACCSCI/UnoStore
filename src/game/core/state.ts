import type { HeroId } from '../heroes';
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

/** 可独立切换的对局规则，供确定性实验和房主权威房间共用。 */
export interface GameRules {
  /** 颜色轮盘抽牌后，允许出加牌把已抽数量连同加值转给下一位。 */
  rouletteStacking: boolean;
}

/** 游戏阶段 */
export type GamePhase = 'playUno' | 'playHearth' | 'gameOver';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MAX_MINIONS_PER_PLAYER = 5;

/** 已召唤到战场上的炉石随从。 */
export interface MinionState {
  id: string;
  cardId: string;
  effectId: string;
  owner: number;
  attack: number;
  health: number;
  maxHealth: number;
  /** 新召唤或本回合已经攻击过。 */
  exhausted: boolean;
  /** 效果赋予的嘲讽（区别于卡面自带 taunt；变形为绵羊时清除）。 */
  taunt?: boolean;
}

/** 玩家状态 */
export interface PlayerState {
  hand: UnoCard[];
  hearthHand: HearthCard[];
  /** 私人炉石牌堆（顶在末尾） */
  hearthDeck: HearthCard[];
  hearthPile: HearthCard[];
  /** 牌库重建用的原始牌表；炉石牌耗尽后可无限重建。 */
  hearthPool: string[];
  hearthCycle: number;
  board: MinionState[];
  /** 可用水晶（解冻后） */
  free: number;
  /** 冻结水晶（打出 Uno 数字牌获得，回合结束叠加进 free） */
  frozen: number;
  /** 待罚抽（+2/+4 叠加） */
  pendingDraw: number;
  /** UNO 加牌应对门槛：0 表示不可叠加；2/4 表示下一张加牌至少需要该数值。 */
  pendingDrawMin: 0 | 2 | 4 | 6 | 10;
  /** 被颜色轮盘命中时，必须先选择颜色并完成抽牌。 */
  roulettePending: boolean;
  /** 颜色轮盘真正承受抽牌的玩家；选色者与抽牌者可以不同。 */
  rouletteDrawer: number | null;
  /** 已经抽完、但仍可通过加牌转移给下一位的颜色轮盘数量。 */
  rouletteTransfer: number;
  heroId: HeroId;
  /** 本回合已经使用英雄技能的次数。 */
  heroPowerUses: number;
  /** 魔法护盾层数（持久保留；每次抵消罚抽消耗 1 层） */
  shield: number;
  /** 已报 UNO */
  unoAlert: boolean;
  active: boolean;
}

/** 炉石牌实例（手牌/牌堆中） */
export interface HearthCard {
  id: string;
  effectId: string;
  /** 单张卡牌实例的费用覆盖值；回声生成的复制牌固定为 0。 */
  costOverride?: number;
}

/** 游戏状态（可 JSON 序列化 + 确定性） */
export interface GameState {
  players: PlayerState[];
  /** 全场最近打出的炉石牌；回声读取旧值后，本次出牌再覆盖它。 */
  lastHearthPlayed: HearthCard | null;
  /** 回声复制牌的确定性唯一编号。 */
  hearthCopySerial: number;
  /** 公共 Uno 牌堆（顶在末尾） */
  unoDraw: UnoCard[];
  /** 弃牌堆（顶在末尾） */
  unoDiscard: UnoCard[];
  /** No Mercy 淘汰玩家的手牌，牌库重洗时重新加入。 */
  mercyPile: UnoCard[];
  /** UNO 牌库完全耗尽后的重建代数，用于生成唯一卡牌 ID。 */
  unoCycle: number;
  /** Boss 特殊规则（玩家 index → 规则，剧情模式用） */
  bossRules: BossRulesMap;
  /** 本局启用的可切换规则。 */
  rules: GameRules;
  /** 当前行动玩家 index */
  turn: number;
  direction: 1 | -1;
  phase: GamePhase;
  /** 当前顶牌（弃牌堆末张） */
  topCard: UnoCard;
  /** 当前颜色（Wild 选色后） */
  chosenColor: UnoCard['color'];
  /** 本回合 Uno 行动余量 */
  unoActionsLeft: number;
  /** 本回合是否打出过 UNO；结束回合时决定是否补抽 UNO。 */
  unoPlayedThisTurn: boolean;
  /** 单调递增的回合编号，供界面去重回合提示。 */
  turnSerial: number;
  /** 窥镜先知等待拥有者完成“拿一弃一”。 */
  oraclePending: {
    source: number;
    target: number;
    cardIds: string[];
  } | null;
  /** 已清空 UNO、但仍在等待罚抽链或颜色轮盘完成的候选胜者（按清空顺序）。 */
  pendingUnoWinners: number[];
  /** 待跳过计数（skip/massSkip 累积，nextActiveFrom 消费） */
  skipQueue: number[];
  /** 行动产出的事件（按序消费） */
  pendingEvents: GameEvent[];
  /** 对局记录（调试/重放） */
  log: string[];
}

/** 玩家行动（统一入口） */
export type GameAction =
  | {
      type: 'playUno';
      player: number;
      cardIdx: number;
      color?: UnoCard['color'];
      targetPlayer?: number;
    }
  | {
      type: 'playHearth';
      player: number;
      cardIdx: number;
      targets?: number[];
      targetMinionId?: string;
      unoCardIds?: string[];
      cardIds?: string[];
      color?: string | null;
      /** 随从放置位置（战场槽位索引，默认追加到末尾） */
      position?: number;
    }
  | { type: 'drawUno'; player: number }
  | { type: 'resolveRoulette'; player: number; color: NonNullable<UnoCard['color']> }
  | { type: 'useHeroPower'; player: number; targets?: number[]; unoCardIds?: string[] }
  | { type: 'resolveOracle'; player: number; takeCardId: string; discardCardId: string }
  | { type: 'heroEmote'; player: number; emoteId: string }
  | {
      type: 'attackMinion';
      player: number;
      attackerId: string;
      targetPlayer: number;
      targetMinionId?: string;
    }
  | { type: 'endTurn'; player: number };
