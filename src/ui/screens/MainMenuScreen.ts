import { audio } from '../audio/AudioManager';
import { Screen } from './Screen';

/** 主菜单：开始剧情 / 快速对战（占位）/ 设置 */
export class MainMenuScreen extends Screen {
  override async render(): Promise<void> {
    const wrap = this.el('div', 'menu-wrap');
    const title = this.el('h1', 'menu-title', 'UNO × 炉石');
    const sub = this.el('p', 'menu-sub', '双卡流卡牌对战');
    wrap.append(title, sub);

    const btnStory = this.btn('📖 单人剧情', () => {
      // 懒加载避免循环依赖（ChapterSelectScreen → MainMenuScreen）
      void import('./ChapterSelectScreen').then((m) =>
        m.ChapterSelectScreen.prototype.enter.call(new m.ChapterSelectScreen())
      );
    });
    const btnQuick = this.btn('⚡ 快速对战（开发中）', () => {
      alert('快速对战将在联机阶段开放');
    });
    const btnMute = this.btn(audio.isMuted ? '🔇 取消静音' : '🔊 静音', () => {
      audio.toggleMute();
      void this.enter();
    });
    wrap.append(btnStory, btnQuick, btnMute);
    this.root.append(wrap);

    // 主菜单 BGM（mmx 生成）
    audio.playMusic('/assets/audio/music/menu_theme.mp3');
  }
}
