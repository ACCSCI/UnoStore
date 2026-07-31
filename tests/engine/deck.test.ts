import { expect, test } from 'bun:test';

import { createUnoDeck } from '../../src/engine';

test('标准 Uno 数字牌堆为 76 张', () => {
  expect(createUnoDeck()).toHaveLength(76);
});

test('每种颜色的 0 只有 1 张，1-9 各 2 张', () => {
  const deck = createUnoDeck();
  for (const color of ['red', 'yellow', 'green', 'blue']) {
    const ofColor = deck.filter((c) => c.color === color);
    expect(ofColor.filter((c) => c.value === '0')).toHaveLength(1);
    for (let v = 1; v <= 9; v++) {
      const value = String(v) as '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
      expect(ofColor.filter((c) => c.value === value)).toHaveLength(2);
    }
  }
});
