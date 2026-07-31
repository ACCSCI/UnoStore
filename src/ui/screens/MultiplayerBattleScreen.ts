import { createGame, dispatch } from '../../game';
import { Rng } from '../../game/core/rng';
import type { GameState } from '../../game/core/state';
import { getDeck } from '../../game/hearth/decks';
import { getNet } from '../../net';
import { GameView } from '../scene/GameView';
import { PauseMenu } from './PauseMenu';
import { Screen } from './Screen';

/**
 * 多人对局（host-authority）：
 * - 房主：本地 createGame(2-8人) → 收玩家输入 → 演算 → 广播权威状态
 * - 客户端：收房主状态快照 → 渲染（本地不演算，防作弊）
 * - 座位：玩家在房间内的 index = 座位
 */
export class MultiplayerBattleScreen extends Screen {
  private view: GameView | null = null;
  private hostState: GameState | null = null;
  private statusEl: HTMLElement | null = null;
  private timer: number | null = null;
  private pause: PauseMenu | null = null;

  override async render(): Promise<void> {
    const net = getNet();
    // 3D 场景
    const canvasHost = this.el('div', 'battle-canvas');
    this.root.append(canvasHost);
    this.view = new GameView(canvasHost);
    this.view.bindCallbacks({
      onCardClick: (id, isHearth) => this.onCardClicked(id, isHearth),
      onDrawClick: () => this.sendAction({ type: 'drawUno', player: this.mySeat() }),
      onEndClick: () => this.sendAction({ type: 'endTurn', player: this.mySeat() }),
    });
    this.view.start();
    this.view.setupScene(this.root);

    // 状态栏
    const panel = this.el('div', 'battle-panel');
    this.statusEl = this.el('div', 'battle-status', '连接中…');
    panel.append(this.statusEl);
    this.root.append(panel);

    // ESC 暂停菜单（退出对局/离开房间）
    this.pause = new PauseMenu(this.root, () => {
      void net
        .leaveRoom()
        .then(() => import('./LobbyScreen'))
        .then((m) => new m.LobbyScreen().enter());
    });
    this.pause.bind();

    if (net.isHost) {
      this.initHost();
    } else {
      this.initClient();
    }
  }

  private mySeat(): number {
    const net = getNet();
    // 座位 = 房间内 peers 中自己的 index（房主 = 0）
    if (net.isHost) return 0;
    return 1; // 简化：非房主 = 座位 1（多座位映射后续完善）
  }

  /** 房主：建局 + 收输入演算 + 广播 */
  private initHost(): void {
    const net = getNet();
    const count = Math.max(2, Math.min(net.playerCount, 8));
    this.hostState = createGame(count, getDeck('combo').cardIds, Date.now() % 100000);
    // 收输入（来自客户端）
    net.onInputReceived = (action, player) => {
      void player;
      if (!this.hostState) return;
      const r = dispatch(this.hostState, new Rng(1), action as never);
      if (r.ok) {
        // 广播权威状态
        net.hostBroadcast({
          turn: this.hostState.turn,
          players: this.hostState.players.map((p) => ({
            handCount: p.hand.length,
            hearthHand: p.hearthHand,
            free: p.free,
            frozen: p.frozen,
          })),
          topCard: this.hostState.topCard,
          phase: this.hostState.phase,
        });
        this.refreshHostUI();
      }
    };
    // 房主自己的输入
    net.sendInput = undefined as never; // 房主走本地
    this.refreshHostUI();
  }

  private refreshHostUI(): void {
    if (!(this.hostState && this.statusEl)) return;
    const s = this.hostState;
    const p = s.players[0]!;
    this.statusEl.textContent = `房主视角 回合: 玩家 ${s.turn} | 水晶 ${p.free}/${p.frozen} | 顶牌: ${s.topCard.value}`;
  }

  /** 客户端：收房主状态 → 渲染 */
  private initClient(): void {
    const net = getNet();
    net.onStateReceived = (state) => {
      const s = state as { turn: number; topCard: { value: string }; players: unknown[] };
      if (this.statusEl) {
        this.statusEl.textContent = `回合: 玩家 ${s.turn} | 顶牌: ${s.topCard.value}`;
      }
    };
  }

  private sendAction(action: {
    type: string;
    player: number;
    cardIdx?: number;
    color?: string;
  }): void {
    const net = getNet();
    if (net.isHost) {
      net.onInputReceived?.(action, this.mySeat());
    } else {
      net.sendInput(action);
    }
  }

  private onCardClicked(id: string, isHearth: boolean): void {
    if (isHearth) return; // 炉石牌多人简化：V1 只处理 Uno
    const net = getNet();
    const seat = this.mySeat();
    if (net.isHost && this.hostState) {
      const idx = this.hostState.players[seat]!.hand.findIndex((c) => c.id === id);
      if (idx >= 0) this.sendAction({ type: 'playUno', player: seat, cardIdx: idx });
    } else {
      // 客户端：需要知道手牌索引 → 简化 V1：客户端不发手牌操作（由房主全权驱动）
      this.sendAction({ type: 'playUno', player: seat, cardIdx: 0 });
    }
  }

  override exit(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.pause?.unbind();
    this.view?.dispose();
    getNet().onInputReceived = undefined;
    getNet().onStateReceived = undefined;
    super.exit();
  }
}
