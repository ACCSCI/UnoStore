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
  private playerPanel: HTMLElement | null = null;
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
    this.view.start();

    // UI 面板
    const panel = this.el('div', 'battle-panel');
    const header = this.el('div', 'battle-header');
    const opponent = this.el('span', 'opponent-name', `vs ${this.match.opponentName}`);
    this.statusEl = this.el('div', 'battle-status', '');
    header.append(opponent, this.statusEl);
    panel.append(header);
    this.root.append(panel);

    // 会话（演示：UI 挂载 3D 但操作面板驱动故事会话）
    this.session = createStorySession(this.match, 7);
    this.playerPanel = this.el('div', 'player-panel');
    this.root.append(this.playerPanel);
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

  /** 玩家操作后刷新 UI + 检查胜负 */
  private afterAction(): void {
    this.refreshUI();
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

  /** 刷新手牌按钮 + 状态栏 */
  private refreshUI(): void {
    if (!(this.session && this.playerPanel && this.statusEl)) return;
    const panel = this.playerPanel;
    const status = this.statusEl;
    const s = this.session.state;
    const p = s.players[0]!;
    panel.innerHTML = '';
    status.textContent =
      `回合: ${s.turn === 0 ? '你' : this.match.opponentName} | ` +
      `水晶(可用/冻结): ${p.free}/${p.frozen} | ` +
      `Uno行动: ${s.unoActionsLeft} | 顶牌: ${fmtCard(s.topCard)}`;
    const handLabel = this.el('div', 'hand-label', `手牌 [${p.hand.length}]`);
    panel.appendChild(handLabel);
    const playable = new Set(playerPlayableIndices(this.session));
    p.hand.forEach((c, i) => {
      const b = this.btn(
        fmtCard(c),
        () => this.playUno(i),
        'card-btn' + (playable.has(i) ? ' playable' : '')
      );
      panel.appendChild(b);
    });
    // 炉石手牌（简版按钮）
    const hearthLabel = this.el('div', 'hand-label', `炉石手牌 [${p.hearthHand.length}]`);
    panel.appendChild(hearthLabel);
    p.hearthHand.forEach((c, i) => {
      const b = this.btn(
        `[炉] ${c.effectId}`,
        () => {
          const r = storyDispatch(this.session!, {
            type: 'playHearth',
            player: 0,
            cardIdx: i,
            targets: [1],
          });
          if (r.ok) this.afterAction();
          else this.setStatus(`✗ ${r.error}`);
        },
        'card-btn hearth-btn'
      );
      panel.appendChild(b);
    });
    const actions = this.el('div', 'actions-row');
    actions.append(
      this.btn('抽牌', () => this.drawUno()),
      this.btn('结束回合', () => this.endTurn())
    );
    panel.appendChild(actions);
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
