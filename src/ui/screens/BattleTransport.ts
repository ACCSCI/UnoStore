import type { HeroId } from '../../game/heroes';
import type { BattleLoadout } from '../../game/loadout';
import { getNet } from '../../net';
import type { NetworkLayer, RoomPlayerIdentity, VibeUser } from '../../net/NetworkLayer';

/** The only permitted difference between local and online multiplayer battles. */
export interface BattleTransport {
  readonly kind: 'local' | 'vibehub';
  readonly isHost: boolean;
  readonly playerCount: number;
  readonly playerIndex: number;
  readonly roomId: string | null;
  readonly user: VibeUser | null;
  onStateReceived?: (state: unknown) => void;
  onInputReceived?: (action: unknown, player: number) => void;
  onSnapshotRequested?: (player: number) => void;
  playerIdentity(seat: number): RoomPlayerIdentity | null;
  playerLoadout(seat: number): BattleLoadout | null;
  isBotSeat(seat: number): boolean;
  hostSendState(state: unknown, player?: number): void;
  sendInput(action: unknown): void;
  requestSnapshot(): void;
  returnToRoom(): void;
  leaveRoom(): void;
}

export class VibeHubBattleTransport implements BattleTransport {
  readonly kind = 'vibehub' as const;

  constructor(private readonly net: NetworkLayer = getNet()) {}

  get isHost(): boolean {
    return this.net.isHost;
  }
  get playerCount(): number {
    return this.net.playerCount;
  }
  get playerIndex(): number {
    return this.net.playerIndex;
  }
  get roomId(): string | null {
    return this.net.roomId;
  }
  get user(): VibeUser | null {
    return this.net.user;
  }
  get onStateReceived(): ((state: unknown) => void) | undefined {
    return this.net.onStateReceived;
  }
  set onStateReceived(callback: ((state: unknown) => void) | undefined) {
    this.net.onStateReceived = callback;
  }
  get onInputReceived(): ((action: unknown, player: number) => void) | undefined {
    return this.net.onInputReceived;
  }
  set onInputReceived(callback: ((action: unknown, player: number) => void) | undefined) {
    this.net.onInputReceived = callback;
  }
  get onSnapshotRequested(): ((player: number) => void) | undefined {
    return this.net.onSnapshotRequested;
  }
  set onSnapshotRequested(callback: ((player: number) => void) | undefined) {
    this.net.onSnapshotRequested = callback;
  }
  playerIdentity(seat: number): RoomPlayerIdentity | null {
    return this.net.playerIdentity(seat);
  }
  playerLoadout(seat: number): BattleLoadout | null {
    return this.net.playerLoadout(seat);
  }
  isBotSeat(seat: number): boolean {
    return this.net.isBotSeat(seat);
  }
  hostSendState(state: unknown, player = 0): void {
    this.net.hostSendState(state, player);
  }
  sendInput(action: unknown): void {
    this.net.sendInput(action);
  }
  requestSnapshot(): void {
    this.net.requestSnapshot();
  }
  returnToRoom(): void {
    this.net.returnToRoom();
  }
  leaveRoom(): void {
    this.net.leaveRoom();
  }
}

export interface LocalBattleTransportOptions {
  playerCount: number;
  heroId: HeroId;
  deckCardIds: readonly string[];
  playerName?: string;
}

/** In-process reliable transport used by local multiplayer and the dev simulator. */
export class LocalBattleTransport implements BattleTransport {
  readonly kind = 'local' as const;
  readonly isHost = true;
  readonly playerIndex = 0;
  readonly roomId = null;
  readonly user: VibeUser;
  readonly playerCount: number;
  onStateReceived?: (state: unknown) => void;
  onInputReceived?: (action: unknown, player: number) => void;
  onSnapshotRequested?: (player: number) => void;
  private readonly loadout: BattleLoadout;

  constructor(options: LocalBattleTransportOptions) {
    this.playerCount = Math.max(2, Math.min(options.playerCount, 8));
    this.user = { id: 'local-player', name: options.playerName ?? '你', image: null };
    this.loadout = { heroId: options.heroId, deckCardIds: [...options.deckCardIds] };
  }

  playerIdentity(seat: number): RoomPlayerIdentity | null {
    if (seat < 0 || seat >= this.playerCount) return null;
    if (seat === 0) return { seat, id: this.user.id, name: this.user.name ?? '你', image: null };
    return { seat, id: `local-bot-${seat}`, name: `AI ${seat}`, image: null, isBot: true };
  }

  playerLoadout(seat: number): BattleLoadout | null {
    return seat === 0
      ? { heroId: this.loadout.heroId, deckCardIds: [...this.loadout.deckCardIds] }
      : null;
  }

  isBotSeat(seat: number): boolean {
    return seat > 0 && seat < this.playerCount;
  }

  hostSendState(state: unknown, player = 0): void {
    if (player === 0) this.onStateReceived?.(state);
  }

  sendInput(action: unknown): void {
    this.onInputReceived?.(action, 0);
  }

  requestSnapshot(): void {
    this.onSnapshotRequested?.(0);
  }

  returnToRoom(): void {}
  leaveRoom(): void {}
}
