export interface PlayerChoice {
  id: number;
  label: string;
  cardCount: number;
}

interface PlayerPickerOptions {
  title?: string;
  hint?: string;
  countLabel?: (choice: PlayerChoice) => string;
}

/** No Mercy 数字 7 的强制换牌目标选择。 */
export function pickPlayer(
  root: HTMLElement,
  choices: PlayerChoice[],
  options: PlayerPickerOptions = {}
): Promise<number | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'player-picker-dialog';
    dialog.setAttribute('aria-labelledby', 'player-picker-title');

    const panel = document.createElement('div');
    panel.className = 'player-picker-card';
    const title = document.createElement('h2');
    title.id = 'player-picker-title';
    title.textContent = options.title ?? '数字 7：选择换牌玩家';
    const hint = document.createElement('p');
    hint.textContent = options.hint ?? '你必须与一名仍在对局中的玩家交换全部 UNO 手牌。';
    const list = document.createElement('div');
    list.className = 'player-picker-list';

    const finish = (value: number | null): void => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'player-choice';
      button.innerHTML = `<strong>${choice.label}</strong><span>${options.countLabel?.(choice) ?? `${choice.cardCount} 张牌`}</span>`;
      button.addEventListener('click', () => finish(choice.id));
      list.appendChild(button);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn player-picker-cancel';
    cancel.textContent = '取消出牌';
    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    panel.append(title, hint, list, cancel);
    dialog.appendChild(panel);
    root.appendChild(dialog);
    dialog.showModal();
    list.querySelector<HTMLButtonElement>('button')?.focus();
  });
}
