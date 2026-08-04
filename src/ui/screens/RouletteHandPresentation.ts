import type { GameEvent } from '../../game/core/events';

/**
 * 权威状态会一次性完成颜色轮盘抽牌；这里仅暂存尚未播完的牌，
 * 让表现层在每张抽牌动画结束后再把对应牌加入可见手牌。
 */
export class RouletteHandPresentation {
  private readonly hiddenCardIds = new Map<number, Set<string>>();

  stage(events: readonly GameEvent[]): void {
    this.reset();
    for (const event of events) {
      if (event.type !== 'rouletteCardDrawn') continue;
      const cards = this.hiddenCardIds.get(event.player) ?? new Set<string>();
      cards.add(event.card.id);
      this.hiddenCardIds.set(event.player, cards);
    }
  }

  reveal(player: number, cardId: string): void {
    const cards = this.hiddenCardIds.get(player);
    if (!cards) return;
    cards.delete(cardId);
    if (cards.size === 0) this.hiddenCardIds.delete(player);
  }

  visibleUnoCount(player: number, authoritativeCount: number): number {
    return Math.max(0, authoritativeCount - (this.hiddenCardIds.get(player)?.size ?? 0));
  }

  visibleHand<T extends { id: string }>(player: number, authoritativeHand: T[]): T[] {
    const hidden = this.hiddenCardIds.get(player);
    return hidden?.size
      ? authoritativeHand.filter((card) => !hidden.has(card.id))
      : authoritativeHand;
  }

  reset(): void {
    this.hiddenCardIds.clear();
  }
}
