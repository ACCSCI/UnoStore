import { expect, test } from 'bun:test';
import { formatTurnClock, remainingTurnSeconds } from '../../src/game/core/turnTimeout';
import type { LoadoutProfile } from '../../src/game/loadout';
import type { SaveData } from '../../src/game/story/save';
import { mergeLoadouts, mergeStory } from '../../src/net/cloudSave';

test('手动合并剧情存档会合并章节并避免重复累计统计', () => {
  const local: SaveData = {
    completedChapters: ['ch1'],
    unlockedChapters: ['ch1', 'ch2'],
    totalWins: 3,
    totalLosses: 2,
  };
  const cloud: SaveData = {
    completedChapters: ['ch2'],
    unlockedChapters: ['ch1', 'ch2', 'ch3'],
    totalWins: 2,
    totalLosses: 5,
  };
  expect(mergeStory(local, cloud)).toEqual({
    completedChapters: ['ch1', 'ch2'],
    unlockedChapters: ['ch1', 'ch2', 'ch3'],
    totalWins: 3,
    totalLosses: 5,
  });
});

test('手动合并牌库会保留同 ID 的两个不同版本', () => {
  const local: LoadoutProfile = {
    decks: [{ id: 'deck-a', name: '本地牌库', cardIds: ['bolt'] }],
    activeDeckId: 'deck-a',
    activeHeroId: 'cardMaster',
  };
  const cloud: LoadoutProfile = {
    decks: [{ id: 'deck-a', name: '云端牌库', cardIds: ['shield'] }],
    activeDeckId: 'deck-a',
    activeHeroId: 'thug',
  };
  const merged = mergeLoadouts(local, cloud);
  expect(merged.decks).toHaveLength(2);
  expect(merged.decks[1]!.id).toStartWith('deck-a-cloud');
  expect(merged.activeDeckId).toBe('deck-a');
});

test('回合时钟按房主截止时间显示且不会变成负数', () => {
  expect(remainingTurnSeconds(121_000, 1_000)).toBe(120);
  expect(remainingTurnSeconds(500, 1_000)).toBe(0);
  expect(formatTurnClock(120)).toBe('2:00');
  expect(formatTurnClock(9)).toBe('0:09');
});
