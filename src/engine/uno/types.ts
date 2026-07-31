export type UnoColor = 'red' | 'yellow' | 'green' | 'blue';

export type UnoValue = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

export interface UnoCard {
  id: string;
  color: UnoColor;
  value: UnoValue;
}
