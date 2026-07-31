export type UnoColor = 'red' | 'yellow' | 'green' | 'blue';

export type UnoValue = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

export type UnoAction = 'skip' | 'reverse' | 'draw2' | 'wild' | 'wildDraw4' | 'massSkip';

export interface UnoCard {
  id: string;
  /** Wild / WildDraw4 / MassSkip 的 color 为 null */
  color: UnoColor | null;
  value: UnoValue | UnoAction;
}

/** 判断是否为功能牌（非数字） */
export function isActionCard(card: UnoCard): boolean {
  return !card.color || typeof card.value !== 'string' || !/^\d$/.test(card.value);
}
