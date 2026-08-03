import { activeDeck, loadLoadoutProfile } from '../../game/loadout';
import { getNet } from '../../net';
import { vibeHubErrorMessage } from '../../net/NetworkLayer';
import { audio } from '../audio/AudioManager';
import { resolveCloudSaveConflicts } from './CloudSaveConflictDialog';
import { Screen } from './Screen';
import { SettingsPanel } from './SettingsPanel';

/** 首屏同时承载可选登录；未登录时剧情和牌组只保存在本机。 */
export class MainMenuScreen extends Screen {
  private accountEl: HTMLElement | null = null;
  private accountStatusEl: HTMLElement | null = null;
  private loginButton: HTMLButtonElement | null = null;
  private multiplayerButton: HTMLButtonElement | null = null;

  override async render(): Promise<void> {
    document.title = 'UnoStore · 双卡流冒险';
    const wrap = this.el('div', 'menu-wrap');
    const shell = this.el('main', 'menu-shell');
    const copy = this.el('section', 'menu-copy');
    const eyebrow = this.el('p', 'eyebrow', 'STORY CARD TABLE · SEASON 01');
    const title = this.el('h1', 'menu-title');
    title.innerHTML = '<span>UNO</span><em>× 炉石</em>';
    const sub = this.el(
      'p',
      'menu-sub',
      '一手颜色，一手魔法。把数字变成水晶，在牌桌上写完你的冒险。'
    );
    this.accountEl = this.el('section', 'menu-account');
    this.accountEl.setAttribute('aria-label', 'VibeHub 登录与存档');
    this.accountStatusEl = this.el(
      'p',
      'menu-account-status',
      '未登录：剧情进度和出战牌库仅保存在本机。'
    );
    this.accountStatusEl.setAttribute('role', 'status');
    this.accountStatusEl.setAttribute('aria-live', 'polite');
    const actions = this.el('div', 'menu-actions');
    copy.append(eyebrow, title, sub, this.accountEl, this.accountStatusEl, actions);

    const btnStory = this.btn(
      '单人剧情',
      () => void import('./ChapterSelectScreen').then((m) => new m.ChapterSelectScreen().enter()),
      'btn btn-primary'
    );
    const btnLocal = this.btn(
      '单机混战 · 2–8 人',
      () => this.openLocalBattleDialog(),
      'btn btn-secondary'
    );
    const btnRules = this.btn(
      '规则 · 牌组 · 英雄',
      () => void import('./LoadoutScreen').then((m) => new m.LoadoutScreen().enter()),
      'btn btn-secondary'
    );
    this.multiplayerButton = this.btn(
      '多人对战',
      () => void import('./LobbyScreen').then((m) => new m.LobbyScreen().enter()),
      'btn btn-secondary'
    );
    this.multiplayerButton.disabled = true;
    this.multiplayerButton.title = '登录 VibeHub 后可进入联机大厅';
    const btnSettings = this.btn(
      '⚙ 设置',
      () => new SettingsPanel(this.root).show(),
      'btn btn-quiet'
    );
    actions.append(btnStory, btnLocal, btnRules, this.multiplayerButton, btnSettings);

    const deck = this.el('div', 'menu-deck');
    deck.setAttribute('aria-hidden', 'true');
    for (const [kind, mark] of [
      ['uno-red', '7'],
      ['uno-blue', '↺'],
      ['hearth', '✦'],
    ] as const) {
      const card = this.el('div', `hero-card ${kind}`);
      card.appendChild(this.el('span', undefined, mark));
      deck.appendChild(card);
    }
    deck.appendChild(this.el('div', 'deck-seal', 'DUAL DECK'));
    shell.append(copy, deck);
    wrap.appendChild(shell);
    this.root.appendChild(wrap);

    audio.playMusic('/assets/audio/music/menu_theme.mp3');
    const net = getNet();
    net.onAuthChange = () => this.refreshAccount();
    try {
      await net.init();
      this.refreshAccount();
      if (net.isLoggedIn) await this.syncCloudSaves();
    } catch (error) {
      this.setAccountStatus(
        `VibeHub 暂不可用：${this.message(error)}。本地存档仍可正常使用。`,
        true
      );
      this.refreshAccount();
    }
  }

