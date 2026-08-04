import { expect, test } from 'bun:test';
import { visibleDetailInterest } from '../../src/ui/scene/CardDetailPanel';

test('清除点击固定状态时保留仍在悬停的详情', () => {
  expect(visibleDetailInterest('hover-card', null, false)).toBe('hover-card');
  expect(visibleDetailInterest('hover-card', 'pinned-card', false)).toBe('hover-card');
});

test('动画临时抑制只隐藏详情，解除后恢复原悬停意图', () => {
  expect(visibleDetailInterest('table-top-card', null, true)).toBeNull();
  expect(visibleDetailInterest('table-top-card', null, false)).toBe('table-top-card');
});
