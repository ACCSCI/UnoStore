/**
 * VibeHub 网络层（Phase 6 多人联机）。
 * 同步模型声明：host-authority（房主权威）
 *   —— 回合制 + 防作弊 + 2-8 人规模，房主收输入→演算→广播权威状态，客户端只渲染。
 *
 * 用法：
 *   const net = new NetworkLayer('unostore');
 *   await net.init();           // 初始化 + 登录（可跳过）
 *   await net.joinRoom(id);     // 加入房间（topology: host）
 *   net.onState = (state) => {} // 客户端收到房主广播的状态
 *   net.sendInput(action)       // 玩家输入（发给房主）
 *   net.hostBroadcast(state)    // 房主广播权威状态
 */

// 绝对地址引入 SDK（红线：不能用相对路径）
declare global {
  interface Window {
    VibeHub?: {
      init: (opts: { work: string }) => Promise<{
        login: () => Promise<{ id: string; name: string; image: string }>;
        logout: () => Promise<void>;
        room: {
          join: (roomId: string, opts?: { topology?: 'host' | 'mesh' }) => Promise<RoomHandle>;
          data: {
            set: (key: string, value: unknown, opts?: { ttl?: number }) => Promise<void>;
            get: (keys: string[]) => Promise<Record<string, unknown>>;
          };
        };
        rooms: {
          list: () => Promise<RoomMeta[]>;
          get: (roomId: string) => Promise<RoomMeta | null>;
          quickJoin: (opts: { filter: (r: RoomMeta) => boolean }) => Promise<string | null>;
        };
        save: {
          get: (keys: string[]) => Promise<Record<string, unknown>>;
          set: (key: string, value: unknown) => Promise<void>;
        };
        global: {
          get: (keys: string[]) => Promise<Record<string, unknown>>;
        };
        onAuthChange: (
          cb: (user: { id: string; name: string; image: string } | null) => void
        ) => void;
      }>;
    };
  }
}

export interface RoomMeta {
  roomId: string;
  players: number;
  open: boolean;
  max: number;
  /** 自定义字段（如 mode / hostName） */
  [key: string]: unknown;
}

export interface RoomHandle {
  roomId: string;
  isHost: boolean;
  peerId: string;
  peers: () => { id: string; open: boolean; latency?: number }[];
  send: (msg: unknown, to?: string) => void;
  announce: (meta: Record<string, unknown>) => Promise<void>;
  close: () => Promise<void>;
  leave: () => Promise<void>;
  onMessage: (cb: (msg: unknown, fromId: string) => void) => void;
  onPeer: (cb: (e: { type: string; id: string; reason?: string }) => void) => void;
}

// beta SDK 绝对地址（红线：不能用相对路径）
const SDK_URL = 'https://vibe.lumigrav.space/sdk/beta/vibehub.js';

export class NetworkLayer {
  private api: Awaited<ReturnType<NonNullable<Window['VibeHub']>['init']>> | null = null;
  private room: RoomHandle | null = null;
  /** 对局进行中（房主收到输入后演算） */
  gameStarted = false;
  /** 房间内玩家数（含自己） */
  playerCount = 0;

  /** 房主：广播权威状态快照（压缩：只发状态变化的关键字段） */
  onHostBroadcast?: (msg: {
    type: string;
    state?: unknown;
    action?: unknown;
    player?: number;
  }) => void;
  /** 客户端：收到房主广播的状态 */
  onStateReceived?: (state: unknown) => void;
  /** 客户端：收到其他玩家的输入（房主监听） */
  onInputReceived?: (action: unknown, player: number) => void;
  /** 玩家进出 */
  onPeerChange?: (e: { type: string; id: string; reason?: string }) => void;
  /** 登录状态变化 */
  onAuthChange?: (user: { id: string; name: string; image: string } | null) => void;

  /** 动态加载 SDK（按需，节省流量） */
  async init(work: string): Promise<void> {
    if (this.api) return;
    if (!window.VibeHub) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = SDK_URL;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('VibeHub SDK 加载失败'));
        document.head.appendChild(s);
      });
    }
    this.api = await window.VibeHub!.init({ work });
    this.api.onAuthChange((u) => this.onAuthChange?.(u));
  }

  /** 登录（可选，不登录也能进房间但无身份） */
  async login(): Promise<{ id: string; name: string; image: string } | null> {
    if (!this.api) return null;
    try {
      return await this.api.login();
    } catch {
      return null;
    }
  }

  /** 加入房间（host 拓扑；第一个 join 的原子认领为房主） */
  async joinRoom(roomId: string): Promise<RoomHandle> {
    if (!this.api) throw new Error('未初始化');
    this.room = await this.api.room.join(roomId, { topology: 'host' });
    this.room.onMessage((msg, fromId) => this.handleMessage(msg, fromId));
    this.room.onPeer((e) => {
      const peers = this.room?.peers() ?? [];
      if (e.type === 'join') this.playerCount = peers.length + 1;
      if (e.type === 'leave') this.playerCount = peers.length + 1;
      this.onPeerChange?.(e);
    });
    this.playerCount = this.room.peers().length + 1;
    return this.room;
  }

  /** 创建房间并发布到大厅 */
  async createRoom(roomId: string, max: number, hostName: string): Promise<RoomHandle> {
    const room = await this.joinRoom(roomId);
    await room.announce({ open: true, listed: true, max, hostName, mode: '多人对战' });
    return room;
  }

  /** 大厅：房间列表 */
  async listRooms(): Promise<RoomMeta[]> {
    if (!this.api) return [];
    return this.api.rooms.list();
  }

  /** 快速匹配：加入第一个有空位的房间，没有则返回 null */
  async quickJoin(): Promise<string | null> {
    if (!this.api) return null;
    return this.api.rooms.quickJoin({ filter: (r) => (r.open ?? true) && r.players < r.max });
  }

  /** 房主：广播权威状态（快照合并，按需发送） */
  hostBroadcast(state: unknown): void {
    if (!this.room?.isHost) return;
    this.room.send({ type: 'state', state });
  }

  /** 客户端：发送输入给房主 */
  sendInput(action: unknown): void {
    if (!this.room) return;
    // 发给自己（房主）或发给房主 peer
    if (this.room.isHost) {
      this.handleMessage({ type: 'input', action, player: 0 }, 'self');
    } else {
      this.room.send({ type: 'input', action }, this.room.peers()[0]?.id);
    }
  }

  private handleMessage(msg: unknown, _fromId: string): void {
    const m = msg as { type?: string; state?: unknown; action?: unknown; player?: number };
    if (!m || typeof m !== 'object') return;
    if (m.type === 'state' && !this.room?.isHost) {
      this.onStateReceived?.(m.state);
    } else if (m.type === 'input') {
      this.onInputReceived?.(m.action, m.player ?? 0);
    }
  }

  /** 离开房间 */
  async leaveRoom(): Promise<void> {
    if (this.room) {
      await this.room.leave();
      this.room = null;
    }
    this.gameStarted = false;
  }

  /** 关闭房间（房主） */
  async closeRoom(): Promise<void> {
    if (this.room?.isHost) await this.room.close();
    await this.leaveRoom();
  }

  get isHost(): boolean {
    return this.room?.isHost ?? false;
  }

  get roomId(): string | null {
    return this.room?.roomId ?? null;
  }
}
