import type { UnoColor } from './types';

/** 四色 */
export const UNO_COLORS = ['red', 'yellow', 'green', 'blue'] as const;

/** 数字 0-9（0 各 1 张，1-9 各 2 张） */
export const UNO_NUMBERS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** 功能牌：Skip 跳过 / Reverse 反转 / Draw2 罚抽2 / Wild 变色 / WildDraw4 变色+罚抽4 / MassSkip 全员跳过(Nomercy) */
export const UNO_ACTIONS = ['skip', 'reverse', 'draw2', 'wild', 'wildDraw4', 'massSkip'] as const;

export type UnoAction = (typeof UNO_ACTIONS)[number];

/** 每种颜色的功能牌数量 */
export const UNO_ACTION_COUNTS: Record<UnoAction, number> = {
  skip: 2,
  reverse: 2,
  draw2: 2,
  wild: 0, // wild 不计入彩色（见 wildCounts）
  wildDraw4: 0,
  massSkip: 0,
};

/** 每种颜色的数字牌数量（0 各 1 张，1-9 各 2 张） */
export const UNO_NUMBER_COUNTS: Record<(typeof UNO_NUMBERS)[number], number> = {
  '0': 1,
  '1': 2,
  '2': 2,
  '3': 2,
  '4': 2,
  '5': 2,
  '6': 2,
  '7': 2,
  '8': 2,
  '9': 2,
};

/** 无色的 Wild / WildDraw4 数量 */
export const WILD_COUNTS: Record<'wild' | 'wildDraw4', number> = {
  wild: 4,
  wildDraw4: 4,
};

/** 无色的 MassSkip 数量（Nomercy 变体） */
export const MASS_SKIP_COUNT = 2;

/** 标准 Uno 牌堆：数字 76 + 彩色功能 32 = 108 */
export const UNO_DECK_SIZE = 108;

/** 数字牌点数即产出的水晶量 */
export function unoCrystalValue(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 手牌从 2 张打到 1 张时触发自动报牌 */
export const UNO_HAND_ALERT = 1;

/** 未报牌打出最后一张的罚抽数 */
export const UNO_CATCH_PENALTY = 4;

/** 初始 Uno 手牌数 */
export const INITIAL_UNO_HAND = 7;

/** 初始炉石手牌数 */
export const INITIAL_HEARTH_HAND = 3;

/** 每回合抽取的 Uno 牌数（turnStart） */
export const DRAW_PER_TURN = 1;

/** 打不出时抽 1 即止 */
export const DRAW_WHEN_STUCK = 1;

/** 每回合默认 Uno 行动次数（1 次 + MassSkip 可 +1） */
export const UNO_ACTIONS_PER_TURN = 1;

/** 未报牌罚抽数 */
export const UNO_PENALTY_DRAW = 4;

export type { UnoColor };
