import type { GameAction, GameState } from '../core/state';

/**
 * AI 策略接口：与规则引擎完全解耦。
 * AI 只做决策（返回行动），由外部循环 dispatch 执行 —— 引擎永远校验合法性。
 */
export interface AiStrategy {
  id: string;
  /** 当前状态下选择一步行动（返回 null 表示无可用行动） */
  decide(state: GameState, player: number): GameAction | null;
}

/** Boss 特殊规则（可注入任何 AI，见 story/bosses.ts） */
export interface BossRules {
  id: string;
  name: string;
  /** 回合开始时的额外水晶（直接进 free） */
  bonusCrystalPerTurn?: number;
  /** 开场额外手牌 */
  bonusHandCards?: number;
  /** 每回合额外 Uno 行动 */
  extraUnoActions?: number;
  /** 描述（剧情展示用） */
  description: string;
}
