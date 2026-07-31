import type { StoryMatch, StorySession } from '../../game/story';
import {
  completeChapter,
  createStorySession,
  loadSave,
  opponentDecide,
  playerPlayableIndices,
  playerWon,
  recordResult,
  STORY_CHAPTERS,
  saveProgress,
  storyDispatch,
} from '../../game/story';
import { audio } from '../audio/AudioManager';
import { GameView } from '../scene/GameView';
import { Screen } from './Screen';

/**
 * 对局屏幕：3D 牌桌（GameView）+ 对话气泡 + 手牌操作 + 回合指示。
 * 玩家 = 座位 0；对手 AI 每 800ms 决策一次。
 */
export class BattleScreen extends Screen {
  private session: StorySession | null = null;
  private view: GameView | null = null;
  private statusEl: HTMLElement | null = null;

  private opponentTimer: number | null = null;
  private match: StoryMatch;

  constructor(match: StoryMatch) {
    super();
    this.match = match;
  }

  override async render(): Promise<void> {
    // 3D 场景容器
    const canvasHost = this.el('div', 'battle-canvas');
    this.root.append(canvasHost);
    this.view = new GameView(canvasHost);
    // 注入 3D 交互回调
    this.view.bindCallbacks({
      onCardClick: (id, isHearth) => this.onCardClicked(id, isHearth),
      onDrawClick: () => this.drawUno(),
      onEndClick: () => this.endTurn(),
    });
    this.view.start();
    this.view.setupScene();

    // 状态栏（仅信息显示）
    const panel = this.el('div', 'battle-panel');
    const header = this.el('div', 'battle-header');
    const opponent = this.el('span', 'opponent-name', `vs ${this.match.opponentName}`);
    this.statusEl = this.el('div', 'battle-status', '');
    header.append(opponent, this.statusEl);
    panel.append(header);
    this.root.append(panel);

    // 会话
    this.session = createStorySession(this.match, 7);
    this.refreshUI();
    this.showIntro();
  }

  override exit(): void {
    if (this.opponentTimer !== null) window.clearInterval(this.opponentTimer);
    this.view?.dispose();
    super.exit();
  }

  /** 对局前对话 */
  private showIntro(): void {
    const bubble = this.el('div', 'dialog-bubble');
    const ev = this.match.intro[0];
    if (ev) {
      bubble.textContent = `${this.match.opponentName}：${ev.text}`;
      if (ev.voice) audio.playSfx(ev.voice);
      this.root.appendChild(bubble);
      window.setTimeout(() => bubble.remove(), 4000);
    }
    this.startOpponentLoop();
  }

  /** 对手 AI 循环 */
  private startOpponentLoop(): void {
    this.opponentTimer = window.setInterval(() => {
      if (this.session?.phase !== 'playing') return;
      if (this.session.state.turn !== 1) return;
      const action = opponentDecide(this.session, this.match);
      if (action) {
        storyDispatch(this.session, action);
        this.afterAction();
      }
    }, 800);
  }

  /** 玩家操作后刷新 UI + 检查胜负 + 报牌音效 */
  private afterAction(): void {
    this.refreshUI();
    // 玩家剩 1 张 → UNO 报牌音效
    if (this.session && this.session.state.players[0]!.hand.length === 1) {
      audio.playSfx('/assets/audio/sfx/uno_cheer.mp3');
    }
    if (this.session?.phase === 'gameOver') this.finish();
  }

  /** 玩家出牌（从 UI 按钮） */
  private playUno(idx: number): void {
    if (this.session?.phase !== 'playing') return;
    if (this.session.state.turn !== 0) return;
    const card = this.session.state.players[0]!.hand[idx]!;
    const color =
      card.color === null
        ? ((prompt('选择颜色 (red/yellow/green/blue)') ?? undefined) as
            | 'red'
            | 'yellow'
            | 'green'
            | 'blue'
            | undefined)
        : undefined;
    const r = storyDispatch(this.session, { type: 'playUno', player: 0, cardIdx: idx, color });
    if (r.ok) {
      audio.playSfx('/assets/audio/sfx/card_flip.mp3');
      this.afterAction();
    } else {
      this.setStatus(`✗ ${r.error}`);
    }
  }

