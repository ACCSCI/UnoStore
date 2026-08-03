import { expect, test } from 'bun:test';
import { minionInsertionIndex } from '../../src/ui/scene/MinionBoard';

test('桌面指针位置决定随从插入索引', () => {
  const centers = [320, 420, 520];

  expect(minionInsertionIndex(250, centers)).toBe(0);
  expect(minionInsertionIndex(370, centers)).toBe(1);
  expect(minionInsertionIndex(470, centers)).toBe(2);
  expect(minionInsertionIndex(580, centers)).toBe(3);
});

test('空战场始终放到第一个位置', () => {
  expect(minionInsertionIndex(480, [])).toBe(0);
});
