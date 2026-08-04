import { expect, test } from 'bun:test';
import type { GameEvent } from '../../src/game/core/events';
import { RouletteHandPresentation } from '../../src/ui/screens/RouletteHandPresentation';

test('颜色轮盘每完成一张动画才向可见手牌插入一张', () => {
  const presentation = new RouletteHandPresentation();
  const hand = [
    { id: 'old-card' },
    { id: 'roulette-1' },
    { id: 'roulette-2' },
    { id: 'roulette-3' },
  ];
  const events: GameEvent[] = hand.slice(1).map((card, index) => ({
    type: 'rouletteCardDrawn',
    player: 0,
    chooser: 1,
    color: 'red',
    index: index + 1,
    card: { id: card.id, color: index === 2 ? 'red' : 'blue', value: String(index + 1) },
  }));

  presentation.stage(events);
  expect(presentation.visibleUnoCount(0, hand.length)).toBe(1);
  expect(presentation.visibleHand(0, hand).map((card) => card.id)).toEqual(['old-card']);

  presentation.reveal(0, 'roulette-1');
  expect(presentation.visibleUnoCount(0, hand.length)).toBe(2);
  expect(presentation.visibleHand(0, hand).map((card) => card.id)).toEqual([
    'old-card',
    'roulette-1',
  ]);

  presentation.reveal(0, 'roulette-2');
  expect(presentation.visibleUnoCount(0, hand.length)).toBe(3);

  presentation.reveal(0, 'roulette-3');
  expect(presentation.visibleUnoCount(0, hand.length)).toBe(4);
  expect(presentation.visibleHand(0, hand)).toEqual(hand);
});

test('颜色轮盘表现暂存按玩家隔离，重置后恢复权威手牌', () => {
  const presentation = new RouletteHandPresentation();
  presentation.stage([
    {
      type: 'rouletteCardDrawn',
      player: 2,
      chooser: 1,
      color: 'green',
      index: 1,
      card: { id: 'drawn', color: 'green', value: '5' },
    },
  ]);

  expect(presentation.visibleUnoCount(0, 7)).toBe(7);
  expect(presentation.visibleUnoCount(2, 7)).toBe(6);
  presentation.reset();
  expect(presentation.visibleUnoCount(2, 7)).toBe(7);
});
