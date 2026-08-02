/**
 * 颜色选择弹窗（打出 Wild/万能+4 时显示）。
 * 四个彩色圆按钮 + 取消按钮，点击返回所选颜色或 null（取消）。
 */

const COLORS = [
  { id: 'red', label: '红' },
  { id: 'yellow', label: '黄' },
  { id: 'green', label: '绿' },
  { id: 'blue', label: '蓝' },
] as const;

export function pickColor(
  root: HTMLElement,
  options: { title?: string; allowCancel?: boolean } = {}
): Promise<'red' | 'yellow' | 'green' | 'blue' | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'color-picker-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'color-picker-title');
    const card = document.createElement('div');
    card.className = 'color-picker-card';
    const title = document.createElement('div');
    title.className = 'color-picker-title';
    title.id = 'color-picker-title';
    title.textContent = options.title ?? '选择颜色';
    const row = document.createElement('div');
    row.className = 'color-picker-row';
    for (const c of COLORS) {
      const btn = document.createElement('button');
      btn.className = `color-btn ${c.id}`;
      btn.type = 'button';
      btn.title = c.label;
      btn.textContent = c.label;
      btn.addEventListener('click', () => {
        overlay.remove();
        resolve(c.id);
      });
      row.appendChild(btn);
    }
    card.append(title, row);
    if (options.allowCancel !== false) {
      const cancel = document.createElement('button');
      cancel.className = 'btn color-cancel';
      cancel.type = 'button';
      cancel.textContent = '取消';
      cancel.addEventListener('click', () => {
        overlay.remove();
        resolve(null);
      });
      card.append(cancel);
    }
    overlay.appendChild(card);
    root.appendChild(overlay);
    row.querySelector<HTMLButtonElement>('button')?.focus();
  });
}
