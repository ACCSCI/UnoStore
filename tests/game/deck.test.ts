import { expect, test } from 'bun:test';

import { createUnoDeck } from '../../src/game';
import { PRESET_DECKS } from '../../src/game/hearth/decks';

test('UNO Show Em No Mercy 核心牌堆为 168 张', () => {
  expect(createUnoDeck()).toHaveLength(168);
});

test('每种颜色的 0-9 均为 2 张', () => {
  const deck = createUnoDeck();
  for (const color of ['red', 'yellow', 'green', 'blue']) {
    const ofColor = deck.filter((card) => card.color === color);
    for (let value = 0; value <= 9; value++) {
      expect(ofColor.filter((card) => card.value === String(value))).toHaveLength(2);
    }
  }
});

test('每色彩色功能牌数量符合 No Mercy 牌表', () => {
  const deck = createUnoDeck();
  for (const color of ['red', 'yellow', 'green', 'blue']) {
    const count = (value: string): number =>
      deck.filter((card) => card.color === color && card.value === value).length;
    expect(count('skip')).toBe(3);
    expect(count('reverse')).toBe(3);
    expect(count('draw2')).toBe(3);
    expect(count('draw4')).toBe(2);
    expect(count('massSkip')).toBe(2);
    expect(count('colorDump')).toBe(3);
  }
});

test('四类 No Mercy 万能牌数量正确且无色', () => {
  const deck = createUnoDeck();
  const expected = {
    wildReverseDraw4: 8,
    wildDraw6: 4,
    wildDraw10: 4,
    wildColorRoulette: 8,
  } as const;
  for (const [value, count] of Object.entries(expected)) {
    const cards = deck.filter((card) => card.value === value);
    expect(cards).toHaveLength(count);
    for (const card of cards) expect(card.color).toBeNull();
  }
});

test('强力随从在每套炉石预设中均有两张，避免长期抽不到', () => {
  const featured = [
    'bloodboundTitan',
    'spyglassOracle',
    'ashPhoenix',
    'graveArchivist',
    'calamityDealer',
    'penaltyBulwark',
    'voidGambler',
    'penitentChampion',
    'powerAcolyte',
    'powerUnbound',
    'chromaticConductor',
    'bloodMeasureArbiter',
    'formationCommander',
  ];
  for (const deck of PRESET_DECKS) {
    for (const effectId of featured) {
      expect(deck.cardIds.filter((id) => id === effectId)).toHaveLength(2);
    }
  }
});

test('预设牌组不超 80 张上限', () => {
  for (const deck of PRESET_DECKS) {
    expect(deck.cardIds.length).toBeLessThanOrEqual(80);
    expect(deck.cardIds.length).toBeGreaterThanOrEqual(10);
  }
});
