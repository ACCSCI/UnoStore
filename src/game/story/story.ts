import type { BossRules } from '../core/state';

/**
 * 单人剧情数据（Phase 5）。
 * 章节式结构：章节 → 对局（含对手/Boss 规则/AI 难度）→ 事件文本。
 * 立绘资产：public/assets/images/*.webp（mmx 生成）
 * 语音资产：public/assets/audio/voice/*.ogg（mmx 生成）
 */

export interface StoryEvent {
  /** 事件文本（对局前/后对话气泡） */
  text: string;
  /** 说话人（角色 id） */
  speaker: string;
  /** 语音文件（可选） */
  voice?: string;
}

export interface StoryMatch {
  id: string;
  /** 对手角色 id（对应立绘/语音） */
  opponent: string;
  opponentName: string;
  /** AI 难度 */
  difficulty: 'easy' | 'normal' | 'hard';
  /** Boss 特殊规则（可选） */
  boss?: BossRules;
  /** 对局前事件 */
  intro: StoryEvent[];
  /** 对局后事件 */
  outro: StoryEvent[];
}

export interface StoryChapter {
  id: string;
  title: string;
  description: string;
  /** 章节立绘背景 */
  image?: string;
  matches: StoryMatch[];
}

/** 角色定义（立绘/语音/名字） */
export interface StoryCharacter {
  id: string;
  name: string;
  portrait: string; // public/assets/images/xxx.webp
  color: string; // 座位/UI 配色
}

export const STORY_CHARACTERS: StoryCharacter[] = [
  {
    id: 'kiki',
    name: '琪琪',
    portrait: '/assets/images/kiki.webp',
    color: '#2ecc71',
  },
  {
    id: 'rui',
    name: '琉璃',
    portrait: '/assets/images/rui.webp',
    color: '#3498db',
  },
  {
    id: 'tutor',
    name: '龟师父',
    portrait: '/assets/images/tutor_wizard.webp',
    color: '#9b59b6',
  },
  {
    id: 'queen',
    name: '卡牌女王',
    portrait: '/assets/images/boss_queen.webp',
    color: '#e74c3c',
  },
];

export const STORY_CHAPTERS: StoryChapter[] = [
  {
    id: 'ch1',
    title: '第一章 · 入门',
    description: '琪琪教你双卡流的基本功',
    matches: [
      {
        id: 'ch1-m1',
        opponent: 'kiki',
        opponentName: '琪琪',
        difficulty: 'easy',
        intro: [
          {
            speaker: 'kiki',
            text: '嘿！我是琪琪，来打一局吧！数字牌能产出水晶，冻结一回合后就能用来打炉石牌。',
            voice: '/assets/audio/voice/kiki_intro.ogg',
          },
        ],
        outro: [{ speaker: 'kiki', text: '打得不错！记住：同色同号都能接，别小看数字牌的水晶。' }],
      },
    ],
  },
  {
    id: 'ch2',
    title: '第二章 · 连击',
    description: '琉璃的节奏很快，小心他的连击',
    matches: [
      {
        id: 'ch2-m1',
        opponent: 'rui',
        opponentName: '琉璃',
        difficulty: 'normal',
        intro: [
          {
            speaker: 'rui',
            text: '哼，我的牌运可不是吹的。',
            voice: '/assets/audio/voice/rui_intro.ogg',
          },
        ],
        outro: [{ speaker: 'rui', text: '有两下子。下次不会这么轻松了。' }],
      },
    ],
  },
  {
    id: 'ch3',
    title: '第三章 · 修行',
    description: '龟师父传授高阶技巧',
    matches: [
      {
        id: 'ch3-m1',
        opponent: 'tutor',
        opponentName: '龟师父',
        difficulty: 'normal',
        intro: [
          {
            speaker: 'tutor',
            text: '年轻人，炉石牌的价值在于时机。存水晶，等爆发。',
            voice: '/assets/audio/voice/tutorial_01.ogg',
          },
        ],
        outro: [{ speaker: 'tutor', text: '你已经掌握双卡流的精髓了。' }],
      },
    ],
  },
  {
    id: 'ch4',
    title: '第四章 · 女王',
    description: '面对卡牌女王 —— 她每回合自带额外水晶',
    matches: [
      {
        id: 'ch4-m1',
        opponent: 'queen',
        opponentName: '卡牌女王',
        difficulty: 'hard',
        boss: { bonusCrystalPerTurn: 2 },
        intro: [
          {
            speaker: 'queen',
            text: '面对女王，你的牌技准备好了吗？',
            voice: '/assets/audio/voice/boss_intro.ogg',
          },
        ],
        outro: [{ speaker: 'queen', text: '你赢了，这副牌桌属于你了……' }],
      },
    ],
  },
];
