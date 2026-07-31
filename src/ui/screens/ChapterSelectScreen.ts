import type { StoryChapter } from '../../game/story';
import {
  isChapterCompleted,
  isChapterUnlocked,
  loadSave,
  STORY_CHAPTERS,
  STORY_CHARACTERS,
} from '../../game/story';
import { BattleScreen } from './BattleScreen';
import { Screen } from './Screen';

/** 章节选择：卡片列表（锁定/完成状态） */
export class ChapterSelectScreen extends Screen {
  override async render(): Promise<void> {
    const data = loadSave();
    const wrap = this.el('div', 'chapter-wrap');
    const title = this.el('h2', 'screen-title', '选择章节');
    const back = this.btn(
      '← 返回',
      () => {
        void import('./MainMenuScreen').then((m) => new m.MainMenuScreen().enter());
      },
      'btn-link'
    );
    wrap.append(title, back);

    for (const ch of STORY_CHAPTERS) {
      wrap.append(this.chapterCard(ch, data));
    }
    this.root.append(wrap);
  }

  private chapterCard(ch: StoryChapter, data: ReturnType<typeof loadSave>): HTMLElement {
    const unlocked = isChapterUnlocked(data, ch.id);
    const completed = isChapterCompleted(data, ch.id);
    const card = this.el('div', `chapter-card${unlocked ? '' : ' locked'}`);
    const title = this.el('h3', undefined, `${completed ? '✅ ' : ''}${ch.title}`);
    const desc = this.el('p', 'chapter-desc', ch.description);
    const opponent = STORY_CHARACTERS.find((c) => c.id === ch.matches[0]!.opponent);
    card.append(title, desc);
    if (opponent) {
      const img = document.createElement('img');
      img.src = opponent.portrait;
      img.alt = opponent.name;
      img.className = 'chapter-portrait';
      card.appendChild(img);
    }
    if (unlocked) {
      const play = this.btn('开始', () => {
        void new BattleScreen(ch.matches[0]!).enter();
      });
      card.appendChild(play);
    } else {
      card.appendChild(this.el('span', 'lock-hint', '🔒 完成上一章解锁'));
    }
    return card;
  }
}