  private drawUno(): void {
    if (this.session?.phase !== 'playing') return;
    const r = storyDispatch(this.session, { type: 'drawUno', player: 0 });
    if (r.ok) this.afterAction();
  }

  private endTurn(): void {
    if (this.session?.phase !== 'playing') return;
    const r = storyDispatch(this.session, { type: 'endTurn', player: 0 });
    if (r.ok) this.afterAction();
  }

  /** 3D 卡牌点击：Uno 出牌 / 炉石出牌 */
  private onCardClicked(id: string, isHearth: boolean): void {
    if (this.session?.phase !== 'playing') return;
    if (this.session.state.turn !== 0) return;
    if (isHearth) {
      const idx = this.session.state.players[0]!.hearthHand.findIndex((c) => c.id === id);
      if (idx < 0) return;
      const r = storyDispatch(this.session, {
        type: 'playHearth',
        player: 0,
        cardIdx: idx,
        targets: [1],
      });
      if (r.ok) {
        audio.playSfx('/assets/audio/sfx/card_flip.mp3');
        this.afterAction();
      } else {
        this.setStatus(`✗ ${r.error}`);
      }
      return;
    }
    const idx = this.session.state.players[0]!.hand.findIndex((c) => c.id === id);
    if (idx < 0) return;
    this.playUno(idx);
  }

  /** 刷新手牌（3D）+ 状态栏 */
  private refreshUI(): void {
    if (!(this.session && this.statusEl)) return;
    const s = this.session.state;
    const p = s.players[0]!;
    this.statusEl.textContent =
      `回合: ${s.turn === 0 ? '你' : this.match.opponentName} | ` +
      `水晶(可用/冻结): ${p.free}/${p.frozen} | ` +
      `Uno行动: ${s.unoActionsLeft} | 顶牌: ${fmtCard(s.topCard)}`;
    // 3D 手牌同步：Uno + 炉石，可打高亮（索引 → 卡牌 ID）
    const playableIdx = playerPlayableIndices(this.session);
    const playable = new Set(playableIdx.map((i) => p.hand[i]!.id));
    this.view?.syncHand(p.hand, p.hearthHand, playable);
    this.view?.syncTable(s.unoDraw.length, s.topCard);
  }

  private setStatus(msg: string): void {
    if (this.statusEl) this.statusEl.textContent = msg;
  }

  /** 对局结束：更新存档 + 结算对话框 */
  private finish(): void {
    if (this.opponentTimer !== null) {
      window.clearInterval(this.opponentTimer);
      this.opponentTimer = null;
    }
    if (!this.session) return;
    const won = playerWon(this.session);
    const data = recordResult(loadSave(), won);
    const ch = STORY_CHAPTERS.find((c) => c.matches.some((m) => m.id === this.match.id));
    const nextCh = ch ? STORY_CHAPTERS[STORY_CHAPTERS.indexOf(ch) + 1] : undefined;
    const updated = ch ? completeChapter(data, ch.id, nextCh?.id ?? null) : data;
    saveProgress(updated);
    if (won) audio.playMusic('/assets/audio/music/victory.mp3');
    const overlay = this.el('div', 'result-overlay');
    const card = this.el('div', 'result-card');
    const title = this.el('h2', undefined, won ? '🎉 胜利！' : '💔 失败');
    const detail = this.el(
      'p',
      undefined,
      won ? `击败了 ${this.match.opponentName}` : `败给了 ${this.match.opponentName}，再试一次`
    );
    card.append(title, detail);
    card.append(
      this.btn(won && nextCh ? '下一章 →' : '返回章节', () => {
        overlay.remove();
        void import('./ChapterSelectScreen').then((m) => new m.ChapterSelectScreen().enter());
      })
    );
    overlay.appendChild(card);
    this.root.appendChild(overlay);
  }
}

/** 卡牌显示：R5 / +2 / *wild */
function fmtCard(c: { color: string | null; value: string }): string {
  if (c.color === null) return `*${c.value}`;
  const colorChar = c.color[0]?.toUpperCase() ?? '?';
  return `${colorChar}${c.value}`;
}
