import {
  getDeck,
  HEARTH_EXPANSION_CARD_COPIES,
  HEARTH_EXPANSION_CARD_IDS,
  PRESET_DECKS,
} from './hearth/decks';
import { allEffects } from './hearth/effects/registry';
import { DEFAULT_HERO_ID, HEROES, type HeroId } from './heroes';
import './hearth/cards';

export const LOADOUT_STORAGE_KEY = 'unostore_loadouts_v1';
export const MIN_CUSTOM_DECK_SIZE = 10;
export const MAX_CUSTOM_DECK_SIZE = 80;
export const MAX_CARD_COPIES = 2;

export interface SavedHearthDeck {
  id: string;
  name: string;
  cardIds: string[];
}

export interface LoadoutProfile {
  decks: SavedHearthDeck[];
  activeDeckId: string;
  activeHeroId: HeroId;
}

/** 进入权威联机房间时提交给房主的最小出战配置。 */
export interface BattleLoadout {
  heroId: HeroId;
  deckCardIds: string[];
}

function defaultProfile(): LoadoutProfile {
  const decks = PRESET_DECKS.map((deck) => ({
    id: `starter-${deck.id}`,
    name: deck.name,
    cardIds: [...deck.cardIds],
  }));
  return { decks, activeDeckId: decks[0]!.id, activeHeroId: DEFAULT_HERO_ID };
}

export function loadLoadoutProfile(): LoadoutProfile {
  const fallback = defaultProfile();
  try {
    const raw = localStorage.getItem(LOADOUT_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<LoadoutProfile>;
    const validIds = new Set(
      allEffects()
        .filter((effect) => effect.id !== 'sheepToken')
        .map((effect) => effect.id)
    );
    const decks = (parsed.decks ?? [])
      .filter((deck): deck is SavedHearthDeck => Boolean(deck?.id && deck.name && deck.cardIds))
      .map((deck) => {
        const id = String(deck.id);
        const cardIds = deck.cardIds
          .filter((cardId) => validIds.has(cardId))
          .slice(0, MAX_CUSTOM_DECK_SIZE);
        if (id.startsWith('starter-')) {
          for (const effectId of HEARTH_EXPANSION_CARD_IDS) {
            const desiredCopies = HEARTH_EXPANSION_CARD_COPIES[effectId] ?? 2;
            for (
              let copies = cardIds.filter((entry) => entry === effectId).length;
              copies < desiredCopies;
              copies++
            ) {
              if (cardIds.length < MAX_CUSTOM_DECK_SIZE) cardIds.push(effectId);
            }
          }
        }
        return { id, name: String(deck.name).slice(0, 24), cardIds };
      })
      .filter((deck) => deck.cardIds.length > 0);
    if (decks.length === 0) return fallback;
    const activeDeckId = decks.some((deck) => deck.id === parsed.activeDeckId)
      ? parsed.activeDeckId!
      : decks[0]!.id;
    const activeHeroId = ['cardMaster', 'thug', 'inspector'].includes(parsed.activeHeroId ?? '')
      ? parsed.activeHeroId!
      : DEFAULT_HERO_ID;
    return { decks, activeDeckId, activeHeroId };
  } catch {
    return fallback;
  }
}

export function saveLoadoutProfile(profile: LoadoutProfile): void {
  const updatedAt = Date.now();
  localStorage.setItem(LOADOUT_STORAGE_KEY, JSON.stringify(profile));
  localStorage.setItem('unostore_loadouts_updated_at', String(updatedAt));
  void import('../net/cloudSave')
    .then(({ mirrorLoadoutSave }) => mirrorLoadoutSave(profile, updatedAt))
    .catch((error: unknown) => console.warn('VibeHub 牌组存档同步失败', error));
}

export function activeDeck(profile = loadLoadoutProfile()): SavedHearthDeck {
  return (
    profile.decks.find((deck) => deck.id === profile.activeDeckId) ?? {
      id: 'fallback-combo',
      name: getDeck('combo').name,
      cardIds: [...getDeck('combo').cardIds],
    }
  );
}

export function activeBattleLoadout(profile = loadLoadoutProfile()): BattleLoadout {
  return {
    heroId: profile.activeHeroId,
    deckCardIds: [...activeDeck(profile).cardIds],
  };
}

/**
 * 房主不能信任客人提交的构筑；只接受当前版本存在的英雄、卡牌和合法张数。
 * 返回新数组，避免网络消息对象之后被调用方修改。
 */
export function parseBattleLoadout(value: unknown): BattleLoadout | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<BattleLoadout>;
  if (!HEROES.some((hero) => hero.id === candidate.heroId)) return null;
  if (
    !Array.isArray(candidate.deckCardIds) ||
    candidate.deckCardIds.length < MIN_CUSTOM_DECK_SIZE ||
    candidate.deckCardIds.length > MAX_CUSTOM_DECK_SIZE
  )
    return null;

  const validIds = new Set(
    allEffects()
      .filter((effect) => effect.id !== 'sheepToken')
      .map((effect) => effect.id)
  );
  const copies = new Map<string, number>();
  const deckCardIds: string[] = [];
  for (const cardId of candidate.deckCardIds) {
    if (typeof cardId !== 'string' || !validIds.has(cardId)) return null;
    const count = (copies.get(cardId) ?? 0) + 1;
    if (count > MAX_CARD_COPIES) return null;
    copies.set(cardId, count);
    deckCardIds.push(cardId);
  }
  return { heroId: candidate.heroId!, deckCardIds };
}

export function createDeckId(): string {
  return `deck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
