/**
 * 音频管理：音乐（mmx 生成）+ 音效（CC0 素材）。
 * 所有音频资产为压缩格式（ogg/mp3），懒加载。
 */

class AudioManager {
  private musicEl: HTMLAudioElement | null = null;
  private sfxEls: Map<string, HTMLAudioElement> = new Map();
  private muted = false;
  /** 用户是否已交互（解锁自动播放） */
  private userActivated = false;

  constructor() {
    const saved = localStorage.getItem('unostore_muted');
    this.muted = saved === '1';
    // 首次用户交互 → 解锁音频（浏览器自动播放策略）
    const unlock = (): void => {
      this.userActivated = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      // 尝试恢复挂起的音乐
      if (this.musicEl?.paused) void this.musicEl.play().catch(() => {});
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  /** 播放背景音乐（切换时自动停止上一首） */
  playMusic(src: string): void {
    if (this.musicEl?.src.endsWith(src)) return;
    this.musicEl?.pause();
    const audio = new Audio(src);
    audio.loop = true;
    audio.volume = 0.5;
    audio.muted = this.muted;
    // 未交互前挂起播放，等首次点击解锁
    if (this.userActivated) {
      void audio.play().catch(() => {});
    }
    this.musicEl = audio;
  }

  /** 停止背景音乐 */
  stopMusic(): void {
    this.musicEl?.pause();
    this.musicEl = null;
  }

  /** 播放音效（缓存实例）；未交互前挂起 */
  playSfx(src: string): void {
    if (this.muted) return;
    if (!this.userActivated) return;
    let audio = this.sfxEls.get(src);
    if (!audio) {
      audio = new Audio(src);
      audio.volume = 0.7;
      this.sfxEls.set(src, audio);
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {
      /* 忽略播放失败 */
    });
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem('unostore_muted', this.muted ? '1' : '0');
    if (this.musicEl) this.musicEl.muted = this.muted;
    return this.muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }
}

export const audio = new AudioManager();
