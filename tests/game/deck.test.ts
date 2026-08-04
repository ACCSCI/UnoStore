import { expect, test } from 'bun:test';

import {
  battleDeckSizeIssue,
  createUnoDeck,
  type LoadoutProfile,
  loadLoadoutProfile,
  MAX_CUSTOM_DECK_SIZE,
  MIN_CUSTOM_DECK_SIZE,
} from '../../src/game';
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

test('两套预设均为 50 张且同名牌不超过两张', () => {
  for (const deck of PRESET_DECKS) {
    expect(deck.cardIds).toHaveLength(MAX_CUSTOM_DECK_SIZE);
    const copies = new Map<string, number>();
    for (const id of deck.cardIds) copies.set(id, (copies.get(id) ?? 0) + 1);
    expect(Math.max(...copies.values())).toBeLessThanOrEqual(2);
  }
});

test('预设牌组的流派核心牌保留两张', () => {
  const featured = {
    combo: ['draw2', 'double', 'arcaneArchive', 'fatefulGift', 'spyglassOracle'],
    burst: ['crystal2', 'fireball', 'bolt', 'manaBlast', 'thunderhoofVanguard', 'unstableNova'],
  } as const;
  for (const deck of PRESET_DECKS) {
    for (const effectId of featured[deck.id as keyof typeof featured]) {
      expect(deck.cardIds.filter((id) => id === effectId)).toHaveLength(2);
    }
  }
});

test('厄运司牌者在每套预设中只放一张，限制全局发牌效果叠加', () => {
  for (const deck of PRESET_DECKS) {
    expect(deck.cardIds.filter((id) => id === 'doomDealer')).toHaveLength(1);
  }
});

test('首页准入会拒绝少于 10 张或多于 50 张的当前牌组', () => {
  const profile = (count: number): LoadoutProfile => ({
    decks: [
      {
        id: 'test',
        name: '测试',
        cardIds: Array.from({ length: count }, () => 'bolt'),
      },
    ],
    activeDeckId: 'test',
    activeHeroId: 'cardMaster',
  });
  expect(battleDeckSizeIssue(profile(MIN_CUSTOM_DECK_SIZE - 1))).toContain('至少需要 10 张');
  expect(battleDeckSizeIssue(profile(MIN_CUSTOM_DECK_SIZE))).toBeNull();
  expect(battleDeckSizeIssue(profile(MAX_CUSTOM_DECK_SIZE))).toBeNull();
  expect(battleDeckSizeIssue(profile(MAX_CUSTOM_DECK_SIZE + 1))).toContain('最多只能有 50 张');
});

test('升级时官方旧预设迁移到 50 张，自建超限牌组保留给玩家调整', () => {
  const previousStorage = globalThis.localStorage;
  const stored: LoadoutProfile = {
    decks: [
      {
        id: 'starter-combo',
        name: '旧官方预设',
        cardIds: Array.from({ length: 80 }, () => 'bolt'),
      },
      {
        id: 'custom-over-limit',
        name: '玩家自建',
        cardIds: Array.from({ length: 51 }, () => 'bolt'),
      },
    ],
    activeDeckId: 'custom-over-limit',
    activeHeroId: 'inspector',
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (key === 'unostore_loadouts_v1' ? JSON.stringify(stored) : null),
    } as Storage,
  });
  try {
    const profile = loadLoadoutProfile();
    expect(profile.decks.find((deck) => deck.id === 'starter-combo')?.cardIds).toHaveLength(50);
    expect(profile.decks.find((deck) => deck.id === 'custom-over-limit')?.cardIds).toHaveLength(51);
    expect(battleDeckSizeIssue(profile)).toContain('最多只能有 50 张');
  } finally {
    if (previousStorage) {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: previousStorage,
      });
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  }
});
