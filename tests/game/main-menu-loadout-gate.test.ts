import { expect, test } from 'bun:test';

test('首页所有对局入口共用牌组张数准入并提供调整入口', async () => {
  const source = await Bun.file('src/ui/screens/MainMenuScreen.ts').text();
  expect(source).toContain('battleDeckSizeIssue()');
  expect(source).toContain('this.localBattleButtons = [btnStory, btnLocal]');
  expect(source).toContain('this.localBattleButtons.push(btnSimulatedOnline)');
  expect(source).toContain('this.multiplayerButton.disabled = issue !== null || !loggedIn');
  expect(source).toContain('去牌库调整');
});
