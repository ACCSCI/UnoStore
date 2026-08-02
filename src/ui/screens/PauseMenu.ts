/**
 * ESC 暂停菜单（对局中按 ESC 弹出）：
 * 继续对局 / 设置（三路音量） / 退出对局 / 离开房间返回大厅。
 */
import { SettingsPanel } from './SettingsPanel';

export class PauseMenu {
  private el: HTMLDivElement | null = null;
  private onClose: () => void;

  constructor(
    private root: HTMLElement,
    onClose: () => void
  ) {
    this.onClose = onClose;
  }

  /** 绑定 ESC 键（对局内生效） */
  bind(): void {
    window.addEventListener('keydown', this.handleKey);
  }

  unbind(): void {
    window.removeEventListener('keydown', this.handleKey);
    this.hide();
  }

  private handleKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      if (this.el) this.hide();
      else this.show();
    }
  };

  show(): void {
    if (this.el) return;
    this.el = document.createElement('div');
    this.el.className = 'pause-overlay';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'pause-title');
    const card = document.createElement('div');
    card.className = 'pause-card';
    const title = document.createElement('div');
    title.className = 'pause-title';
    title.id = 'pause-title';
    title.textContent = '⏸ 暂停';
    const resume = this.makeBtn('▶ 继续', () => this.hide());
    const settings = this.makeBtn('⚙ 设置', () => {
      new SettingsPanel(this.root).show();
    });
    const quit = this.makeBtn('🚪 退出对局', () => {
      this.hide();
      this.onClose();
    });
    card.append(title, resume, settings, quit);
    this.el.appendChild(card);
    this.root.appendChild(this.el);
    resume.focus();
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
  }

  private makeBtn(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn pause-btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }
}
