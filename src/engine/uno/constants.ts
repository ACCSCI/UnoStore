import type { UnoValue } from './types';

export const UNO_COLORS = ['red', 'yellow', 'green', 'blue'] as const;

export const UNO_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** 每个颜色每种数字牌的数量（0 一张，1-9 各两张，标准 Uno 构成） */
export const UNO_CARD_COUNTS: Record<UnoValue, number> = {
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

export const UNO_DECK_SIZE = 76;
