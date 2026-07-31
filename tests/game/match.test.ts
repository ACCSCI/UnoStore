import { expect, test } from 'bun:test';

import { canPlayOn } from '../../src/game/uno/deck';
import type { UnoCard } from '../../src/game/uno/types';

/**
 * 出牌匹配规则钉死：
 * 1. 同颜色（不管符号）→ 可打
 * 2. 同符号（不管颜色）→ 可打
 * 3. 颜色和符号都不匹配 → 不可打
 * 4. Wild 类万能 → 可打
 */

function card(color: UnoCard['color'], value: UnoCard['value']): UnoCard {
  return { id: 't', color, value };
}

const TOP_RED_5 = card('red', '5');
const CURRENT_RED: UnoCard['color'] = 'red';

test('同颜色异符号可打', () => {
  expect(canPlayOn(card('red', '3'), TOP_RED_5, CURRENT_RED)).toBe(true);
  expect(canPlayOn(card('red', 'skip'), TOP_RED_5, CURRENT_RED)).toBe(true);
  expect(canPlayOn(card('red', 'draw2'), TOP_RED_5, CURRENT_RED)).toBe(true);
});

test('异色同符号可打（数字牌）', () => {
  expect(canPlayOn(card('blue', '5'), TOP_RED_5, CURRENT_RED)).toBe(true);
  expect(canPlayOn(card('green', '5'), TOP_RED_5, CURRENT_RED)).toBe(true);
  expect(canPlayOn(card('yellow', '5'), TOP_RED_5, CURRENT_RED)).toBe(true);
});

test('异色同功能可打（功能牌）', () => {
  const topRedSkip = card('red', 'skip');
  expect(canPlayOn(card('blue', 'skip'), topRedSkip, 'red')).toBe(true);
  const topBlueDraw2 = card('blue', 'draw2');
  expect(canPlayOn(card('green', 'draw2'), topBlueDraw2, 'blue')).toBe(true);
});

test('颜色符号都不匹配 → 不可打', () => {
  expect(canPlayOn(card('blue', '3'), TOP_RED_5, CURRENT_RED)).toBe(false);
  expect(canPlayOn(card('green', 'skip'), TOP_RED_5, CURRENT_RED)).toBe(false);
});

test('Wild 类万能可打', () => {
  expect(canPlayOn(card(null, 'wild'), TOP_RED_5, CURRENT_RED)).toBe(true);
  expect(canPlayOn(card(null, 'wildDraw4'), TOP_RED_5, CURRENT_RED)).toBe(true);
  expect(canPlayOn(card(null, 'massSkip'), TOP_RED_5, CURRENT_RED)).toBe(true);
});

test('空顶牌 → 任意牌可打（开局）', () => {
  expect(canPlayOn(card('blue', '3'), null, null)).toBe(true);
});

test('Wild 已选色：仅同色可打（数字）', () => {
  // 顶牌 Wild 选了蓝色 → 蓝色数字可打，红色不可
  const topWild = card(null, 'wild');
  expect(canPlayOn(card('blue', '3'), topWild, 'blue')).toBe(true);
  expect(canPlayOn(card('red', '3'), topWild, 'blue')).toBe(false);
  // 但同符号仍可打（Wild 符号为 'wild'，只有 Wild 匹配）
  expect(canPlayOn(card(null, 'wild'), topWild, 'blue')).toBe(true);
});
