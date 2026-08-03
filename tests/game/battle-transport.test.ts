import { expect, test } from 'bun:test';
import { LocalBattleTransport } from '../../src/ui/screens/BattleTransport';

const localTransport = () =>
  new LocalBattleTransport({
    playerCount: 8,
    heroId: 'inspector',
    deckCardIds: ['arcane_spark'],
    playerName: '你',
  });

test('正式单机多人入口和开发模拟入口都进入同一共享牌桌', async () => {
  const source = await Bun.file('src/ui/screens/MainMenuScreen.ts').text();
  const storyBattleSource = await Bun.file('src/ui/screens/BattleScreen.ts').text();
  const onlineRoomSource = await Bun.file('src/ui/screens/RoomScreen.ts').text();
  const sharedBattleSource = await Bun.file('src/ui/screens/MultiplayerBattleScreen.ts').text();
  expect(source).toContain("this.startSharedMultiplayerBattle(playerCount, '你')");
  expect(source).toContain("this.startSharedMultiplayerBattle(playerCount, '联机模拟玩家')");
  expect(source).toContain('new MultiplayerBattleScreen(');
  expect(onlineRoomSource).toContain('new MultiplayerBattleScreen().enter()');
  expect(source).not.toContain("import('./BattleScreen')");
  expect(source).not.toContain('localTest');
  expect(storyBattleSource).not.toContain('localTest');
  expect(sharedBattleSource).not.toContain("from '../../net'");
  expect(sharedBattleSource).not.toContain('getNet()');
});

test('本地传输保持房主权威动作和仅本人脱敏快照通道', () => {
  const transport = localTransport();
  const actions: Array<{ action: unknown; player: number }> = [];
  const snapshots: unknown[] = [];
  transport.onInputReceived = (action, player) => actions.push({ action, player });
  transport.onStateReceived = (snapshot) => snapshots.push(snapshot);

  transport.sendInput({ type: 'endTurn' });
  transport.hostSendState({ sequence: 1 }, 0);
  transport.hostSendState({ sequence: 2 }, 1);

  expect(actions).toEqual([{ action: { type: 'endTurn' }, player: 0 }]);
  expect(snapshots).toEqual([{ sequence: 1 }]);
  expect(transport.isHost).toBeTrue();
  expect(transport.isBotSeat(7)).toBeTrue();
});

test('本地传输与联机牌桌约束相同，支持 2–8 人并复制出战牌组', () => {
  const tooSmall = new LocalBattleTransport({
    playerCount: 1,
    heroId: 'inspector',
    deckCardIds: ['arcane_spark'],
  });
  const tooLarge = new LocalBattleTransport({
    playerCount: 20,
    heroId: 'inspector',
    deckCardIds: ['arcane_spark'],
  });
  const loadout = tooLarge.playerLoadout(0);

  expect(tooSmall.playerCount).toBe(2);
  expect(tooLarge.playerCount).toBe(8);
  expect(loadout).toEqual({ heroId: 'inspector', deckCardIds: ['arcane_spark'] });
  loadout?.deckCardIds.push('mutation-attempt');
  expect(tooLarge.playerLoadout(0)?.deckCardIds).toEqual(['arcane_spark']);
});
