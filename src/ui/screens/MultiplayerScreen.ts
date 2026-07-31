import { LobbyScreen } from './LobbyScreen';
import { MainMenuScreen } from './MainMenuScreen';
import { Screen } from './Screen';

/** 多人对战入口：登录 → 大厅 */
export class MultiplayerScreen extends Screen {
  override async render(): Promise<void> {
    const wrap = this.el('div', 'menu-wrap');
    const title = this.el('h2', 'screen-title', '⚡ 多人对战');
    const status = this.el('div', 'lobby-status', '正在连接…');
    wrap.append(title, status);
    this.root.append(wrap);

    // 动态加载网络层（按需，节省首屏流量）
    const { getNet } = await import('../../net/index');
    const net = getNet();
    try {
      await net.init('unostore');
      const user = await net.login();
      status.textContent = user ? `已登录：${user.name}` : '未登录（以游客身份加入）';
      // 进入大厅
      void new LobbyScreen().enter();
    } catch (err) {
      status.textContent = `连接失败：${err instanceof Error ? err.message : String(err)}`;
      const back = this.btn('← 返回', () => void new MainMenuScreen().enter());
      wrap.appendChild(back);
    }
  }
}
