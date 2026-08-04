import { expect, test } from 'bun:test';
import { confirmedOracleChoice, oracleCardChoice } from '../../src/ui/screens/HandRevealDialog';

test('窥镜拿牌与弃牌使用不同的手势和叉号状态', () => {
  expect(oracleCardChoice('take', 'take', 'discard')).toBe('take');
  expect(oracleCardChoice('discard', 'take', 'discard')).toBe('discard');
  expect(oracleCardChoice('other', 'take', 'discard')).toBeNull();
});

test('窥镜只有点击确认后才返回选择，确认后无需等待结束回合', () => {
  expect(confirmedOracleChoice(false, true, 'take', 'discard')).toBeNull();
  expect(confirmedOracleChoice(true, true, 'take', '')).toBeNull();
  expect(confirmedOracleChoice(true, true, 'take', 'discard')).toEqual({
    takeCardId: 'take',
    discardCardId: 'discard',
  });
});

test('窥镜确认键会提交对话框表单', async () => {
  const source = await Bun.file(
    new URL('../../src/ui/screens/HandRevealDialog.ts', import.meta.url)
  ).text();
  expect(source).toContain("confirm.type = 'submit'");
});
