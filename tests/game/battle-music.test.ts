import { expect, test } from 'bun:test';

import { battleMusicTier } from '../../src/ui/audio/BattleMusicState';

const player = (unoCount: number, pendingDraw = 0, unoAlert = false, active = true) => ({
  active,
  unoCount,
  pendingDraw,
  unoAlert,
});

test('牌局稳定时使用常态酒馆音乐', () => {
  expect(
    battleMusicTier({ phase: 'playUno', players: [player(7), player(6), player(8), player(5)] })
  ).toBe('calm');
});

test('罚抽链、少牌或已有淘汰时提升为压力层', () => {
  expect(battleMusicTier({ phase: 'playUno', players: [player(5, 2), player(6)] })).toBe('tension');
  expect(battleMusicTier({ phase: 'playUno', players: [player(3), player(7), player(8)] })).toBe(
    'tension'
  );
  expect(
    battleMusicTier({
      phase: 'playUno',
      players: [player(8), player(6), player(7), player(0, 0, false, false)],
    })
  ).toBe('tension');
});

test('UNO、重罚抽或最后两人触发高潮层', () => {
  expect(battleMusicTier({ phase: 'playUno', players: [player(1, 0, true), player(7)] })).toBe(
    'climax'
  );
  expect(battleMusicTier({ phase: 'playUno', players: [player(8, 6), player(7), player(6)] })).toBe(
    'climax'
  );
  expect(
    battleMusicTier({
      phase: 'playUno',
      players: [player(8), player(7), player(0, 0, false, false), player(0, 0, false, false)],
    })
  ).toBe('climax');
});
