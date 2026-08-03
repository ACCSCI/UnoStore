import { expect, test } from 'bun:test';
import { penaltyTurnNotice, resolveTurnNotice } from '../../src/ui/screens/PersistentTurnNotice';

test('只要存在罚抽叠加门槛，中间警告就持续显示可出的最低 +N', () => {
  expect(penaltyTurnNotice(10, 6, true)).toEqual({
    title: '罚抽威胁 +10',
    detail: '只能叠加 +6 或更大的罚抽牌，否则结束回合接受全部罚牌。',
    kind: 'penalty',
  });
  expect(penaltyTurnNotice(10, 0, true)).toBeNull();
});

test('临时播报和计时器不能盖掉仍有效的罚抽持久警告', () => {
  const penalty = penaltyTurnNotice(8, 4, true);
  const transient = { title: '手牌已交换', detail: '临时消息', kind: 'swap' };
  expect(resolveTurnNotice(penalty, transient)).toBe(penalty);
  expect(resolveTurnNotice(null, transient)).toBe(transient);
});
