/**
 * 普通 UI 按钮（DOM，非 3D）：
 * 屏幕右侧垂直居中对齐，像炉石的对局操作栏。
 */

export class UIActionBar {
  private el: HTMLDivElement;
  private buttons: HTMLButtonElement[] = [];

  constructor(private root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'action-bar';
    this.root.appendChild(this.el);
  }

  /** 添加按钮（返回实例便于后续更新状态） */
  addButton(
    label: string,
    onClick: () => void,
    variant: 'primary' | 'danger' | 'normal' = 'normal'
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `action-btn ${variant}`;
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    this.el.appendChild(btn);
    this.buttons.push(btn);
    return btn;
  }

  setDisabled(disabled: boolean): void {
    for (const b of this.buttons) b.disabled = disabled;
  }

  setButtonEnabled(index: number, enabled: boolean): void {
    const b = this.buttons[index];
    if (b) b.disabled = !enabled;
  }

  remove(): void {
    this.el.remove();
    this.buttons = [];
  }
}
