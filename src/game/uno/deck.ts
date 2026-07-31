import {
  MASS_SKIP_COUNT,
  UNO_ACTION_COUNTS,
  UNO_COLORS,
  UNO_NUMBER_COUNTS,
  UNO_NUMBERS,
  WILD_COUNTS,
} from './constants';
import type { UnoAction, UnoCard, UnoColor, UnoValue } from './types';

/**
 * 生成标准 Uno 牌堆（108 张）：
 * - 数字牌：每色 0×1 + 1-9×2 = 19 张 × 4 色 = 76
 * - 彩色功能牌：每色 skip/reverse/draw2 各 2 张 = 24 张
 * - Wild × 4 + WildDraw4 × 4 = 8
 * - MassSkip × 2（Nomercy 变体，共 110 张）
 * 未洗牌，调用方自行 shuffle。
 */
export function createUnoDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  let n = 0;
  for (const color of UNO_COLORS) {
    for (const value of UNO_NUMBERS) {
      const count = UNO_NUMBER_COUNTS[value];
      for (let i = 0; i < count; i++) {
        deck.push({ id: `u-${n++}`, color: color as UnoColor, value: value as UnoValue });
      }
    }
    for (const action of ['skip', 'reverse', 'draw2'] as const) {
      const count = UNO_ACTION_COUNTS[action];
      for (let i = 0; i < count; i++) {
        deck.push({ id: `u-${n++}`, color: color as UnoColor, value: action as UnoAction });
      }
    }
  }
  for (const wild of ['wild', 'wildDraw4'] as const) {
    const count = WILD_COUNTS[wild];
    for (let i = 0; i < count; i++) {
      deck.push({ id: `u-${n++}`, color: null, value: wild as UnoAction });
    }
  }
  for (let i = 0; i < MASS_SKIP_COUNT; i++) {
    deck.push({ id: `u-${n++}`, color: null, value: 'massSkip' as UnoAction });
  }
  return deck;
}

/** 花色可匹配判断：颜色相同 或 数字/功能相同 或 该牌为 Wild 类 */
export function canPlayOn(
  card: UnoCard,
  top: UnoCard | null,
  currentColor: UnoColor | null
): boolean {
  if (!top) return true;
  if (card.color === null) return true; // wild 类万能
  if (card.color === currentColor) return true;
  if (card.value === top.value) return true;
  return false;
}
