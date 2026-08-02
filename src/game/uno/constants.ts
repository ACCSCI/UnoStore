import type { UnoColor } from './types';

/** 四色 */
export const UNO_COLORS = ['red', 'yellow', 'green', 'blue'] as const;

/** No Mercy 数字牌：0-9 每色各 2 张。 */
export const UNO_NUMBERS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** 功能牌：含同色清场 ColorDump 与无色的 Nomercy MassSkip。 */
export const UNO_ACTIONS = [
  'skip',
  'reverse',
  'draw2',
  'draw4',
  'wild',
  'wildDraw4',
  'massSkip',
  'colorDump',
  'wildReverseDraw4',
  'wildDraw6',
  'wildDraw10',
  'wildColorRoulette',
] as const;

export type UnoAction = (typeof UNO_ACTIONS)[number];

/** 每种颜色的功能牌数量 */
export const UNO_ACTION_COUNTS: Record<UnoAction, number> = {
  skip: 3,
  reverse: 3,
  draw2: 3,
  draw4: 2,
  wild: 0, // wild 不计入彩色（见 wildCounts）
  wildDraw4: 0,
  massSkip: 2,
  colorDump: 3,
  wildReverseDraw4: 0,
  wildDraw6: 0,
  wildDraw10: 0,
  wildColorRoulette: 0,
};

/** 每种颜色的数字牌数量（No Mercy 中 0-9 均为 2 张）。 */
export const UNO_NUMBER_COUNTS: Record<(typeof UNO_NUMBERS)[number], number> = {
  '0': 2,
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

/** No Mercy 的四类万能功能牌。 */
export const WILD_COUNTS: Record<
  'wildReverseDraw4' | 'wildDraw6' | 'wildDraw10' | 'wildColorRoulette',
  number
> = {
  wildReverseDraw4: 8,
  wildDraw6: 4,
  wildDraw10: 4,
  wildColorRoulette: 8,
};

/** UNO Show 'Em No Mercy 官方核心牌堆。 */
export const UNO_DECK_SIZE = 168;

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
export const INITIAL_UNO_HAND = 5;

/** 初始炉石手牌数 */
export const INITIAL_HEARTH_HAND = 3;

/** 每回合抽取的 Uno 牌数（turnStart） */
export const DRAW_PER_TURN = 1;

/** 混合玩法沿用结束回合自动抽 1 张。 */
export const DRAW_WHEN_STUCK = 1;

/** 每回合默认 Uno 行动次数（1 次 + MassSkip 可 +1） */
export const UNO_ACTIONS_PER_TURN = 1;

/** 未报牌罚抽数 */
export const UNO_PENALTY_DRAW = 4;

/** No Mercy：手牌达到 25 张立即淘汰。 */
export const MERCY_HAND_LIMIT = 25;

export type { UnoColor };
