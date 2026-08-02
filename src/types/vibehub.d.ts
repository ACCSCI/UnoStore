declare namespace VibeHubSDK {
  interface User {
    id: string;
    name: string | null;
    image: string | null;
  }

  interface DataStore {
    set<T>(key: string, value: T, options?: { ttl?: number }): Promise<{ ok: true }>;
    get<T>(key: string): Promise<T | null>;
    get<T>(keys: string[]): Promise<Record<string, T>>;
    remove(key: string): Promise<{ ok: true }>;
  }

  interface RoomMetadata {
    roomId: string;
    players: number;
    owner?: string;
    hostPeerId?: string;
    open?: boolean;
    listed?: boolean;
    max?: number;
    [key: string]: unknown;
  }

  type PeerEvent =
    | { type: 'join' | 'leave' | 'connecting' | 'reconnecting'; id: string }
    | { type: 'relay'; id: string; active: boolean }
    | { type: 'error'; reason: string; detail: string };

  interface PeerInfo {
    id: string;
    open: boolean;
    latency: number;
    jitter: number;
    relay: boolean;
    realtime: boolean;
    reconnecting: boolean;
    /** 仅 relay 路径节点拥有 role；真实玩家连接没有该字段。 */
    role?: 'primary' | 'warm' | 'candidate';
    score?: number;
  }

  interface Room {
    readonly roomId: string;
    readonly peerId: string;
    readonly topology: 'host' | 'mesh';
    readonly isHost: boolean;
    readonly hostId: string | null;
    readonly data: DataStore;
    peers(): PeerInfo[];
    send(message: unknown, toPeerId?: string): void;
    onMessage(callback: (message: unknown, fromPeerId: string) => void): this;
    onPeer(callback: (event: PeerEvent) => void): this;
    announce(metadata?: Record<string, unknown>): Promise<{ ok: true }>;
    close(): Promise<{ ok: true }>;
    leave(): void;
  }

  interface Client {
    readonly work: string;
    readonly save: DataStore;
    readonly global: DataStore;
    readonly user: User | null;
    readonly rooms: {
      list(): Promise<RoomMetadata[]>;
      get(roomId: string): Promise<RoomMetadata | null>;
      quickJoin(options?: { filter?: (room: RoomMetadata) => boolean }): Promise<string | null>;
    };
    readonly room: {
      join(
        roomId: string,
        options?: { topology?: 'host' | 'mesh'; realtime?: false }
      ): Promise<Room>;
    };
    login(): Promise<User>;
    logout(): void;
    isLoggedIn(): boolean;
    onAuthChange(callback: (user: User | null) => void): () => void;
  }
}

declare const VibeHub: {
  readonly version: string;
  readonly channel: 'stable' | 'beta' | 'unknown';
  init(options: { work: string; apiBase?: string }): Promise<VibeHubSDK.Client>;
};

interface Window {
  VibeHub?: typeof VibeHub;
}
