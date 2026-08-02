import { getNet } from '../../net';
import { MAX_ROOM_PLAYERS, MIN_ROOM_PLAYERS } from '../../net/NetworkLayer';
import { MultiplayerBattleScreen } from './MultiplayerBattleScreen';
import { Screen } from './Screen';

/**
 * 房间内等待室：所有真人准备后，房主才能开始对局。
 */
export class RoomScreen extends Screen {
  private listEl: HTMLElement | null = null;
  private startBtn: HTMLButtonElement | null = null;
  private addBotBtn: HTMLButtonElement | null = null;
  private removeBotBtn: HTMLButtonElement | null = null;
  private readyBtn: HTMLButtonElement | null = null;
  private hintEl: HTMLElement | null = null;
  private copyRoomBtn: HTMLButtonElement | null = null;

  constructor(private roomId: string) {
    super();
  }

  override async render(): Promise<void> {
    const net = getNet();
    net.ensureLocalLoadoutSync();
    const wrap = this.el('div', 'lobby-wrap');
    const title = this.el('h2', 'screen-title', '🏠 联机房间');
    const roomCode = this.el('div', 'room-code-panel');
    const codeCopy = this.el('span', 'room-code-copy');
    codeCopy.append(
      this.el('small', undefined, '房间号'),
      this.el('strong', undefined, this.roomId)
    );
    this.copyRoomBtn = this.btn('复制房间号', () => void this.copyRoomId(), 'btn btn-quiet');
    roomCode.append(codeCopy, this.copyRoomBtn);
    const isHost = net.isHost;
    const hostTag = this.el('span', 'host-tag', isHost ? '👑 你是房主' : '等待房主开局…');
    wrap.append(title, roomCode, hostTag);

    this.listEl = this.el('div', 'room-players');
    wrap.append(this.listEl);

    this.hintEl = this.el('p', 'room-hint');
    this.readyBtn = this.btn(
      '准备',
      () => this.toggleReady(),
      'btn btn-secondary room-ready-button'
    );
    wrap.append(this.hintEl, this.readyBtn);

    if (isHost) {
      const botActions = this.el('div', 'room-bot-actions');
      this.addBotBtn = this.btn('＋ 添加机器人', () => this.changeBots(1));
      this.removeBotBtn = this.btn('－ 移除机器人', () => this.changeBots(-1));
      botActions.append(this.addBotBtn, this.removeBotBtn);
      const start = this.btn('🚀 开始对局', () => this.startGame(), 'btn primary');
      this.startBtn = start;
      wrap.append(botActions, start);
    }

    const leave = this.btn('退出房间', () => void this.leave(), 'btn-link');
    wrap.append(leave);
    this.root.append(wrap);

    this.refresh();
    // 监听玩家进出
    net.onPeerChange = () => {
      this.refresh();
    };
    net.onRoomUpdate = () => this.refresh();
    net.onGameStart = () => {
      if (!net.isHost) void new MultiplayerBattleScreen().enter();
    };
  }

  override exit(): void {
    getNet().onPeerChange = undefined;
    getNet().onRoomUpdate = undefined;
    getNet().onGameStart = undefined;
    super.exit();
  }

