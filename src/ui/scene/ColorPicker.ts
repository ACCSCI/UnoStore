/**
 * 颜色选择弹窗（打出 Wild/万能+4 时显示）。
 * 四个彩色圆按钮 + 取消按钮，点击返回所选颜色或 null（取消）。
 */

const COLORS = [
  { id: 'red', label: '红', hex: '#e74c3c' },
  { id: 'yellow', label: '黄', hex: '#f1c40f' },
  { id: 'green', label: '绿', hex: '#2ecc71' },
  { id: 'blue', label: '蓝', hex: '#3498db' },
] as const;

export function pickColor(root: HTMLElement): Promise<'red' | 'yellow' | 'green' | 'blue' | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'color-picker-overlay';
    const card = document.createElement('div');
    card.className = 'color-picker-card';
    const title = document.createElement('div');
    title.className = 'color-picker-title';
    title.textContent = '选择颜色';
    const row = document.createElement('div');
    row.className = 'color-picker-row';
    for (const c of COLORS) {
      const btn = document.createElement('button');
      btn.className = 'color-btn';
      btn.style.background = c.hex;
      btn.title = c.label;
      btn.textContent = c.label;
      btn.addEventListener('click', () => {
        overlay.remove();
        resolve(c.id);
      });
      row.appendChild(btn);
    }
    const cancel = document.createElement('button');
    cancel.className = 'btn color-cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });
    card.append(title, row, cancel);
    overlay.appendChild(card);
    root.appendChild(overlay);
  });
}
