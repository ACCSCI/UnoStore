/**
 * VibeHub Beta 网络层。
 * 同步模型：host-authority。所有规则在房主演算；客户端只发送可靠输入，
 * 房主按座位发送各自脱敏快照，绝不广播私人手牌。
 */

import { activeBattleLoadout, type BattleLoadout, parseBattleLoadout } from '../game/loadout';

export type VibeUser = VibeHubSDK.User;
export type RoomMeta = VibeHubSDK.RoomMetadata;
export type RoomHandle = VibeHubSDK.Room;

export interface RoomPlayerIdentity {
  seat: number;
  id: string;
  name: string;
  image: string | null;
  isBot?: boolean;
}

export const VIBE_SDK_URL = 'https://vibe.lumigrav.space/sdk/beta/vibehub.js';
export const VIBE_SDK_CHANNEL = 'beta' as const;
export const MIN_ROOM_PLAYERS = 2;
export const MAX_ROOM_PLAYERS = 8;
const LOADOUT_RETRY_MS = 1_200;

interface PendingLoadoutSubmission {
  requestId: string;
  fingerprint: string;
  loadout: BattleLoadout;
}

function loadoutFingerprint(loadout: BattleLoadout): string {
  return `${loadout.heroId}\u0000${loadout.deckCardIds.join('\u0000')}`;
}

function loadoutRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `loadout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

/** 把浏览器只返回 Failed to fetch 的 LNA/Fake-IP 故障转换成可执行诊断。 */
export function vibeHubErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|fetch|network|cors/i.test(detail)) {
    return (
      'VibeHub 请求被浏览器拦截。若控制台含“local address space”，通常是代理 Fake-IP ' +
      '把公网域名解析到了 198.18.0.0/15：请让 vibe.lumigrav.space 使用真实 DNS，' +
      '或在 vibeapps.lumigrav.space 的站点权限中允许本地网络访问后刷新'
    );
  }
  return detail;
}

/**
 * Beta SDK 的 peers() 同时返回真实玩家连接和 VibeNet relay 路径。
 * relay 项带有 role，绝不能计入游戏席位，否则两名真人在启用中继时会被显示成三人或更多。
 */
export function gameplayPeers(
  room: Pick<RoomHandle, 'peerId' | 'peers'>,
  departedPeerIds: ReadonlySet<string> = new Set()
): VibeHubSDK.PeerInfo[] {
  const players = room
    .peers()
    .filter(
      (peer) =>
        peer.role === undefined &&
        peer.id !== room.peerId &&
        peer.open &&
        !peer.reconnecting &&
        !departedPeerIds.has(peer.id)
    )
    .map((peer) => [peer.id, peer] as const);
  return [...new Map(players).values()];
}

function parseVibeUser(value: unknown): VibeUser | null {
  if (!value || typeof value !== 'object') return null;
  const user = value as Partial<VibeUser>;
  if (typeof user.id !== 'string' || !user.id.trim()) return null;
  if (!(typeof user.name === 'string' || user.name === null)) return null;
  if (!(typeof user.image === 'string' || user.image === null)) return null;
  return { id: user.id, name: user.name, image: user.image };
}

export function areRoomPlayersReady(
  identities: Iterable<RoomPlayerIdentity>,
  readyUserIds: ReadonlySet<string>,
  playerCount: number
): boolean {
  const players = [...identities];
  if (
    playerCount < MIN_ROOM_PLAYERS ||
    playerCount > MAX_ROOM_PLAYERS ||
    players.length < playerCount
  )
    return false;
  return players.every((identity) => identity.isBot || readyUserIds.has(identity.id));
}

function configuredWorkSlug(): string | null {
  const fromEnv = import.meta.env.VITE_VIBEHUB_WORK?.trim();
  if (fromEnv) return fromEnv;
  if (location.hostname === 'vibeapps.lumigrav.space') {
    return location.pathname.split('/').filter(Boolean)[0] ?? null;
  }
  return null;
}

function safeRoomId(value: string): string {
  const roomId = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(roomId)) {
    throw new Error('房间号只能含小写字母、数字和连字符，长度 3–48 位');
  }
  return roomId;
}

export class NetworkLayer {
  private api: VibeHubSDK.Client | null = null;
  private room: RoomHandle | null = null;
  private authUnsubscribe: (() => void) | null = null;
  private readonly peerSeats = new Map<string, number>();
  private readonly seatPeers = new Map<number, string>();
  private readonly peerUsers = new Map<string, VibeUser>();
  private readonly seatUsers = new Map<number, RoomPlayerIdentity>();
  private readonly readyUserIds = new Set<string>();
  private readonly playerLoadouts = new Map<string, BattleLoadout>();
  private readonly loadoutReadyUserIds = new Set<string>();
  private readonly departedPeerIds = new Set<string>();
  private pendingLoadout: PendingLoadoutSubmission | null = null;
  private loadoutRetryTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  private localLoadoutConfirmed = false;
  private confirmedLoadoutFingerprint: string | null = null;
  private localLoadoutError: string | null = null;
  private initPromise: Promise<void> | null = null;
  private humanCount = 0;
  private botCount = 0;
  private roomMax = MAX_ROOM_PLAYERS;
  gameStarted = false;
  playerCount = 0;
  playerIndex = -1;

  onStateReceived?: (state: unknown) => void;
  onInputReceived?: (action: unknown, player: number) => void;
  onPeerChange?: (event: VibeHubSDK.PeerEvent) => void;
  onGameStart?: (playerCount: number) => void;
  onAuthChange?: (user: VibeUser | null) => void;
  onSnapshotRequested?: (player: number) => void;
  onRoomUpdate?: (playerCount: number) => void;

  async init(): Promise<void> {
    if (this.api) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initialize();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async initialize(): Promise<void> {
    const work = configuredWorkSlug();
    if (!work) {
      throw new Error(
        '未配置 VibeHub 项目 slug。请在 .env.local 设置 VITE_VIBEHUB_WORK=<Creator Center 中的项目 slug>'
      );
    }
    await this.ensureSdk();
    if (window.VibeHub?.channel !== VIBE_SDK_CHANNEL) {
      throw new Error(`SDK 通道错误：需要 beta，实际为 ${window.VibeHub?.channel ?? 'unknown'}`);
    }
    try {
      this.api = await window.VibeHub.init({ work });
    } catch (error) {
      throw new Error(vibeHubErrorMessage(error));
    }
    this.authUnsubscribe?.();
    this.authUnsubscribe = this.api.onAuthChange((user) => {
      if (!user && this.room) this.leaveRoom();
      this.onAuthChange?.(user);
    });
  }

  private async ensureSdk(): Promise<void> {
    if (window.VibeHub) return;
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${VIBE_SDK_URL}"]`);
    await new Promise<void>((resolve, reject) => {
      const script = existing ?? document.createElement('script');
      const timeout = window.setTimeout(
        () => reject(new Error('VibeHub Beta SDK 加载超时')),
        12_000
      );
      const loaded = (): void => {
        window.clearTimeout(timeout);
        window.VibeHub ? resolve() : reject(new Error('VibeHub Beta SDK 未注册 window.VibeHub'));
      };
      script.addEventListener('load', loaded, { once: true });
      script.addEventListener(
        'error',
        () => {
          window.clearTimeout(timeout);
          reject(new Error('VibeHub Beta SDK 加载失败，请检查网络或内容拦截器'));
        },
        { once: true }
      );
      if (!existing) {
        script.src = VIBE_SDK_URL;
        script.dataset.vibehubSdk = VIBE_SDK_CHANNEL;
        document.head.appendChild(script);
      } else if (window.VibeHub) {
        loaded();
      }
    });
  }

  async login(): Promise<VibeUser> {
    if (!this.api) throw new Error('VibeHub 尚未初始化');
    return this.api.login();
  }

  logout(): void {
    this.leaveRoom();
    this.api?.logout();
  }

  async joinRoom(rawRoomId: string): Promise<RoomHandle> {
    if (!this.api) throw new Error('VibeHub 尚未初始化');
    if (!this.api.isLoggedIn()) throw new Error('请先登录 VibeHub');
    if (this.room) this.leaveRoom();
    const roomId = safeRoomId(rawRoomId);
    const meta = await this.api.rooms.get(roomId);
    if (meta) {
      const max = typeof meta.max === 'number' ? meta.max : MAX_ROOM_PLAYERS;
      if (max < MIN_ROOM_PLAYERS || max > MAX_ROOM_PLAYERS) {
        throw new Error(`房间人数必须为 ${MIN_ROOM_PLAYERS}–${MAX_ROOM_PLAYERS} 人`);
      }
      if (meta.open === false) throw new Error('房间已关闭');
      if (meta.players >= max) throw new Error('房间已满');
      this.roomMax = max;
    } else {
      this.roomMax = MAX_ROOM_PLAYERS;
    }
    this.room = await this.api.room.join(roomId, { topology: 'host', realtime: false });
    this.peerSeats.clear();
    this.seatPeers.clear();
    this.peerUsers.clear();
    this.seatUsers.clear();
    this.readyUserIds.clear();
    this.playerLoadouts.clear();
    this.loadoutReadyUserIds.clear();
    this.departedPeerIds.clear();
    this.playerIndex = this.room.isHost ? 0 : -1;
    if (this.room.isHost && this.api.user) this.rememberSeatUser(0, this.api.user);
    this.room.onMessage((message, fromId) => this.handleMessage(message, fromId));
    this.room.onPeer((event) => this.handlePeerEvent(event));
    this.humanCount = gameplayPeers(this.room, this.departedPeerIds).length + 1;
    this.botCount = 0;
    this.playerCount = this.humanCount;
    if (this.room.isHost) this.rebuildSeatsAndIdentities();
    if (!this.room.isHost) {
      this.sendGuestIdentity();
      this.requestSnapshot();
    }
    this.ensureLocalLoadoutSync();
    return this.room;
  }

  async createRoom(roomId: string, max: number, hostName: string): Promise<RoomHandle> {
    if (!Number.isInteger(max) || max < MIN_ROOM_PLAYERS || max > MAX_ROOM_PLAYERS) {
      throw new RangeError(`房间人数必须为 ${MIN_ROOM_PLAYERS}–${MAX_ROOM_PLAYERS} 人`);
    }
    const room = await this.joinRoom(roomId);
    this.roomMax = max;
    await room.announce({ open: true, listed: true, max, hostName, mode: 'host-authority' });
    return room;
  }

  async listRooms(): Promise<RoomMeta[]> {
    if (!this.api) throw new Error('VibeHub 尚未初始化');
    return (await this.api.rooms.list()).filter((room) => room.listed !== false);
  }

  async quickJoin(): Promise<string | null> {
    if (!this.api) throw new Error('VibeHub 尚未初始化');
    return this.api.rooms.quickJoin({
      filter: (room) => {
        const max = typeof room.max === 'number' ? room.max : MAX_ROOM_PLAYERS;
        return (
          room.open !== false &&
          max >= MIN_ROOM_PLAYERS &&
          max <= MAX_ROOM_PLAYERS &&
          room.players < max
        );
      },
    });
  }

  startGame(playerCount: number): void {
    if (!this.room?.isHost) throw new Error('只有房主可以开始对局');
    this.ensureLocalLoadoutSync();
    if (
      !Number.isInteger(playerCount) ||
      playerCount < MIN_ROOM_PLAYERS ||
      playerCount > MAX_ROOM_PLAYERS
    ) {
      throw new RangeError(`开局人数必须为 ${MIN_ROOM_PLAYERS}–${MAX_ROOM_PLAYERS} 人`);
    }
    if (!this.allPlayerLoadoutsReady) throw new Error('仍有玩家的出战构筑未同步完成');
    if (!this.allPlayersReady) throw new Error('所有真人玩家准备后才能开始对局');
    this.gameStarted = true;
    void this.room.announce({ open: false, listed: false });
    this.room.send({ type: 'gameStart', playerCount });
  }

  setReady(ready: boolean): boolean {
    if (!this.room || (ready && this.gameStarted)) return false;
    const userId = this.api?.user?.id;
    if (!userId) return false;
    if (ready && !this.isLocalLoadoutConfirmed) {
      this.ensureLocalLoadoutSync();
      this.onRoomUpdate?.(this.playerCount);
      return false;
    }
    if (this.room.isHost) {
      if (ready) this.readyUserIds.add(userId);
      else this.readyUserIds.delete(userId);
      this.broadcastRoomState();
      this.onRoomUpdate?.(this.playerCount);
      return true;
    }
    if (ready) this.readyUserIds.add(userId);
    else this.readyUserIds.delete(userId);
    this.room.send({ type: 'ready', ready }, this.room.hostId ?? undefined);
    this.onRoomUpdate?.(this.playerCount);
    return true;
  }

  /** 对局结算后保留房间连接，清空准备状态，等待所有人重新准备。 */
  returnToRoom(): void {
    if (!this.room) return;
    const userId = this.api?.user?.id;
    if (userId) this.readyUserIds.delete(userId);
    if (this.room.isHost) {
      this.gameStarted = false;
      this.humanCount = gameplayPeers(this.room, this.departedPeerIds).length + 1;
      this.botCount = Math.min(this.botCount, Math.max(0, this.roomMax - this.humanCount));
      this.rebuildSeatsAndIdentities();
      this.readyUserIds.clear();
      this.broadcastRoomState();
      this.onRoomUpdate?.(this.playerCount);
      void this.refreshLobbyAnnouncement();
      this.ensureLocalLoadoutSync();
      return;
    }
    this.room.send({ type: 'ready', ready: false }, this.room.hostId ?? undefined);
    this.ensureLocalLoadoutSync();
  }

  addBot(): boolean {
    if (!this.room?.isHost || this.gameStarted || this.playerCount >= this.roomMax) return false;
    this.botCount += 1;
    this.rebuildSeatsAndIdentities();
    this.broadcastRoomState();
    this.onRoomUpdate?.(this.playerCount);
    void this.refreshLobbyAnnouncement();
    return true;
  }

  removeBot(): boolean {
    if (!this.room?.isHost || this.gameStarted || this.botCount <= 0) return false;
    this.botCount -= 1;
    this.rebuildSeatsAndIdentities();
    this.broadcastRoomState();
    this.onRoomUpdate?.(this.playerCount);
    void this.refreshLobbyAnnouncement();
    return true;
  }

  /** 房主按 peer 定向发送权威快照；调用方负责按座位脱敏。 */
  hostSendState(state: unknown, player = 0): void {
    if (!this.room?.isHost) return;
    if (player === 0) {
      this.onStateReceived?.(state);
      return;
    }
    const peerId = this.seatPeers.get(player);
    if (peerId) this.room.send({ type: 'state', state }, peerId);
  }

  sendInput(action: unknown): void {
    if (!this.room) throw new Error('尚未加入房间');
    if (this.room.isHost) {
      this.onInputReceived?.(action, 0);
      return;
    }
    if (!this.room.hostId) throw new Error('正在等待房主连接');
    this.room.send({ type: 'input', action }, this.room.hostId);
  }

  requestSnapshot(): void {
    if (!this.room || this.room.isHost || !this.room.hostId) return;
    this.room.send({ type: 'snapshotRequest' }, this.room.hostId);
  }

  private handlePeerEvent(event: VibeHubSDK.PeerEvent): void {
    if ('id' in event && event.type === 'leave') {
      this.peerUsers.delete(event.id);
      this.departedPeerIds.add(event.id);
    } else if ('id' in event && event.type === 'join') {
      this.departedPeerIds.delete(event.id);
    }
    if (this.room?.isHost && (event.type === 'join' || event.type === 'leave')) {
      if (this.gameStarted) {
        if ('id' in event && event.type === 'leave') {
          const seat = this.peerSeats.get(event.id);
          this.peerSeats.delete(event.id);
          if (seat !== undefined) this.seatPeers.delete(seat);
          // 对局中冻结座位与身份；淘汰玩家离线不会使后续权威座位整体前移。
        }
        this.onPeerChange?.(event);
        return;
      }
      this.humanCount = gameplayPeers(this.room, this.departedPeerIds).length + 1;
      this.botCount = Math.min(this.botCount, Math.max(0, this.roomMax - this.humanCount));
      this.rebuildSeatsAndIdentities();
      this.broadcastRoomState();
      this.onRoomUpdate?.(this.playerCount);
      void this.refreshLobbyAnnouncement();
    }
    if (!this.room?.isHost && event.type === 'join') {
      this.sendGuestIdentity();
      this.requestSnapshot();
      this.restartLocalLoadoutSync();
    }
    this.onPeerChange?.(event);
  }

  private assignSeat(peerId: string): void {
    if (!this.room?.isHost) return;
    if (!this.peerSeats.has(peerId)) this.rebuildSeatsAndIdentities();
  }

  private rebuildSeatsAndIdentities(): void {
    if (!this.room?.isHost) return;
    const peers = gameplayPeers(this.room, this.departedPeerIds).map((peer) => peer.id);
    this.peerSeats.clear();
    this.seatPeers.clear();
    this.seatUsers.clear();
    if (this.api?.user) this.rememberSeatUser(0, this.api.user);
    peers.forEach((peerId, index) => {
      const seat = index + 1;
      this.peerSeats.set(peerId, seat);
      this.seatPeers.set(seat, peerId);
      const user = this.peerUsers.get(peerId);
      if (user) this.rememberSeatUser(seat, user);
      this.room?.send({ type: 'seat', player: seat }, peerId);
    });
    this.humanCount = peers.length + 1;
    for (let bot = 0; bot < this.botCount; bot++) {
      const seat = this.humanCount + bot;
      this.seatUsers.set(seat, {
        seat,
        id: `AI-BOT-${bot + 1}`,
        name: `机器人 ${bot + 1}`,
        image: null,
        isBot: true,
      });
    }
    this.playerCount = this.humanCount + this.botCount;
    const currentHumanIds = new Set(
      [...this.seatUsers.values()]
        .filter((identity) => !identity.isBot)
        .map((identity) => identity.id)
    );
    for (const id of this.readyUserIds) {
      if (!currentHumanIds.has(id)) this.readyUserIds.delete(id);
    }
    for (const id of this.playerLoadouts.keys()) {
      if (!currentHumanIds.has(id)) this.playerLoadouts.delete(id);
    }
    for (const id of this.loadoutReadyUserIds) {
      if (!currentHumanIds.has(id)) this.loadoutReadyUserIds.delete(id);
    }
  }

  private rememberSeatUser(seat: number, user: VibeUser): void {
    this.seatUsers.set(seat, {
      seat,
      id: user.id,
      name: user.name?.trim() || user.id,
      image: user.image,
    });
  }

  private broadcastRoomState(targetPeerId?: string): void {
    if (!this.room?.isHost) return;
    this.room.send(
      {
        type: 'roomState',
        playerCount: this.playerCount,
        humanPlayerCount: this.humanCount,
        botCount: this.botCount,
        maxPlayers: this.roomMax,
        gameStarted: this.gameStarted,
        readyPlayerIds: [...this.readyUserIds],
        loadoutPlayerIds: [...this.loadoutReadyUserIds],
        players: [...this.seatUsers.values()],
      },
      targetPeerId
    );
  }

  private handleMessage(message: unknown, fromId: string): void {
    if (!message || typeof message !== 'object') return;
    const msg = message as Record<string, unknown>;
    if (msg.type === 'state' && !this.room?.isHost) {
      this.onStateReceived?.(msg.state);
      return;
    }
    if (msg.type === 'seat' && !this.room?.isHost) {
      const player = Number(msg.player);
      if (Number.isInteger(player) && player >= 1 && player < MAX_ROOM_PLAYERS) {
        const seatChanged = this.playerIndex !== player;
        this.playerIndex = player;
        if (this.api?.user) this.rememberSeatUser(player, this.api.user);
        this.sendGuestIdentity();
        this.requestSnapshot();
        if (seatChanged || !this.localLoadoutConfirmed) this.restartLocalLoadoutSync();
      }
      return;
    }
    if (msg.type === 'loadoutAck' && !this.room?.isHost) {
      const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
      const userId = typeof msg.userId === 'string' ? msg.userId : '';
      if (
        this.pendingLoadout?.requestId === requestId &&
        userId === this.api?.user?.id &&
        Number(msg.player) === this.playerIndex
      ) {
        this.confirmedLoadoutFingerprint = this.pendingLoadout.fingerprint;
        this.localLoadoutConfirmed = true;
        this.localLoadoutError = null;
        this.loadoutReadyUserIds.add(userId);
        this.pendingLoadout = null;
        this.stopLoadoutRetry();
        this.onRoomUpdate?.(this.playerCount);
      }
      return;
    }
    if (msg.type === 'loadoutRejected' && !this.room?.isHost) {
      if (this.pendingLoadout?.requestId === msg.requestId) {
        this.localLoadoutError =
          typeof msg.reason === 'string' ? msg.reason : '房主拒绝了无效的出战构筑';
        this.onRoomUpdate?.(this.playerCount);
      }
      return;
    }
    if (msg.type === 'gameStart' && !this.room?.isHost) {
      const count = Number(msg.playerCount);
      if (Number.isInteger(count) && count >= MIN_ROOM_PLAYERS && count <= MAX_ROOM_PLAYERS) {
        this.gameStarted = true;
        this.onGameStart?.(count);
      }
      return;
    }
    if (msg.type === 'roomState' && !this.room?.isHost) {
      const count = Number(msg.playerCount);
      if (Number.isInteger(count) && count >= 1 && count <= MAX_ROOM_PLAYERS) {
        this.playerCount = count;
        const humans = Number(msg.humanPlayerCount);
        const bots = Number(msg.botCount);
        const max = Number(msg.maxPlayers);
        if (Number.isInteger(humans) && humans >= 1) this.humanCount = humans;
        if (Number.isInteger(bots) && bots >= 0) this.botCount = bots;
        if (Number.isInteger(max) && max >= MIN_ROOM_PLAYERS && max <= MAX_ROOM_PLAYERS)
          this.roomMax = max;
        this.gameStarted = msg.gameStarted === true;
        this.readyUserIds.clear();
        if (Array.isArray(msg.readyPlayerIds)) {
          for (const id of msg.readyPlayerIds) {
            if (typeof id === 'string') this.readyUserIds.add(id);
          }
        }
        this.loadoutReadyUserIds.clear();
        if (Array.isArray(msg.loadoutPlayerIds)) {
          for (const id of msg.loadoutPlayerIds) {
            if (typeof id === 'string') this.loadoutReadyUserIds.add(id);
          }
        }
        if (Array.isArray(msg.players)) {
          this.seatUsers.clear();
          for (const value of msg.players) {
            if (!value || typeof value !== 'object') continue;
            const identity = value as Partial<RoomPlayerIdentity>;
            if (
              Number.isInteger(identity.seat) &&
              typeof identity.id === 'string' &&
              typeof identity.name === 'string'
            ) {
              this.seatUsers.set(identity.seat!, {
                seat: identity.seat!,
                id: identity.id,
                name: identity.name,
                image: typeof identity.image === 'string' ? identity.image : null,
                isBot: identity.isBot === true,
              });
            }
          }
        }
        if (this.playerIndex >= 1 && this.api?.user && !this.seatUsers.has(this.playerIndex)) {
          this.rememberSeatUser(this.playerIndex, this.api.user);
        }
        this.onRoomUpdate?.(count);
      }
      return;
    }
    if (!this.room?.isHost) return;
    if (msg.type === 'hello') {
      const user = parseVibeUser(msg.user);
      if (!user) return;
      // hello 可能早于 onPeer(join) 或 peers() 列表更新；先缓存，座位建立后再绑定。
      this.peerUsers.set(fromId, user);
      this.assignSeat(fromId);
      const player = this.peerSeats.get(fromId);
      if (player !== undefined) {
        this.rememberSeatUser(player, user);
        this.broadcastRoomState();
        this.onRoomUpdate?.(this.playerCount);
      }
      return;
    }
    this.assignSeat(fromId);
    const authoritativePlayer = this.peerSeats.get(fromId);
    if (authoritativePlayer === undefined) return;
    if (msg.type === 'snapshotRequest') {
      this.onSnapshotRequested?.(authoritativePlayer);
    } else if (msg.type === 'loadout' && typeof msg.requestId === 'string') {
      const identity = this.seatUsers.get(authoritativePlayer);
      const loadout = parseBattleLoadout(msg.loadout);
      if (!(identity && loadout)) {
        this.room.send(
          {
            type: 'loadoutRejected',
            requestId: msg.requestId,
            reason: identity ? '出战牌库或英雄配置无效' : '玩家身份尚未完成绑定',
          },
          fromId
        );
        return;
      }
      const previous = this.playerLoadouts.get(identity.id);
      const changed = !previous || loadoutFingerprint(previous) !== loadoutFingerprint(loadout);
      this.playerLoadouts.set(identity.id, loadout);
      this.loadoutReadyUserIds.add(identity.id);
      if (changed) this.readyUserIds.delete(identity.id);
      // 对重复请求也必须重复确认：第一次 ACK 丢失时，客户端才能最终停止重传。
      this.room.send(
        {
          type: 'loadoutAck',
          requestId: msg.requestId,
          userId: identity.id,
          player: authoritativePlayer,
        },
        fromId
      );
      this.broadcastRoomState();
      this.onRoomUpdate?.(this.playerCount);
    } else if (msg.type === 'ready' && typeof msg.ready === 'boolean') {
      const identity = this.seatUsers.get(authoritativePlayer);
      if (
        identity &&
        (!this.gameStarted || msg.ready === false) &&
        (msg.ready === false || this.playerLoadouts.has(identity.id))
      ) {
        if (msg.ready) this.readyUserIds.add(identity.id);
        else this.readyUserIds.delete(identity.id);
        this.broadcastRoomState();
        this.onRoomUpdate?.(this.playerCount);
      }
    } else if (msg.type === 'input') {
      this.onInputReceived?.(msg.action, authoritativePlayer);
    }
  }

  /**
   * 在房间存续期间同步当前出战构筑。客人只有收到与本次 requestId 匹配的房主 ACK
   * 才会停止定时重传；房主则直接把自己的本地构筑登记为权威配置。
   */
  ensureLocalLoadoutSync(): void {
    if (!(this.room && this.api?.user)) return;
    const loadout = activeBattleLoadout();
    const fingerprint = loadoutFingerprint(loadout);
    const userId = this.api.user.id;
    if (this.room.isHost) {
      const previous = this.playerLoadouts.get(userId);
      const changed = !previous || loadoutFingerprint(previous) !== fingerprint;
      this.playerLoadouts.set(userId, loadout);
      this.loadoutReadyUserIds.add(userId);
      this.localLoadoutConfirmed = true;
      this.confirmedLoadoutFingerprint = fingerprint;
      this.localLoadoutError = null;
      if (changed) this.readyUserIds.delete(userId);
      this.broadcastRoomState();
      this.onRoomUpdate?.(this.playerCount);
      return;
    }

    if (this.localLoadoutConfirmed && this.confirmedLoadoutFingerprint === fingerprint) return;
    if (this.pendingLoadout?.fingerprint !== fingerprint) {
      this.pendingLoadout = { requestId: loadoutRequestId(), fingerprint, loadout };
      this.localLoadoutConfirmed = false;
      this.localLoadoutError = null;
      this.loadoutReadyUserIds.delete(userId);
    }
    this.sendPendingLoadout();
    this.startLoadoutRetry();
  }

  private restartLocalLoadoutSync(): void {
    if (!this.room || this.room.isHost) return;
    this.localLoadoutConfirmed = false;
    this.confirmedLoadoutFingerprint = null;
    this.pendingLoadout = null;
    this.stopLoadoutRetry();
    this.ensureLocalLoadoutSync();
  }

  private sendPendingLoadout(): void {
    if (
      !this.room ||
      this.room.isHost ||
      !this.room.hostId ||
      !this.pendingLoadout ||
      this.localLoadoutConfirmed
    )
      return;
    this.room.send(
      {
        type: 'loadout',
        requestId: this.pendingLoadout.requestId,
        loadout: this.pendingLoadout.loadout,
      },
      this.room.hostId
    );
  }

  private startLoadoutRetry(): void {
    if (this.loadoutRetryTimer !== null || this.localLoadoutConfirmed) return;
    this.loadoutRetryTimer = globalThis.setInterval(
      () => this.sendPendingLoadout(),
      LOADOUT_RETRY_MS
    );
  }

  private stopLoadoutRetry(): void {
    if (this.loadoutRetryTimer === null) return;
    globalThis.clearInterval(this.loadoutRetryTimer);
    this.loadoutRetryTimer = null;
  }

  leaveRoom(): void {
    this.stopLoadoutRetry();
    this.room?.leave();
    this.room = null;
    this.gameStarted = false;
    this.playerCount = 0;
    this.humanCount = 0;
    this.botCount = 0;
    this.roomMax = MAX_ROOM_PLAYERS;
    this.playerIndex = -1;
    this.peerSeats.clear();
    this.seatPeers.clear();
    this.peerUsers.clear();
    this.seatUsers.clear();
    this.readyUserIds.clear();
    this.playerLoadouts.clear();
    this.loadoutReadyUserIds.clear();
    this.departedPeerIds.clear();
    this.pendingLoadout = null;
    this.localLoadoutConfirmed = false;
    this.confirmedLoadoutFingerprint = null;
    this.localLoadoutError = null;
  }

  async closeRoom(): Promise<void> {
    if (this.room?.isHost) await this.room.close();
    this.leaveRoom();
  }

  async getSave<T>(keys: string[]): Promise<Record<string, T>> {
    if (!this.api?.isLoggedIn()) return {};
    return this.api.save.get<T>(keys);
  }

  async setSave<T>(key: string, value: T): Promise<void> {
    if (!this.api?.isLoggedIn()) return;
    await this.api.save.set(key, value);
  }

  get user(): VibeUser | null {
    return this.api?.user ?? null;
  }

  get isLoggedIn(): boolean {
    return this.api?.isLoggedIn() ?? false;
  }

  get sdkInfo(): { channel: string; version: string } {
    return {
      channel: window.VibeHub?.channel ?? '未加载',
      version: window.VibeHub?.version ?? '—',
    };
  }

  get isHost(): boolean {
    return this.room?.isHost ?? false;
  }

  get roomId(): string | null {
    return this.room?.roomId ?? null;
  }

  get playerSeats(): ReadonlyMap<string, number> {
    return this.peerSeats;
  }

  get playerIdentities(): ReadonlyMap<number, RoomPlayerIdentity> {
    return this.seatUsers;
  }

  playerIdentity(seat: number): RoomPlayerIdentity | null {
    if (seat === 0 && this.isHost && this.user) {
      this.rememberSeatUser(0, this.user);
    }
    return this.seatUsers.get(seat) ?? null;
  }

  isBotSeat(seat: number): boolean {
    return this.seatUsers.get(seat)?.isBot === true;
  }

  get humanPlayerCount(): number {
    return this.humanCount;
  }

  get botPlayerCount(): number {
    return this.botCount;
  }

  get maxPlayers(): number {
    return this.roomMax;
  }

  isPlayerReady(seat: number): boolean {
    const identity = this.seatUsers.get(seat);
    return Boolean(identity && (identity.isBot || this.readyUserIds.has(identity.id)));
  }

  playerLoadout(seat: number): BattleLoadout | null {
    const identity = this.seatUsers.get(seat);
    if (!identity || identity.isBot) return null;
    const loadout = this.playerLoadouts.get(identity.id);
    return loadout ? { heroId: loadout.heroId, deckCardIds: [...loadout.deckCardIds] } : null;
  }

  isPlayerLoadoutReady(seat: number): boolean {
    const identity = this.seatUsers.get(seat);
    return Boolean(identity && (identity.isBot || this.loadoutReadyUserIds.has(identity.id)));
  }

  get isLocalLoadoutConfirmed(): boolean {
    return this.localLoadoutConfirmed;
  }

  get loadoutSyncError(): string | null {
    return this.localLoadoutError;
  }

  get allPlayerLoadoutsReady(): boolean {
    const players = [...this.seatUsers.values()];
    return (
      players.length >= this.playerCount &&
      players.every((identity) => identity.isBot || this.loadoutReadyUserIds.has(identity.id))
    );
  }

  get allPlayersReady(): boolean {
    return (
      this.allPlayerLoadoutsReady &&
      areRoomPlayersReady(this.seatUsers.values(), this.readyUserIds, this.playerCount)
    );
  }

  private sendGuestIdentity(): void {
    if (!this.room || this.room.isHost || !this.room.hostId || !this.api?.user) return;
    this.room.send({ type: 'hello', user: this.api.user }, this.room.hostId);
  }

  private async refreshLobbyAnnouncement(): Promise<void> {
    if (!this.room?.isHost || this.gameStarted) return;
    await this.room.announce({
      open: this.playerCount < this.roomMax,
      listed: true,
      max: this.roomMax,
      mode: 'host-authority',
    });
  }
}
