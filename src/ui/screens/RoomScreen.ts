import { getNet } from '../../net';
import { MultiplayerBattleScreen } from './MultiplayerBattleScreen';
import { Screen } from './Screen';

/**
 * 房间内等待室：显示玩家列表，房主可选择开局（≥2 人可开，不强制）。
 */
export class RoomScreen extends Screen {
  private listEl: HTMLElement | null = null;
  private startBtn: HTMLButtonElement | null = null;
  private timer: number | null = null;

  constructor(private roomId: string) {
    super();
  }

  override async render(): Promise<void> {
    const net = getNet();
    const wrap = this.el('div', 'lobby-wrap');
    const title = this.el('h2', 'screen-title', `🏠 房间 ${this.roomId}`);
    const isHost = net.isHost;
    const hostTag = this.el('span', 'host-tag', isHost ? '👑 你是房主' : '等待房主开局…');
    wrap.append(title, hostTag);

    this.listEl = this.el('div', 'room-players');
    wrap.append(this.listEl);

    if (isHost) {
      const hint = this.el('p', 'room-hint', '人数 ≥ 2 即可开局，也可以继续等人');
      const start = this.btn('🚀 开始对局', () => this.startGame(), 'btn primary');
      this.startBtn = start;
      wrap.append(hint, start);
    } else {
      const wait = this.el('p', 'room-hint', '等待房主开始对局…');
      wrap.append(wait);
    }

    const leave = this.btn('退出房间', () => void this.leave(), 'btn-link');
    wrap.append(leave);
    this.root.append(wrap);

    this.timer = window.setInterval(() => void this.refresh(), 1500);
    void this.refresh();
    // 监听玩家进出
    net.onPeerChange = (e) => {
      if (e.type === 'leave' && !net.isHost) {
        // 房主离开 → 回大厅
        void import('./LobbyScreen').then((m) => new m.LobbyScreen().enter());
      }
      void this.refresh();
    };
  }

  override exit(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    getNet().onPeerChange = undefined;
    super.exit();
  }

  private async refresh(): Promise<void> {
    if (!this.listEl) return;
    const net = getNet();
    const count = net.playerCount;
    this.listEl.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const row = this.el('div', 'player-row');
      row.textContent = `玩家 ${i + 1}${i === 0 && net.isHost ? ' 👑' : ''}`;
      this.listEl.appendChild(row);
    }
    // 房主：≥2 人可开局
    if (this.startBtn) this.startBtn.disabled = count < 2;
  }

  private async startGame(): Promise<void> {
    const net = getNet();
    if (!net.isHost) return;
    net.gameStarted = true;
    void new MultiplayerBattleScreen().enter();
  }

  private async leave(): Promise<void> {
    const net = getNet();
    await net.leaveRoom();
    void import('./LobbyScreen').then((m) => new m.LobbyScreen().enter());
  }
}
