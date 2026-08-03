import type { GameEvent } from '../game/core/events';

function hiddenIds(kind: 'uno' | 'hearth', count: number): string[] {
  return Array.from({ length: count }, (_, index) => `hidden-${kind}-${index + 1}`);
}

/**
 * 保留演出所需的事件类型与数量，但不把其他玩家刚抽到或持有的牌实例 ID 发给客户端。
 * 这些占位符只在单个事件内使用，不能与之后打出的公开牌建立关联。
 */
export function redactGameEvents(events: GameEvent[], viewer: number): GameEvent[] {
  return events.flatMap((event): GameEvent[] => {
    if (event.type === 'handRevealed') return event.player === viewer ? [event] : [];
    if (event.type === 'turnStart' && event.player !== viewer) {
      return [
        {
          ...event,
          drawUno: event.drawUno ? 'hidden-uno' : '',
          drawHearth: event.drawHearth ? 'hidden-hearth' : null,
        },
      ];
    }
    if (event.type === 'drawUno' && event.player !== viewer) {
      return [{ ...event, cardId: 'hidden-uno' }];
    }
    if (event.type === 'drawPenalty' && event.player !== viewer) {
      return [{ ...event, cardIds: hiddenIds('uno', event.cardIds.length) }];
    }
    if (event.type === 'hearthDrawn' && event.player !== viewer) {
      return [{ ...event, cardIds: hiddenIds('hearth', event.cardIds.length) }];
    }
    if (event.type === 'mixedCardsDrawn' && event.player !== viewer) {
      return [
        {
          ...event,
          unoCardIds: hiddenIds('uno', event.unoCardIds.length),
          hearthCardIds: hiddenIds('hearth', event.hearthCardIds.length),
        },
      ];
    }
    if (event.type === 'cardsGifted' && event.player !== viewer && event.targetPlayer !== viewer) {
      return [
        {
          ...event,
          unoCardIds: hiddenIds('uno', event.unoCardIds.length),
          hearthCardIds: hiddenIds('hearth', event.hearthCardIds.length),
        },
      ];
    }
    if (event.type === 'oracleResolved' && event.player !== viewer) {
      return [{ ...event, takenCardId: 'hidden-uno', discardedCardId: 'hidden-uno' }];
    }
    return [event];
  });
}
