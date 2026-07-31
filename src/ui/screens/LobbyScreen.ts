import { getNet } from '../../net';
import { Screen } from './Screen';

/**
 * 房间大厅：房间列表 / 创建 / 加入 / 快速匹配。
 * 房间上限 2-8 人；房主可自由开局（≥2 人即可开，不强制）。
 */

const ROOM_MAX = 8;

export class LobbyScreen extends Screen {
  private listEl: HTMLElement | null = null;
  private refreshTimer: number | null = null;

  override async render(): Promise<void> {
    const wrap = this.el('div', 'lobby-wrap');
    const title = this.el('h2', 'screen-title', '🏠 房间大厅');
    const back = this.btn('← 返回', () => void this.exit(), 'btn-link');
    wrap.append(title, back);

    // 创建房间（房主自由开局：人数≥2 可开，也可等人）
    const createBtn = this.btn('＋ 创建房间', () => this.createRoom());
    const quickBtn = this.btn('⚡ 快速匹配', () => this.quickMatch());
    const actions = this.el('div', 'lobby-actions');
    actions.append(createBtn, quickBtn);
    wrap.append(actions);

    // 加入房间（房间号）
    const joinRow = this.el('div', 'lobby-join');
    const input = this.el('input') as HTMLInputElement;
    input.placeholder = '输入房间号加入';
    input.className = 'lobby-input';
    const joinBtn = this.btn('加入', () => {
      const id = input.value.trim();
      if (id) void this.joinRoomById(id);
    });
    joinRow.append(input, joinBtn);
    wrap.append(joinRow);

    this.listEl = this.el('div', 'lobby-list');
    wrap.append(this.listEl);
    this.root.append(wrap);

    // 刷新房间列表（房间大厅轮询是可接受的：低频、非实时对局状态）
    this.refreshTimer = window.setInterval(() => void this.refreshList(), 5000);
    void this.refreshList();
  }

  override exit(): void {
    if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
    super.exit();
  }

  private async refreshList(): Promise<void> {
    if (!this.listEl) return;
    try {
      const net = getNet();
      const rooms = await net.listRooms();
      this.listEl.innerHTML = '';
      if (rooms.length === 0) {
        this.listEl.textContent = '暂无房间，创建一个吧！';
        return;
      }
      for (const r of rooms) {
        const row = this.el('div', 'lobby-room');
        const info = this.el(
          'span',
          undefined,
          `${r.hostName ?? '房主'} 的房间  [${r.players}/${r.max}人]${r.mode ? ` ${r.mode}` : ''}`
        );
        const join = this.btn('加入', () => void this.joinRoomById(r.roomId));
        row.append(info, join);
        this.listEl.appendChild(row);
      }
    } catch (err) {
      this.listEl.textContent = `刷新失败：${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async createRoom(): Promise<void> {
    try {
      const net = getNet();
      const roomId = `uno-${Math.random().toString(36).slice(2, 8)}`;
      await net.createRoom(roomId, ROOM_MAX, '玩家');
      this.enterRoom(roomId);
    } catch (err) {
      alert(`创建失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async joinRoomById(roomId: string): Promise<void> {
    try {
      const net = getNet();
      await net.joinRoom(roomId);
      this.enterRoom(roomId);
    } catch (err) {
      alert(`加入失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async quickMatch(): Promise<void> {
    try {
      const net = getNet();
      const roomId = await net.quickJoin();
      if (!roomId) {
        alert('没有可加入的房间，创建一个吧！');
        return;
      }
      await net.joinRoom(roomId);
      this.enterRoom(roomId);
    } catch (err) {
      alert(`匹配失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private enterRoom(roomId: string): void {
    void import('./RoomScreen').then((m) => new m.RoomScreen(roomId).enter());
  }
}
