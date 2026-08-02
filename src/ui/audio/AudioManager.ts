/**
 * 音频管理：音乐（mmx 生成）+ 音效（CC0 素材）。
 * 所有音频资产为压缩格式（ogg/mp3），懒加载。
 */

import { assetUrl } from '../assets/url';

type VolumeChannel = 'music' | 'sfx' | 'voice';

const VOLUME_STORAGE_KEY = 'unostore_volumes';
const DEFAULT_VOLUMES: Record<VolumeChannel, number> = { music: 1, sfx: 1, voice: 1 };

class AudioManager {
  private musicEl: HTMLAudioElement | null = null;
  private sfxEls: Map<string, HTMLAudioElement> = new Map();
  private muted = false;
  /** 三路音量（BGM/音效/语音），独立调节并持久化 */
  private volumes: Record<VolumeChannel, number> = { ...DEFAULT_VOLUMES };
  /** 用户是否已交互（解锁自动播放） */
  private userActivated = false;
  private audioContext: AudioContext | null = null;

  constructor() {
    const saved = localStorage.getItem('unostore_muted');
    this.muted = saved === '1';
    try {
      const parsed = JSON.parse(localStorage.getItem(VOLUME_STORAGE_KEY) ?? '{}') as Partial<
        Record<VolumeChannel, number>
      >;
      for (const channel of Object.keys(DEFAULT_VOLUMES) as VolumeChannel[]) {
        const value = parsed[channel];
        if (typeof value === 'number' && Number.isFinite(value)) {
          this.volumes[channel] = Math.max(0, Math.min(1, value));
        }
      }
    } catch {
      /* 保持默认音量 */
    }
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

  /** 读取某通道音量（0–1） */
  getVolume(channel: VolumeChannel): number {
    return this.volumes[channel];
  }

  /** 设置某通道音量（0–1），即时生效并持久化 */
  setVolume(channel: VolumeChannel, value: number): void {
    this.volumes[channel] = Math.max(0, Math.min(1, value));
    localStorage.setItem(VOLUME_STORAGE_KEY, JSON.stringify(this.volumes));
    if (channel === 'music' && this.musicEl) this.musicEl.volume = this.musicVolume();
  }

  private musicVolume(): number {
    return 0.5 * this.volumes.music;
  }

  /** 播放背景音乐（切换时自动停止上一首） */
  playMusic(src: string): void {
    const resolvedSrc = assetUrl(src);
    if (this.musicEl?.src === resolvedSrc) return;
    this.musicEl?.pause();
    const audio = new Audio(resolvedSrc);
    audio.loop = true;
    audio.volume = this.musicVolume();
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

  /** 播放音效（缓存实例）；未交互前挂起。voice 路径（/voice/）走语音通道独立调节。 */
  playSfx(src: string, volume = 0.7): void {
    if (this.muted) return;
    if (!this.userActivated) return;
    const resolvedSrc = assetUrl(src);
    const channel = resolvedSrc.includes('/voice/') ? this.volumes.voice : this.volumes.sfx;
    let audio = this.sfxEls.get(resolvedSrc);
    if (!audio) {
      audio = new Audio(resolvedSrc);
      this.sfxEls.set(resolvedSrc, audio);
    }
    audio.volume = Math.max(0, Math.min(1, volume * channel));
    audio.currentTime = 0;
    void audio.play().catch(() => {
      /* 忽略播放失败 */
    });
  }

  /** 广播预设英雄台词；联机端消费同一事件，因此每个客户端都会听见。 */
  speak(text: string, pitch = 0.92, rate = 1): void {
    if (this.muted || !this.userActivated || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.pitch = pitch;
    utterance.rate = rate;
    utterance.volume = this.volumes.voice;
    window.speechSynthesis.speak(utterance);
  }

  /** 无需外部素材的短促游戏音效；用于逐牌表现并保证离线也有声音。 */
  playProceduralSfx(
    kind:
      | 'lightning'
      | 'fire'
      | 'frost'
      | 'arcane'
      | 'shadow'
      | 'nature'
      | 'shield'
      | 'time'
      | 'draw'
      | 'transform'
      | 'impact',
    volume = 0.45
  ): void {
    if (this.muted || !this.userActivated) return;
    const AudioContextCtor = window.AudioContext;
    this.audioContext ??= new AudioContextCtor();
    const context = this.audioContext;
    if (context.state === 'suspended') void context.resume();
    const now = context.currentTime;
    const master = context.createGain();
    master.gain.setValueAtTime(Math.max(0.01, volume), now);
    master.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    master.connect(context.destination);

    const tones: Record<typeof kind, [number, number, OscillatorType]> = {
      lightning: [1480, 92, 'sawtooth'],
      fire: [180, 52, 'sawtooth'],
      frost: [1320, 2140, 'sine'],
      arcane: [520, 1180, 'triangle'],
      shadow: [96, 48, 'sawtooth'],
      nature: [420, 690, 'sine'],
      shield: [720, 1220, 'sine'],
      time: [880, 220, 'triangle'],
      draw: [420, 820, 'triangle'],
      transform: [260, 1480, 'square'],
      impact: [120, 45, 'square'],
    };
    const [start, end, wave] = tones[kind];
    const oscillator = context.createOscillator();
    const toneGain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(start, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), now + 0.42);
    toneGain.gain.setValueAtTime(0.001, now);
    toneGain.gain.exponentialRampToValueAtTime(0.32, now + 0.018);
    toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.46);
    oscillator.connect(toneGain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + 0.48);

    if (kind === 'lightning' || kind === 'fire' || kind === 'impact') {
      const buffer = context.createBuffer(
        1,
        Math.floor(context.sampleRate * 0.36),
        context.sampleRate
      );
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
      const noise = context.createBufferSource();
      noise.buffer = buffer;
      const filter = context.createBiquadFilter();
      filter.type = kind === 'fire' ? 'lowpass' : 'highpass';
      filter.frequency.value = kind === 'fire' ? 900 : 1700;
      const noiseGain = context.createGain();
      noiseGain.gain.setValueAtTime(kind === 'lightning' ? 0.8 : 0.45, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
      noise.connect(filter).connect(noiseGain).connect(master);
      noise.start(now);
    }
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
