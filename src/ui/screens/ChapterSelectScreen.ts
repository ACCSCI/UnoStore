import type { StoryChapter } from '../../game/story';
import {
  isChapterCompleted,
  isChapterUnlocked,
  loadSave,
  STORY_CHAPTERS,
  STORY_CHARACTERS,
} from '../../game/story';
import { assetUrl } from '../assets/url';
import { Screen } from './Screen';

/** 章节选择：卡片列表（锁定/完成状态） */
export class ChapterSelectScreen extends Screen {
  override async render(): Promise<void> {
    document.title = '选择章节 · UnoStore';
    const data = loadSave();
    const wrap = this.el('main', 'chapter-wrap');
    const header = this.el('header', 'chapter-header');
    const heading = this.el('div');
    const eyebrow = this.el('p', 'eyebrow', 'THE STORY DECK');
    const title = this.el('h1', 'screen-title', '选择你的下一局');
    const sub = this.el('p', 'screen-subtitle', '四位对手，四种节奏。每一次胜利都会翻开新的牌。');
    heading.append(eyebrow, title, sub);
    const back = this.btn(
      '返回主菜单',
      () => {
        void import('./MainMenuScreen').then((m) => new m.MainMenuScreen().enter());
      },
      'btn-link'
    );
    header.append(heading, back);
    const grid = this.el('section', 'chapter-grid');
    grid.setAttribute('aria-label', '剧情章节');

    for (const ch of STORY_CHAPTERS) {
      grid.append(this.chapterCard(ch, data));
    }
    wrap.append(header, grid);
    this.root.append(wrap);
  }

  private chapterCard(ch: StoryChapter, data: ReturnType<typeof loadSave>): HTMLElement {
    const unlocked = isChapterUnlocked(data, ch.id);
    const completed = isChapterCompleted(data, ch.id);
    const chapterIndex = STORY_CHAPTERS.indexOf(ch) + 1;
    const card = this.el('article', `chapter-card${unlocked ? '' : ' locked'}`);
    const content = this.el('div', 'chapter-content');
    const meta = this.el(
      'p',
      'chapter-meta',
      completed
        ? `CHAPTER ${String(chapterIndex).padStart(2, '0')} · 已完成`
        : `CHAPTER ${String(chapterIndex).padStart(2, '0')}`
    );
    const title = this.el('h2', undefined, ch.title.replace(/^第.+章 · /, ''));
    const desc = this.el('p', 'chapter-desc', ch.description);
    const opponent = STORY_CHARACTERS.find((c) => c.id === ch.matches[0]!.opponent);
    content.append(meta, title, desc);
    card.append(content);
    if (opponent) {
      const portraitWrap = this.el('div', 'chapter-portrait-wrap');
      const img = document.createElement('img');
      img.src = assetUrl(opponent.portrait);
      img.alt = opponent.name;
      img.className = 'chapter-portrait';
      img.width = 96;
      img.height = 96;
      img.loading = chapterIndex > 2 ? 'lazy' : 'eager';
      img.decoding = 'async';
      portraitWrap.append(img, this.el('span', undefined, opponent.name));
      card.appendChild(portraitWrap);
    }
    if (unlocked) {
      const play = this.btn(
        '开始对局',
        () => {
          void import('./BattleScreen').then((m) => new m.BattleScreen(ch.matches[0]!).enter());
        },
        'btn chapter-action'
      );
      card.appendChild(play);
    } else {
      card.appendChild(this.el('span', 'lock-hint', '完成上一章后解锁'));
    }
    return card;
  }
}
