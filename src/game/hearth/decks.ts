import type { HearthDeck } from './effects/registry';

/**
 * V1 预设炉石牌组。
 * 每套 8 张效果（同款效果可多张）。牌组编辑器（V2）直接复用该结构。
 */
export const PRESET_DECKS: HearthDeck[] = [
  {
    id: 'combo',
    name: '连击流',
    description: '大量抽牌与额外行动，快速出完 Uno 牌',
    cardIds: [
      'draw2',
      'draw2',
      'double',
      'double',
      'shield',
      'shield',
      'crystal2',
      'crystal2',
      'bolt',
      'bolt',
    ],
  },
  {
    id: 'burst',
    name: '爆发流',
    description: '高水晶产出 + 大量罚抽，压制对手',
    cardIds: [
      'untap',
      'untap',
      'crystal2',
      'fireball',
      'fireball',
      'bolt',
      'bolt',
      'massSkip',
      'manaBlast',
      'shield',
    ],
  },
];

/** 默认牌组（单人/快速对战） */
export const DEFAULT_DECK_ID = 'combo';

export function getDeck(id: string): HearthDeck {
  return PRESET_DECKS.find((d) => d.id === id) ?? PRESET_DECKS[0]!;
}
