import {
  inspectCloudSaveConflicts,
  resolveCloudSaveConflict,
  type SaveConflict,
  type SaveConflictChoice,
} from '../../net/cloudSave';

/** 登录后只在双边内容不同时弹出；玩家可保留任一版本或无损合并。 */
export async function resolveCloudSaveConflicts(root: HTMLElement): Promise<number> {
  const conflicts = await inspectCloudSaveConflicts();
  for (const conflict of conflicts) await showConflict(root, conflict);
  return conflicts.length;
}

function showConflict(root: HTMLElement, conflict: SaveConflict): Promise<void> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'cloud-conflict-dialog';
    const titleId = `cloud-conflict-${conflict.kind}`;
    dialog.setAttribute('aria-labelledby', titleId);
    const title = document.createElement('h2');
    title.id = titleId;
    title.textContent = `${conflict.title}存在存档冲突`;
    const intro = document.createElement('p');
    intro.textContent = '本地与云端内容不同。请选择要保留的版本，也可以手动合并双方数据。';
    const comparison = document.createElement('div');
    comparison.className = 'cloud-conflict-comparison';
    comparison.append(
      versionCard('本地存档', conflict.localUpdatedAt, conflict, 'local'),
      versionCard('云端存档', conflict.cloudUpdatedAt, conflict, 'cloud')
    );
    const status = document.createElement('p');
    status.className = 'cloud-conflict-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const actions = document.createElement('div');
    actions.className = 'cloud-conflict-actions';
    const buttons: HTMLButtonElement[] = [];
    const choose = async (choice: SaveConflictChoice): Promise<void> => {
      for (const button of buttons) button.disabled = true;
      status.textContent = choice === 'merge' ? '正在合并并保存双方数据…' : '正在同步所选存档…';
      try {
        await resolveCloudSaveConflict(conflict, choice);
        dialog.close();
      } catch (error) {
        status.textContent = `同步失败：${error instanceof Error ? error.message : String(error)}`;
        status.classList.add('error');
        for (const button of buttons) button.disabled = false;
      }
    };
    for (const [label, choice] of [
      ['使用本地存档', 'local'],
      ['使用云端存档', 'cloud'],
      ['手动合并', 'merge'],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = choice === 'merge' ? 'btn btn-primary' : 'btn btn-secondary';
      button.textContent = label;
      button.addEventListener('click', () => void choose(choice));
      buttons.push(button);
      actions.append(button);
    }
    dialog.append(title, intro, comparison, status, actions);
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove();
        resolve();
      },
      { once: true }
    );
    root.append(dialog);
    dialog.showModal();
    buttons[0]?.focus();
  });
}

function versionCard(
  label: string,
  updatedAt: number,
  conflict: SaveConflict,
  side: 'local' | 'cloud'
): HTMLElement {
  const card = document.createElement('section');
  card.className = 'cloud-version-card';
  const newest =
    side === 'local'
      ? conflict.localUpdatedAt >= conflict.cloudUpdatedAt
      : conflict.cloudUpdatedAt >= conflict.localUpdatedAt;
  const heading = document.createElement('h3');
  heading.textContent = `${label}${newest ? ' · 较新' : ''}`;
  const time = document.createElement('time');
  time.dateTime = updatedAt ? new Date(updatedAt).toISOString() : '';
  time.textContent = updatedAt
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(
        updatedAt
      )
    : '没有修改时间记录';
  const summary = document.createElement('p');
  const data = side === 'local' ? conflict.localData : conflict.cloudData;
  summary.textContent =
    conflict.kind === 'story'
      ? `完成 ${(data as import('../../game/story/save').SaveData).completedChapters.length} 章 · 胜场 ${(data as import('../../game/story/save').SaveData).totalWins}`
      : `${(data as import('../../game/loadout').LoadoutProfile).decks.length} 套牌库`;
  card.append(heading, time, summary);
  return card;
}
