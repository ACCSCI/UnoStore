import { expect, test } from 'bun:test';

import { createUnoDeck } from '../../src/game';

test('标准 Uno 牌堆为 110 张（108 标准 + 2 MassSkip）', () => {
  expect(createUnoDeck()).toHaveLength(110);
});

test('每种颜色的 0 只有 1 张，1-9 各 2 张', () => {
  const deck = createUnoDeck();
  for (const color of ['red', 'yellow', 'green', 'blue']) {
    const ofColor = deck.filter((c) => c.color === color);
    expect(ofColor.filter((c) => c.value === '0')).toHaveLength(1);
    for (let v = 1; v <= 9; v++) {
      const value = String(v);
      expect(ofColor.filter((c) => c.value === value)).toHaveLength(2);
    }
  }
});

test('Wild / WildDraw4 各 4 张且无色', () => {
  const deck = createUnoDeck();
  expect(deck.filter((c) => c.value === 'wild')).toHaveLength(4);
  expect(deck.filter((c) => c.value === 'wildDraw4')).toHaveLength(4);
  for (const c of deck.filter((c) => c.value === 'wild' || c.value === 'wildDraw4')) {
    expect(c.color).toBeNull();
  }
});

test('MassSkip 2 张且无色', () => {
  const deck = createUnoDeck();
  const mass = deck.filter((c) => c.value === 'massSkip');
  expect(mass).toHaveLength(2);
  for (const c of mass) expect(c.color).toBeNull();
});
