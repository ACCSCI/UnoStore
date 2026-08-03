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
  { id: 'greeting', label: '打招呼' },
  { id: 'praise', label: '夸赞' },
  { id: 'thanks', label: '感叹' },
  { id: 'wow', label: '震惊' },
  { id: 'threat', label: '威胁' },
  { id: 'taunt', label: '嘲讽' },
] as const;

export type HeroEmoteId = (typeof HERO_EMOTES)[number]['id'];

const HERO_EMOTE_LINES: Record<HeroId, Record<HeroEmoteId, string>> = {
  cardMaster: {
    greeting: '牌已洗好，愿今晚的运气听我调遣。',
    praise: '漂亮，这一手连我都要记下来。',
    thanks: '有意思，这份人情我收下了。',
    wow: '居然藏着这张牌，真有你的。',
    threat: '别眨眼，下一张牌会改写牌局。',
    taunt: '牌桌不相信侥幸，只相信我的安排。',
  },
  thug: {
    greeting: '都坐稳了，今晚谁也别想轻松离桌。',
    praise: '够狠！这一手有点我的样子。',
    thanks: '哈哈，正合我意，再来点大的！',
    wow: '什么？你从哪儿摸出这张鬼牌的！',
    threat: '再给你一回合，也改变不了结局。',
    taunt: '手都在抖了？要不我替你出牌。',
  },
  inspector: {
    greeting: '牌局开始。每一张牌，我都会记录。',
    praise: '判断准确，这一步值得肯定。',
    thanks: '局势终于有趣起来了。',
    wow: '异常出牌已记录……确实出乎意料。',
    threat: '证据已经齐了，下一轮就是结论。',
    taunt: '你的意图太明显，经不起一次审讯。',
  },
};

export function getHeroEmote(id: string, heroId: HeroId = DEFAULT_HERO_ID) {
  const emote = HERO_EMOTES.find((entry) => entry.id === id);
  if (!emote) return null;
  return { ...emote, text: HERO_EMOTE_LINES[heroId][emote.id] };
}

export const HEROES: HeroDefinition[] = [
  {
    id: 'cardMaster',
    name: '卡牌大师',
    title: '万牌归一',
    powerName: '借牌生花',
    powerCost: 1,
    description: '选择并弃掉自己 1 张 UNO 牌，从本局所有玩家的出战牌库中随机换取 1 张炉石牌。',
    portrait: '/assets/images/heroes/cardMaster.webp',
  },
  {
    id: 'thug',
    name: '暴徒',
    title: '孤注一掷',
    powerName: '清空口袋',
    powerCost: 2,
    description:
      '从自己的 UNO 与炉石手牌中随机弃掉至多 2 张牌，并获得 1 层持久护盾；抵消一次罚抽后消耗。',
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
