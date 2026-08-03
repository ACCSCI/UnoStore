import { audio } from '../audio/AudioManager';

type VolumeChannel = 'music' | 'sfx' | 'voice';

const VOLUME_CHANNELS: Array<{ channel: VolumeChannel; label: string; hint: string }> = [
  { channel: 'music', label: '背景音乐', hint: 'BGM' },
  { channel: 'sfx', label: '音效', hint: '出牌/随从/战斗' },
  { channel: 'voice', label: '语音', hint: '英雄台词/剧情' },
];

/** 设置对话框：三路音量独立调节，并保留一键静音。 */
export class SettingsPanel {
  private dialog: HTMLDialogElement | null = null;
  private returnFocusTo: HTMLElement | null = null;

  constructor(
    private host: HTMLElement,
    private onClose?: () => void
  ) {}

  show(): void {
    if (this.dialog) return;
    this.returnFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialog = document.createElement('dialog');
    this.dialog = dialog;
    dialog.className = 'settings-dialog';
    dialog.setAttribute('aria-labelledby', 'settings-title');
    // Chromium 支持原生轻触遮罩关闭；下面的 click 监听兼容尚未实现 closedby 的浏览器。
    dialog.setAttribute('closedby', 'any');

    const card = document.createElement('div');
    card.className = 'pause-card settings-card';
    const title = document.createElement('div');
    title.className = 'pause-title';
    title.id = 'settings-title';
    title.textContent = '⚙ 设置';
    card.append(title);

    for (const { channel, label, hint } of VOLUME_CHANNELS) {
      const row = document.createElement('label');
      row.className = 'settings-row';
      const copy = document.createElement('span');
      copy.className = 'settings-row-copy';
      const strong = document.createElement('strong');
      strong.textContent = label;
      const small = document.createElement('small');
      small.textContent = hint;
      copy.append(strong, small);
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = String(Math.round(audio.getVolume(channel) * 100));
      const value = document.createElement('b');
      value.textContent = `${slider.value}%`;
      const apply = (): void => {
        audio.setVolume(channel, Number(slider.value) / 100);
        value.textContent = `${slider.value}%`;
      };
      slider.addEventListener('input', apply);
      slider.addEventListener('change', apply);
      slider.setAttribute('aria-label', `${label}音量`);
      row.append(copy, slider, value);
      card.append(row);
    }

    const actions = document.createElement('div');
    actions.className = 'settings-actions';
    const mute = document.createElement('button');
    mute.type = 'button';
    mute.className = 'btn btn-quiet pause-btn';
    const updateMute = (): void => {
      mute.textContent = audio.isMuted ? '🔇 取消静音' : '🔊 全部静音';
      mute.setAttribute('aria-pressed', String(audio.isMuted));
    };
    updateMute();
    mute.addEventListener('click', () => {
      audio.toggleMute();
      updateMute();
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn pause-btn';
    close.textContent = '关闭';
    close.addEventListener('click', () => dialog.close());
    actions.append(mute, close);
    card.append(actions);
    dialog.append(card);

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => this.cleanup(), { once: true });
    this.host.append(dialog);
    dialog.showModal();
    close.focus();
  }

  hide(): void {
    if (this.dialog?.open) this.dialog.close();
    else this.cleanup();
  }

  private cleanup(): void {
    this.dialog?.remove();
    this.dialog = null;
    const target = this.returnFocusTo;
    this.returnFocusTo = null;
    if (target?.isConnected) target.focus();
    this.onClose?.();
  }
}
