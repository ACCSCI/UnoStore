import { expect, test } from 'bun:test';
import type { GameEvent } from '../../src/game/core/events';
import { handCountDeltas } from '../../src/ui/screens/HandCountDelta';

test('罚抽链演出显示待结算增量，真正抽牌后显示 UNO 增量', () => {
  const stacked: GameEvent = {
    type: 'unoPlayed',
    player: 0,
    cardId: 'draw-four',
    card: { id: 'draw-four', color: 'red', value: 'draw4' },
    crystalFrozen: 0,
    penaltyTarget: 1,
    penaltyAdded: 4,
    penaltyTransferred: 2,
  };
  expect(handCountDeltas(stacked)).toEqual([
    { player: 0, uno: -1, hearth: 0, pendingUno: 0 },
    { player: 1, uno: 0, hearth: 0, pendingUno: 6 },
  ]);
  expect(handCountDeltas({ type: 'drawPenalty', player: 1, count: 6, cardIds: [] })).toEqual([
    { player: 1, uno: 6, hearth: 0, pendingUno: 0 },
  ]);
});

test('赠牌演出同时给来源与目标显示正负差额', () => {
  expect(
    handCountDeltas({
      type: 'cardsGifted',
      player: 0,
      targetPlayer: 2,
      unoCardIds: ['u1'],
      hearthCardIds: ['h1'],
    })
  ).toEqual([
    { player: 0, uno: -1, hearth: -1, pendingUno: 0 },
    { player: 2, uno: 1, hearth: 1, pendingUno: 0 },
  ]);
});
