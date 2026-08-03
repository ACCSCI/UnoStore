import { expect, test } from 'bun:test';

import { getHeroEmote, HERO_EMOTES, HEROES } from '../../src/game/heroes';

test('每名英雄的全部表情都有独立台词', () => {
  for (const emote of HERO_EMOTES) {
    const lines = HEROES.map((hero) => getHeroEmote(emote.id, hero.id)?.text);
    expect(lines.every(Boolean)).toBe(true);
    expect(new Set(lines).size).toBe(HEROES.length);
  }
});
