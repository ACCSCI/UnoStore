export type CardVisual =
  | 'lightning'
  | 'fire'
  | 'frost'
  | 'arcane'
  | 'shadow'
  | 'nature'
  | 'shield'
  | 'time'
  | 'draw'
  | 'transform'
  | 'summon';

export type CardSound =
  | 'lightning'
  | 'fire'
  | 'frost'
  | 'arcane'
  | 'shadow'
  | 'nature'
  | 'shield'
  | 'time'
  | 'draw'
  | 'transform'
  | 'impact';

export interface CardPresentation {
  visual: CardVisual;
  sound: CardSound;
}

/** 每张炉石牌都有显式表现映射；测试会校验注册表没有遗漏。 */
export const CARD_PRESENTATION: Record<string, CardPresentation> = {
  bolt: { visual: 'lightning', sound: 'lightning' },
  clockworkSquire: { visual: 'summon', sound: 'impact' },
  emberWolf: { visual: 'fire', sound: 'fire' },
  fatefulGift: { visual: 'draw', sound: 'draw' },
  chromaticConductor: { visual: 'arcane', sound: 'arcane' },
  crystalGuardian: { visual: 'shield', sound: 'shield' },
  stormDrake: { visual: 'lightning', sound: 'lightning' },
  shield: { visual: 'shield', sound: 'shield' },
  draw2: { visual: 'draw', sound: 'draw' },
  fireball: { visual: 'fire', sound: 'fire' },
  crystal2: { visual: 'arcane', sound: 'arcane' },
  arcaneArchive: { visual: 'draw', sound: 'draw' },
  reverse2: { visual: 'time', sound: 'time' },
  massSkip: { visual: 'time', sound: 'time' },
  freeze2: { visual: 'frost', sound: 'frost' },
  untap: { visual: 'lightning', sound: 'lightning' },
  steal: { visual: 'shadow', sound: 'shadow' },
  timeTwist: { visual: 'time', sound: 'time' },
  echo: { visual: 'arcane', sound: 'arcane' },
  manaBlast: { visual: 'arcane', sound: 'arcane' },
  double: { visual: 'time', sound: 'time' },
  bloodboundTitan: { visual: 'shadow', sound: 'impact' },
  spyglassOracle: { visual: 'arcane', sound: 'arcane' },
  ashPhoenix: { visual: 'fire', sound: 'fire' },
  calamityDealer: { visual: 'shadow', sound: 'shadow' },
  penaltyBulwark: { visual: 'shield', sound: 'shield' },
  voidGambler: { visual: 'shadow', sound: 'shadow' },
  graveArchivist: { visual: 'shadow', sound: 'shadow' },
  penitentChampion: { visual: 'nature', sound: 'impact' },
  polymorph: { visual: 'transform', sound: 'transform' },
  equalityOfAll: { visual: 'transform', sound: 'transform' },
  sheepToken: { visual: 'transform', sound: 'nature' },
  powerAcolyte: { visual: 'arcane', sound: 'arcane' },
  powerUnbound: { visual: 'fire', sound: 'fire' },
  berserkerOath: { visual: 'fire', sound: 'impact' },
  vitalSurge: { visual: 'nature', sound: 'nature' },
  warcryCommander: { visual: 'fire', sound: 'impact' },
  bloodforgeColossus: { visual: 'shadow', sound: 'impact' },
  goldenCitadel: { visual: 'shield', sound: 'shield' },
  agonyDevourer: { visual: 'shadow', sound: 'shadow' },
  unoAnnihilation: { visual: 'shadow', sound: 'shadow' },
  forcedConscription: { visual: 'draw', sound: 'draw' },
  bloodMeasureArbiter: { visual: 'shadow', sound: 'impact' },
  battlefieldRotation: { visual: 'time', sound: 'time' },
  duelOfAllegiance: { visual: 'transform', sound: 'transform' },
  armyExchange: { visual: 'time', sound: 'time' },
  chaosConscription: { visual: 'shadow', sound: 'shadow' },
};

export function cardPresentation(effectId: string): CardPresentation {
  return CARD_PRESENTATION[effectId] ?? { visual: 'arcane', sound: 'arcane' };
}

const SOUND_ASSETS: Record<CardSound, string> = {
  lightning: '/assets/audio/sfx/generated/lightning_bolt.mp3',
  fire: '/assets/audio/sfx/generated/fire_spell.mp3',
  frost: '/assets/audio/sfx/generated/frost_spell.mp3',
  arcane: '/assets/audio/sfx/generated/arcane_draw.mp3',
  shadow: '/assets/audio/sfx/generated/shadow_magic.mp3',
  nature: '/assets/audio/sfx/generated/arcane_draw.mp3',
  shield: '/assets/audio/sfx/generated/shield_magic.mp3',
  time: '/assets/audio/sfx/generated/time_magic.mp3',
  draw: '/assets/audio/sfx/generated/arcane_draw.mp3',
  transform: '/assets/audio/sfx/generated/polymorph.mp3',
  impact: '/assets/audio/sfx/generated/minion_hit.mp3',
};

export function soundAsset(sound: CardSound): string {
  return SOUND_ASSETS[sound];
}

export function unoPresentation(value: string): CardPresentation {
  if (value.includes('Draw') || value === 'draw2' || value === 'draw4')
    return { visual: 'lightning', sound: 'lightning' };
  if (value === 'reverse' || value === 'massSkip') return { visual: 'time', sound: 'time' };
  if (value === 'wildColorRoulette') return { visual: 'arcane', sound: 'arcane' };
  if (value === 'colorDump') return { visual: 'nature', sound: 'nature' };
  if (value === 'skip' || value === 'wild') return { visual: 'arcane', sound: 'arcane' };
  return { visual: 'draw', sound: 'draw' };
}
