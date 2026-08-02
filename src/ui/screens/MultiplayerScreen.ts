import { getNet } from '../../net';
import { resolveCloudSaveConflicts } from './CloudSaveConflictDialog';
import { LobbyScreen } from './LobbyScreen';
import { MainMenuScreen } from './MainMenuScreen';
import { Screen } from './Screen';

/** VibeHub Beta 登录入口；未登录时不允许进入大厅。 */
export class MultiplayerScreen extends Screen {
  private status: HTMLElement | null = null;
  private account: HTMLElement | null = null;
  private loginButton: HTMLButtonElement | null = null;
  private lobbyButton: HTMLButtonElement | null = null;

  override async render(): Promise<void> {
    const wrap = this.el('main', 'lobby-wrap auth-screen');
    wrap.append(this.el('h2', 'screen-title', '⚡ VibeHub 多人对战'));
    const channel = this.el('p', 'sdk-channel', 'VibeHub SDK · 正在验证 Beta 通道…');
    this.account = this.el('section', 'vibehub-account');
    this.account.setAttribute('aria-label', 'VibeHub 账号');
    this.status = this.el('p', 'lobby-status', '正在连接 VibeHub…');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');

    this.loginButton = this.btn('登录 VibeHub', () => void this.login(), 'btn btn-primary');
    this.loginButton.disabled = true;
    this.lobbyButton = this.btn(
      '进入联机大厅',
      () => void new LobbyScreen().enter(),
      'btn btn-secondary'
    );
    this.lobbyButton.hidden = true;
    const back = this.btn('← 返回主菜单', () => void new MainMenuScreen().enter(), 'btn btn-quiet');
    const actions = this.el('div', 'lobby-actions');
    actions.append(this.loginButton, this.lobbyButton, back);
    wrap.append(channel, this.account, this.status, actions);
    this.root.append(wrap);

    const net = getNet();
    net.onAuthChange = () => this.refreshAccount();
    try {
      await net.init();
      const sdk = net.sdkInfo;
      channel.textContent = `VibeHub SDK ${sdk.version} · ${sdk.channel.toUpperCase()} 通道`;
      channel.classList.toggle('verified', sdk.channel === 'beta');
      this.loginButton.disabled = false;
      if (net.isLoggedIn) {
        this.setStatus('正在同步个人云存档…');
        await resolveCloudSaveConflicts(this.root);
      }
      this.refreshAccount();
    } catch (error) {
      channel.textContent = 'VibeHub SDK · 配置未完成';
      this.setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }

  private async login(): Promise<void> {
    if (!this.loginButton) return;
    this.loginButton.disabled = true;
    this.setStatus('等待 VibeHub 登录授权…');
    try {
      await getNet().login();
      this.setStatus('登录成功，正在同步云存档…');
      await resolveCloudSaveConflicts(this.root);
      this.setStatus('云存档已同步，可以进入大厅。');
      this.refreshAccount();
    } catch (error) {
      this.setStatus(`登录失败：${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      if (this.loginButton) this.loginButton.disabled = false;
    }
  }

  private refreshAccount(): void {
    if (!(this.account && this.loginButton && this.lobbyButton)) return;
    const user = getNet().user;
    this.account.replaceChildren();
    if (user) {
      this.account.append(this.el('strong', undefined, user.name ?? 'VibeHub 玩家'));
      const logout = this.btn(
        '退出登录',
        () => {
          getNet().logout();
          this.setStatus('已退出 VibeHub。');
          this.refreshAccount();
        },
        'btn btn-quiet'
      );
      this.account.append(logout);
    } else {
      this.account.append(this.el('p', undefined, '登录后可使用个人云存档、房间和快速匹配。'));
    }
    this.loginButton.hidden = Boolean(user);
    this.lobbyButton.hidden = !user;
  }

  private setStatus(message: string, error = false): void {
    if (!this.status) return;
    this.status.textContent = message;
    this.status.classList.toggle('error', error);
  }

  override exit(): void {
    getNet().onAuthChange = undefined;
    super.exit();
  }
}
