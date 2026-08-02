import { audio } from '../audio/AudioManager';

type VolumeChannel = 'music' | 'sfx' | 'voice';

const VOLUME_CHANNELS: Array<{ channel: VolumeChannel; label: string; hint: string }> = [
  { channel: 'music', label: '背景音乐', hint: 'BGM' },
  { channel: 'sfx', label: '音效', hint: '出牌/随从/战斗' },
  { channel: 'voice', label: '语音', hint: '英雄台词/剧情' },
];

/** 设置浮层：三路音量（BGM/音效/语音）独立调节，修改即时生效并持久化。 */
export class SettingsPanel {
  private overlay: HTMLDivElement | null = null;

  constructor(
    private host: HTMLElement,
    private onClose?: () => void
  ) {}

  show(): void {
    if (this.overlay) return;
    this.overlay = document.createElement('div');
    this.overlay.className = 'pause-overlay settings-overlay';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-labelledby', 'settings-title');
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
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn pause-btn';
    close.textContent = '关闭';
    close.addEventListener('click', () => this.hide());
    card.append(close);
    this.overlay.append(card);
    this.host.append(this.overlay);
    close.focus();
  }

  hide(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.onClose?.();
  }
}
