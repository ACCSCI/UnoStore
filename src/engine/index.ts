import { createUnoDeck } from './uno/deck';

export { UNO_CARD_COUNTS, UNO_COLORS, UNO_VALUES } from './uno/constants';
export { createUnoDeck } from './uno/deck';
export type { UnoCard, UnoColor, UnoValue } from './uno/types';

export function createEngine() {
  return {
    unoDeck: createUnoDeck(),
  };
}
