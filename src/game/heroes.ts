export type HeroId = 'cardMaster' | 'thug' | 'inspector';

export interface HeroDefinition {
  id: HeroId;
  name: string;
  title: string;
  powerName: string;
  powerCost: number;
  description: string;
  portrait: string;
}

export const HERO_EMOTES = [
  { id: 'greeting', label: '打招呼', text: '很高兴见到你，来一局精彩的对决吧！' },
  { id: 'praise', label: '夸赞', text: '漂亮的一手，我认可你的判断。' },
  { id: 'thanks', label: '感叹', text: '好家伙，这局越来越有意思了！' },
  { id: 'wow', label: '震惊', text: '什么？这也能打出来！' },
  { id: 'threat', label: '威胁', text: '准备好，你的好运就到这里了。' },
  { id: 'taunt', label: '嘲讽', text: '别急，我还没开始认真呢。' },
] as const;

export type HeroEmoteId = (typeof HERO_EMOTES)[number]['id'];

export function getHeroEmote(id: string) {
  return HERO_EMOTES.find((emote) => emote.id === id) ?? null;
}

export const HEROES: HeroDefinition[] = [
  {
    id: 'cardMaster',
    name: '卡牌大师',
    title: '万牌归一',
    powerName: '借牌生花',
    powerCost: 2,
    description: '从本局所有玩家的出战牌库中，随机抽取 2 张炉石牌。',
    portrait: '/assets/images/heroes/cardMaster.webp',
  },
  {
    id: 'thug',
    name: '暴徒',
    title: '孤注一掷',
    powerName: '清空口袋',
    powerCost: 2,
    description: '从自己的 UNO 与炉石手牌中随机弃掉至多 2 张牌。',
    portrait: '/assets/images/heroes/thug.webp',
  },
  {
    id: 'inspector',
    name: '检察官',
    title: '重新分配',
    powerName: '洗牌审讯',
    powerCost: 2,
    description:
      '选择两名不同的在场玩家，将双方全部 UNO 与炉石手牌彻底洗混，再逐张随机分配；双方总手牌数也会改变。',
    portrait: '/assets/images/heroes/inspector.webp',
  },
];

export const DEFAULT_HERO_ID: HeroId = 'cardMaster';

export function getHero(id: string): HeroDefinition {
  return HEROES.find((hero) => hero.id === id) ?? HEROES[0]!;
}
