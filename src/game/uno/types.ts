export type UnoColor = 'red' | 'yellow' | 'green' | 'blue';

export type UnoValue = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

export type UnoAction =
  | 'skip'
  | 'reverse'
  | 'draw2'
  | 'draw4'
  | 'wild'
  | 'wildDraw4'
  | 'massSkip'
  | 'colorDump'
  | 'wildReverseDraw4'
  | 'wildDraw6'
  | 'wildDraw10'
  | 'wildColorRoulette';

export interface UnoCard {
  id: string;
  /** 万能牌为 null；彩色 +4 / 全员跳过 / 同色清场保留所属颜色。 */
  color: UnoColor | null;
  value: UnoValue | UnoAction;
}

/** 判断是否为功能牌（非数字） */
export function isActionCard(card: UnoCard): boolean {
  return !card.color || typeof card.value !== 'string' || !/^\d$/.test(card.value);
}
