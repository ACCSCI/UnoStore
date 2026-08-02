/** 炉石式回合操作：保留原生 button 语义，用 CSS 塑成立体宝石按钮。 */

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
    hint: string,
    onClick: () => void,
    variant: 'primary' | 'danger' | 'normal' = 'normal'
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `action-btn ${variant}`;
    btn.setAttribute('aria-label', label);
    const face = document.createElement('span');
    face.className = 'action-btn-face';
    const labelEl = document.createElement('strong');
    labelEl.textContent = label;
    const hintEl = document.createElement('small');
    hintEl.textContent = hint;
    face.append(labelEl, hintEl);
    btn.appendChild(face);
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

  setButtonHint(index: number, hint: string): void {
    const b = this.buttons[index];
    if (!b) return;
    b.title = hint;
    const hintEl = b.querySelector('small');
    if (hintEl) hintEl.textContent = hint;
  }

  setButtonAttention(index: number, attention: boolean): void {
    this.buttons[index]?.classList.toggle('attention', attention);
  }

  remove(): void {
    this.el.remove();
    this.buttons = [];
  }
}