  private refreshAccount(): void {
    if (!this.accountEl) return;
    const net = getNet();
    const user = net.user;
    this.accountEl.replaceChildren();
    if (user) {
      const identity = this.el('span', 'menu-account-identity');
      identity.append(
        this.el('strong', undefined, user.name?.trim() || 'VibeHub 玩家'),
        this.el('small', undefined, `ID ${user.id}`)
      );
      const logout = this.btn(
        '退出登录',
        () => {
          net.logout();
          this.setAccountStatus('已退出登录；后续修改只保存在本机。');
          this.refreshAccount();
        },
        'btn btn-quiet'
      );
      this.accountEl.append(identity, logout);
    } else {
      this.accountEl.append(
        this.el('span', 'menu-account-copy', '登录后可使用云存档、联机大厅与快速匹配。')
      );
      this.loginButton = this.btn('登录 VibeHub', () => void this.login(), 'btn btn-secondary');
      this.accountEl.append(this.loginButton);
    }
    if (this.multiplayerButton) {
      this.multiplayerButton.disabled = !user;
      this.multiplayerButton.title = user ? '' : '登录 VibeHub 后可进入联机大厅';
    }
  }

  private async login(): Promise<void> {
    if (this.loginButton) this.loginButton.disabled = true;
    this.setAccountStatus('等待 VibeHub 登录授权…');
    try {
      await getNet().login();
      this.refreshAccount();
      await this.syncCloudSaves();
    } catch (error) {
      this.setAccountStatus(`登录失败：${this.message(error)}`, true);
    } finally {
      if (this.loginButton) this.loginButton.disabled = false;
    }
  }

  private async syncCloudSaves(): Promise<void> {
    this.setAccountStatus('正在比较本地与云端存档…');
    try {
      const conflicts = await resolveCloudSaveConflicts(this.root);
      this.setAccountStatus(
        conflicts > 0 ? `已处理 ${conflicts} 项存档冲突并完成同步。` : '本地与云端存档已同步。'
      );
    } catch (error) {
      this.setAccountStatus(`云存档检查失败：${this.message(error)}`, true);
    }
  }

  private openLocalBattleDialog(): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'local-battle-dialog';
    dialog.setAttribute('aria-labelledby', 'local-battle-title');
    const title = this.el('h2', undefined, '开始单机混战');
    title.id = 'local-battle-title';
    const label = document.createElement('label');
    label.htmlFor = 'local-player-count';
    label.textContent = '对局人数（你 + AI）';
    const select = document.createElement('select');
    select.id = 'local-player-count';
    for (let count = 2; count <= 8; count++) {
      const option = document.createElement('option');
      option.value = String(count);
      option.textContent = `${count} 人`;
      option.selected = count === 4;
      select.append(option);
    }
    const controls = this.el('div', 'local-battle-dialog-actions');
    controls.append(
      this.btn('取消', () => dialog.close(), 'btn btn-quiet'),
      this.btn(
        '开始对局',
        () => {
          const count = Number(select.value);
          dialog.close();
          this.startLocalBattle(count);
        },
        'btn btn-primary'
      )
    );
    dialog.append(title, label, select, controls);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    this.root.append(dialog);
    dialog.showModal();
    select.focus();
  }

  private startLocalBattle(playerCount: number): void {
    const profile = loadLoadoutProfile();
    const deck = activeDeck(profile);
    const match = {
      id: `local-${playerCount}-player`,
      opponent: 'local-ai',
      opponentName: 'AI 联盟',
      difficulty: 'normal' as const,
      intro: [{ speaker: 'system', text: `${playerCount} 人单机混战开始。` }],
      outro: [],
    };
    void import('./BattleScreen').then(({ BattleScreen }) =>
      new BattleScreen(match, {
        playerCount,
        localTest: true,
        heroId: profile.activeHeroId,
        deckCardIds: [...deck.cardIds],
      }).enter()
    );
  }

  private setAccountStatus(message: string, error = false): void {
    if (!this.accountStatusEl) return;
    this.accountStatusEl.textContent = message;
    this.accountStatusEl.classList.toggle('error', error);
  }

  private message(error: unknown): string {
    return vibeHubErrorMessage(error);
  }

  override exit(): void {
    getNet().onAuthChange = undefined;
    super.exit();
  }
}
