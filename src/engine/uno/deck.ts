import { UNO_CARD_COUNTS, UNO_COLORS, UNO_VALUES } from './constants';
import type { UnoCard, UnoColor, UnoValue } from './types';

/**
 * 生成一副标准 Uno 数字牌堆（76 张：0 各 1 张，1-9 各 2 张）。
 * 牌堆未洗牌，调用方自行 shuffle。
 */
export function createUnoDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  let n = 0;
  for (const color of UNO_COLORS) {
    for (const value of UNO_VALUES) {
      const valueStr = value as UnoValue;
      const count = UNO_CARD_COUNTS[valueStr];
      for (let i = 0; i < count; i++) {
        deck.push({ id: `u-${n++}`, color: color as UnoColor, value: valueStr });
      }
    }
  }
  return deck;
}