  private refresh(): void {
    if (!this.listEl) return;
    const net = getNet();
    const count = net.playerCount;
    this.listEl.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const row = this.el('div', 'player-row');
      const identity = net.playerIdentity(i);
      const display = identity
        ? `${identity.isBot ? '🤖 ' : ''}${identity.name} · ID ${identity.id}`
        : `正在获取玩家 ${i + 1} 的身份…`;
      const identityLabel = this.el('span', 'player-identity', `${display}${i === 0 ? ' 👑' : ''}`);
      const readyLabel = this.el(
        'strong',
        net.isPlayerReady(i) ? 'player-ready ready' : 'player-ready',
        identity?.isBot
          ? '构筑预设 · 自动准备'
          : !net.isPlayerLoadoutReady(i)
            ? '构筑同步中…'
            : net.isPlayerReady(i)
              ? '构筑已确认 · 已准备'
              : '构筑已确认 · 未准备'
      );
      row.append(identityLabel, readyLabel);
      this.listEl.appendChild(row);
    }
    const mySeat = net.isHost ? 0 : net.playerIndex;
    const amReady = mySeat >= 0 && net.isPlayerReady(mySeat);
    if (this.readyBtn) {
      this.readyBtn.textContent = amReady ? '取消准备' : '准备';
      this.readyBtn.classList.toggle('is-ready', amReady);
      this.readyBtn.disabled =
        net.gameStarted || mySeat < 0 || !(amReady || net.isLocalLoadoutConfirmed);
      this.readyBtn.title = net.isLocalLoadoutConfirmed
        ? ''
        : '正在重传出战构筑，收到房主确认后才能准备';
    }
    if (this.hintEl) {
      this.hintEl.textContent = net.gameStarted
        ? '上一局结算中，等待房主返回房间…'
        : net.loadoutSyncError
          ? `构筑同步失败：${net.loadoutSyncError}；正在自动重试。`
          : !net.isLocalLoadoutConfirmed
            ? '正在把英雄与出战牌库发送给房主；收到确认前会持续自动重传。'
            : !net.allPlayerLoadoutsReady
              ? '你的构筑已由房主确认，正在等待其他玩家完成构筑同步。'
              : net.allPlayersReady
                ? net.isHost
                  ? '所有真人玩家已准备，可以开始对局。'
                  : '所有真人玩家已准备，等待房主开始。'
                : '支持 2–8 个席位；机器人自动准备，所有真人玩家准备后才能开局。';
    }
    if (this.startBtn) {
      this.startBtn.disabled =
        count < MIN_ROOM_PLAYERS ||
        count > MAX_ROOM_PLAYERS ||
        net.playerIdentities.size < count ||
        !net.allPlayerLoadoutsReady ||
        !net.allPlayersReady ||
        net.gameStarted;
      this.startBtn.title = !net.allPlayerLoadoutsReady
        ? '等待所有玩家的出战构筑由房主确认'
        : net.allPlayersReady
          ? ''
          : '所有真人玩家准备后才能开始';
    }
    if (this.addBotBtn) {
      this.addBotBtn.disabled = count >= net.maxPlayers;
      this.addBotBtn.title = count >= net.maxPlayers ? '房间席位已满' : '';
    }
    if (this.removeBotBtn) {
      this.removeBotBtn.disabled = net.botPlayerCount <= 0;
      this.removeBotBtn.title = net.botPlayerCount <= 0 ? '房间中没有机器人' : '';
    }
  }

  private toggleReady(): void {
    const net = getNet();
    net.ensureLocalLoadoutSync();
    const mySeat = net.isHost ? 0 : net.playerIndex;
    if (mySeat < 0) return;
    net.setReady(!net.isPlayerReady(mySeat));
    this.refresh();
  }

  private changeBots(delta: 1 | -1): void {
    const net = getNet();
    if (delta > 0) net.addBot();
    else net.removeBot();
    this.refresh();
  }

  private async startGame(): Promise<void> {
    const net = getNet();
    if (!net.isHost) return;
    if (
      net.playerCount < MIN_ROOM_PLAYERS ||
      net.playerCount > MAX_ROOM_PLAYERS ||
      net.playerIdentities.size < net.playerCount ||
      !net.allPlayerLoadoutsReady ||
      !net.allPlayersReady
    )
      return;
    try {
      net.startGame(net.playerCount);
      void new MultiplayerBattleScreen().enter();
    } catch (error) {
      if (this.hintEl)
        this.hintEl.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  private async leave(): Promise<void> {
    const net = getNet();
    net.leaveRoom();
    void import('./LobbyScreen').then((m) => new m.LobbyScreen().enter());
  }

  private async copyRoomId(): Promise<void> {
    if (!this.copyRoomBtn) return;
    try {
      await navigator.clipboard.writeText(this.roomId);
      this.copyRoomBtn.textContent = '已复制 ✓';
      window.setTimeout(() => {
        if (this.copyRoomBtn) this.copyRoomBtn.textContent = '复制房间号';
      }, 1400);
    } catch {
      this.copyRoomBtn.textContent = '复制失败';
      this.copyRoomBtn.title = `房间号：${this.roomId}`;
    }
  }
}
