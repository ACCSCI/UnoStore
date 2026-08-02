import { getNet } from '../../net';
import { MAX_ROOM_PLAYERS, MIN_ROOM_PLAYERS } from '../../net/NetworkLayer';
import { MainMenuScreen } from './MainMenuScreen';
import { MultiplayerScreen } from './MultiplayerScreen';
import { Screen } from './Screen';

export class LobbyScreen extends Screen {
  private listEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private maxPlayers = MAX_ROOM_PLAYERS;

  override async render(): Promise<void> {
    const net = getNet();
    if (!net.isLoggedIn) {
      void new MultiplayerScreen().enter();
      return;
    }
    const wrap = this.el('main', 'lobby-wrap');
    wrap.append(this.el('h2', 'screen-title', '🏠 VibeHub 联机大厅'));
    const identity = this.el('p', 'lobby-identity', `已登录：${net.user?.name ?? 'VibeHub 玩家'}`);
    const sdk = net.sdkInfo;
    identity.append(this.el('small', 'sdk-inline', `Beta ${sdk.version}`));
    wrap.append(identity);

    const actions = this.el('div', 'lobby-actions');
    const maxLabel = this.el('label', 'lobby-field');
    maxLabel.append(this.el('span', undefined, '房间人数'));
    const maxSelect = this.el('select', 'lobby-input') as HTMLSelectElement;
    for (let count = MIN_ROOM_PLAYERS; count <= MAX_ROOM_PLAYERS; count++) {
      const option = this.el('option') as HTMLOptionElement;
      option.value = String(count);
      option.textContent = `${count} 人`;
      option.selected = count === MAX_ROOM_PLAYERS;
      maxSelect.append(option);
    }
    maxSelect.addEventListener('change', () => {
      this.maxPlayers = Number(maxSelect.value);
    });
    maxLabel.append(maxSelect);
    actions.append(
      maxLabel,
      this.btn('＋ 创建房间', () => void this.createRoom(), 'btn btn-primary'),
      this.btn('⚡ 快速匹配', () => void this.quickMatch(), 'btn btn-secondary'),
      this.btn('刷新列表', () => void this.refreshList(), 'btn btn-quiet')
    );
    wrap.append(actions);

    const joinForm = this.el('form', 'lobby-join');
    joinForm.method = 'post';
    const label = this.el('label', 'lobby-field');
    label.append(this.el('span', undefined, '房间号'));
    const input = this.el('input', 'lobby-input') as HTMLInputElement;
    input.id = 'room-code';
    input.name = 'room';
    input.placeholder = '例如 uno-a1b2c3';
    input.autocomplete = 'off';
    input.required = true;
    input.minLength = 3;
    input.maxLength = 48;
    input.pattern = '[a-z0-9][a-z0-9-]{2,47}';
    label.append(input);
    const join = this.btn('加入房间', () => undefined, 'btn btn-secondary');
    join.type = 'submit';
    joinForm.append(label, join);
    joinForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (joinForm.reportValidity()) void this.joinRoomById(input.value);
    });
    wrap.append(joinForm);

    this.statusEl = this.el('p', 'lobby-status');
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'polite');
    this.listEl = this.el('section', 'lobby-list');
    this.listEl.setAttribute('aria-label', '可加入房间');
    wrap.append(this.statusEl, this.listEl);
    wrap.append(this.btn('← 返回主菜单', () => void new MainMenuScreen().enter(), 'btn btn-quiet'));
    this.root.append(wrap);
    await this.refreshList();
  }

  private async refreshList(): Promise<void> {
    if (!this.listEl) return;
    this.setStatus('正在刷新房间…');
    try {
      const rooms = await getNet().listRooms();
      this.listEl.replaceChildren();
      if (rooms.length === 0) {
        this.listEl.append(this.el('p', 'lobby-empty', '暂无公开房间，创建一个或使用快速匹配。'));
      }
      for (const room of rooms) {
        const max = typeof room.max === 'number' ? room.max : MAX_ROOM_PLAYERS;
        const row = this.el('article', 'lobby-room');
        const info = this.el('div');
        info.append(
          this.el('strong', undefined, String(room.hostName ?? 'VibeHub 玩家')),
          this.el('small', undefined, `${room.roomId} · ${room.players}/${max} 人`)
        );
        const button = this.btn('加入', () => void this.joinRoomById(room.roomId));
        button.disabled = room.open === false || room.players >= max;
        row.append(info, button);
        this.listEl.append(row);
      }
      this.setStatus(`已找到 ${rooms.length} 个公开房间。`);
    } catch (error) {
      this.setStatus(`刷新失败：${this.message(error)}`, true);
    }
  }

  private async createRoom(): Promise<void> {
    this.setStatus('正在创建房间…');
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(4));
      const code = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
      const roomId = `uno-${code}`;
      await getNet().createRoom(roomId, this.maxPlayers, getNet().user?.name ?? 'VibeHub 玩家');
      this.enterRoom(roomId);
    } catch (error) {
      this.setStatus(`创建失败：${this.message(error)}`, true);
    }
  }

  private async joinRoomById(roomId: string): Promise<void> {
    this.setStatus('正在加入房间…');
    try {
      await getNet().joinRoom(roomId);
      this.enterRoom(getNet().roomId ?? roomId);
    } catch (error) {
      this.setStatus(`加入失败：${this.message(error)}`, true);
    }
  }

  private async quickMatch(): Promise<void> {
    this.setStatus('正在快速匹配…');
    try {
      const roomId = await getNet().quickJoin();
      if (roomId) {
        await getNet().joinRoom(roomId);
        this.enterRoom(roomId);
      } else {
        this.setStatus('没有空房间，正在为你创建新房间…');
        await this.createRoom();
      }
    } catch (error) {
      this.setStatus(`匹配失败：${this.message(error)}`, true);
    }
  }

  private enterRoom(roomId: string): void {
    void import('./RoomScreen').then(({ RoomScreen }) => new RoomScreen(roomId).enter());
  }

  private setStatus(message: string, error = false): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = message;
    this.statusEl.classList.toggle('error', error);
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
