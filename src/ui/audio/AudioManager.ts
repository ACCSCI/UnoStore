/**
 * 音频管理：音乐（mmx 生成）+ 音效（CC0 素材）。
 * 所有音频资产为压缩格式（ogg/mp3），懒加载。
 */

import { assetUrl } from '../assets/url';
import type { BattleMusicTier } from './BattleMusicState';

type VolumeChannel = 'music' | 'sfx' | 'voice';

const VOLUME_STORAGE_KEY = 'unostore_volumes';
const DEFAULT_VOLUMES: Record<VolumeChannel, number> = { music: 1, sfx: 1, voice: 1 };
const MUSIC_MIX_GAIN = 0.312;
const VOICE_MIX_GAIN = 1.12;
const MIN_SFX_PLAYBACK_RATE = 0.5;
const MAX_SFX_PLAYBACK_RATE = 2;
const BATTLE_TRACKS: Record<BattleMusicTier, string> = {
  calm: '/assets/audio/music/tavern_battle_calm.mp3',
  tension: '/assets/audio/music/tavern_battle_tension.mp3',
  climax: '/assets/audio/music/tavern_battle_climax.mp3',
};

export interface SpatialPosition {
  x: number;
  y: number;
  z: number;
}

export interface SpatialAudioHandle {
  stop: () => void;
  setPosition: (position: SpatialPosition) => void;
}

class AudioManager {
  private musicEl: HTMLAudioElement | null = null;
  private sfxEls: Map<string, HTMLAudioElement> = new Map();
  private muted = false;
  /** 三路音量（BGM/音效/语音），独立调节并持久化 */
  private volumes: Record<VolumeChannel, number> = { ...DEFAULT_VOLUMES };
  /** 用户是否已交互（解锁自动播放） */
  private userActivated = false;
  private audioContext: AudioContext | null = null;
  private readonly adaptiveMusic = new Map<BattleMusicTier, HTMLAudioElement>();
  private adaptiveTier: BattleMusicTier | null = null;
  private adaptiveRequestedTier: BattleMusicTier | null = null;
  private adaptiveFadeRaf = 0;
  private readonly spatialBuffers = new Map<string, Promise<AudioBuffer>>();
  private readonly tavernLoops: SpatialAudioHandle[] = [];
  private readonly tavernTimers = new Set<number>();
  private tavernRequested = false;
  private serverVoiceHandle: SpatialAudioHandle | null = null;
  private serverVoiceRequest = 0;
  private lastServerVoiceIndex = -1;
  private readonly opusWebmSupported =
    typeof Audio !== 'undefined' && new Audio().canPlayType('audio/webm; codecs="opus"') !== '';

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
      if (this.adaptiveRequestedTier) this.startBattleMusic(this.adaptiveRequestedTier);
      if (this.tavernRequested) void this.startTavernAmbience();
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
    if (channel === 'music') {
      for (const [tier, track] of this.adaptiveMusic) {
        track.volume = tier === this.adaptiveTier ? this.musicVolume() : 0;
      }
    }
  }

  private musicVolume(): number {
    return MUSIC_MIX_GAIN * this.volumes.music;
  }

  /** 播放背景音乐（切换时自动停止上一首） */
  playMusic(src: string): void {
    this.stopAdaptiveMusic();
    const resolvedSrc = this.resolveAudioAsset(src);
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
    this.stopAdaptiveMusic();
  }

  /** Start or transition the adaptive battle score with a phase-aligned crossfade. */
  startBattleMusic(tier: BattleMusicTier = 'calm'): void {
    this.adaptiveRequestedTier = tier;
    if (!this.userActivated) return;
    this.musicEl?.pause();
    this.musicEl = null;
    const target = this.ensureBattleTrack(tier);
    if (this.adaptiveTier === tier && !target.paused) return;
    const previousTier = this.adaptiveTier;
    const previous = previousTier ? this.adaptiveMusic.get(previousTier) : null;
    if (previous && Number.isFinite(target.duration) && target.duration > 0) {
      target.currentTime = previous.currentTime % target.duration;
    }
    target.muted = this.muted;
    target.volume = previous ? 0 : this.musicVolume();
    void target.play().catch(() => {});
    this.adaptiveTier = tier;
    cancelAnimationFrame(this.adaptiveFadeRaf);
    if (!previous || previous === target) return;
    const startedAt = performance.now();
    const duration = 1800;
    const fade = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = progress * progress * (3 - 2 * progress);
      target.volume = this.musicVolume() * eased;
      previous.volume = this.musicVolume() * (1 - eased);
      if (progress < 1) this.adaptiveFadeRaf = requestAnimationFrame(fade);
      else {
        previous.pause();
        previous.volume = 0;
      }
    };
    this.adaptiveFadeRaf = requestAnimationFrame(fade);
  }

  setBattleMusicTier(tier: BattleMusicTier): void {
    this.startBattleMusic(tier);
  }

  /** 播放音效（缓存实例）；playbackRate 每次重置，并保持原音高。 */
  playSfx(src: string, volume = 0.7, playbackRate = 1): void {
    if (this.muted) return;
    if (!this.userActivated) return;
    const resolvedSrc = this.resolveAudioAsset(src);
    const isVoice = resolvedSrc.includes('/voice/');
    const channel = isVoice ? this.volumes.voice * VOICE_MIX_GAIN : this.volumes.sfx;
    let audio = this.sfxEls.get(resolvedSrc);
    if (!audio) {
      audio = new Audio(resolvedSrc);
      this.sfxEls.set(resolvedSrc, audio);
    }
    audio.volume = Math.max(0, Math.min(1, volume * channel));
    audio.playbackRate = Number.isFinite(playbackRate)
      ? Math.max(MIN_SFX_PLAYBACK_RATE, Math.min(MAX_SFX_PLAYBACK_RATE, playbackRate))
      : 1;
    audio.preservesPitch = true;
    audio.currentTime = 0;
    void audio.play().catch(() => {
      /* 忽略播放失败 */
    });
  }

  /** Decode once and spatialize at runtime with HRTF distance cues. */
  async playSpatialSfx(
    src: string,
    position: SpatialPosition,
    volume = 0.6,
    options: { loop?: boolean; refDistance?: number; maxDistance?: number } = {}
  ): Promise<SpatialAudioHandle | null> {
    if (this.muted || !this.userActivated) return null;
    const context = this.ensureAudioContext();
    if (context.state === 'suspended') await context.resume().catch(() => {});
    const resolvedSrc = this.resolveAudioAsset(src);
    const buffer = await this.loadSpatialBuffer(resolvedSrc).catch(() => null);
    if (!buffer) return null;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const panner = context.createPanner();
    const isVoice = resolvedSrc.includes('/voice/');
    const channel = isVoice ? this.volumes.voice * VOICE_MIX_GAIN : this.volumes.sfx;
    source.buffer = buffer;
    source.loop = options.loop ?? false;
    gain.gain.value = Math.max(0, Math.min(1.15, volume * channel));
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = options.refDistance ?? (isVoice ? 7 : 2.8);
    panner.maxDistance = options.maxDistance ?? 28;
    panner.rolloffFactor = isVoice ? 0.55 : 1.15;
    setPannerPosition(panner, position);
    source.connect(gain).connect(panner).connect(context.destination);
    source.start();
    let disconnected = false;
    const disconnect = (): void => {
      if (disconnected) return;
      disconnected = true;
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
    const stop = (): void => {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      disconnect();
    };
    source.onended = disconnect;
    return { stop, setPosition: (next) => setPannerPosition(panner, next) };
  }

  async startTavernAmbience(): Promise<void> {
    this.tavernRequested = true;
    if (!this.userActivated || this.tavernLoops.length > 0) return;
    const loopSpecs: Array<[string, SpatialPosition, number]> = [
      ['/assets/audio/ambience/tavern_room.mp3', { x: 0, y: 1, z: -9 }, 0.24],
      ['/assets/audio/ambience/fireplace.mp3', { x: -8, y: 1, z: -7 }, 0.34],
      ['/assets/audio/ambience/fabric_rustle.mp3', { x: 4, y: 5, z: -6 }, 0.16],
    ];
    const handles = await Promise.all(
      loopSpecs.map(([src, position, volume]) =>
        this.playSpatialSfx(src, position, volume, { loop: true, refDistance: 3.5 })
      )
    );
    if (!this.tavernRequested) {
      for (const handle of handles) handle?.stop();
      return;
    }
    for (const handle of handles) if (handle) this.tavernLoops.push(handle);
    this.scheduleTavernOneShot(
      '/assets/audio/ambience/mug_clink.mp3',
      [
        { x: -5, y: 1, z: -4 },
        { x: 6, y: 1, z: -4 },
      ],
      0.4,
      4500,
      9000
    );
    this.scheduleTavernOneShot(
      '/assets/audio/ambience/distant_cards.mp3',
      [
        { x: -5, y: 1, z: -5 },
        { x: 6, y: 1, z: -4 },
      ],
      0.25,
      7000,
      13000
    );
    this.scheduleTavernOneShot(
      '/assets/audio/ambience/server_steps.mp3',
      [
        { x: -4, y: 0, z: -3 },
        { x: 4, y: 0, z: -3 },
      ],
      0.34,
      8500,
      15000
    );
    this.scheduleTavernOneShot(
      '/assets/audio/ambience/water_pour.mp3',
      [
        { x: -2, y: 1, z: -1 },
        { x: 3, y: 1, z: -2 },
      ],
      0.38,
      12000,
      21000
    );
    this.scheduleTavernOneShot(
      '/assets/audio/ambience/chair_creak.mp3',
      [
        { x: -4, y: 0, z: -5 },
        { x: 5, y: 0, z: -5 },
      ],
      0.24,
      8000,
      16000
    );
  }

  stopTavernAmbience(): void {
    this.tavernRequested = false;
    for (const timer of this.tavernTimers) window.clearTimeout(timer);
    this.tavernTimers.clear();
    for (const handle of this.tavernLoops) handle.stop();
    this.tavernLoops.length = 0;
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

  /** 点击巡桌服务员时，随机播放一条已归一化的专属录音。 */
  speakRandomServerLine(position?: SpatialPosition): void {
    const lines = [
      '/assets/audio/voice/server/server_water.mp3',
      '/assets/audio/voice/server/server_evening.mp3',
      '/assets/audio/voice/server/server_refill.mp3',
      '/assets/audio/voice/server/server_luck.mp3',
    ];
    const candidateCount = this.lastServerVoiceIndex >= 0 ? lines.length - 1 : lines.length;
    let nextIndex = Math.floor(Math.random() * candidateCount);
    if (this.lastServerVoiceIndex >= 0 && nextIndex >= this.lastServerVoiceIndex) nextIndex += 1;
    this.lastServerVoiceIndex = nextIndex;
    const line = lines[nextIndex];
    if (!line) return;
    const request = ++this.serverVoiceRequest;
    this.serverVoiceHandle?.stop();
    this.serverVoiceHandle = null;
    const sourcePosition = position ?? { x: 0, y: 1, z: 0 };
    void this.playSpatialSfx(line, sourcePosition, 0.92, {
      refDistance: 6.5,
      maxDistance: 24,
    }).then((handle) => {
      // A later click wins even if both requests were waiting for the same
      // decode: stop the stale source immediately and keep only the newest.
      if (request !== this.serverVoiceRequest) {
        handle?.stop();
        return;
      }
      this.serverVoiceHandle = handle;
    });
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
    const context = this.ensureAudioContext();
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
    for (const track of this.adaptiveMusic.values()) track.muted = this.muted;
    return this.muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  private ensureBattleTrack(tier: BattleMusicTier): HTMLAudioElement {
    const cached = this.adaptiveMusic.get(tier);
    if (cached) return cached;
    const track = new Audio(this.resolveAudioAsset(BATTLE_TRACKS[tier]));
    track.loop = true;
    track.preload = 'auto';
    track.volume = 0;
    track.muted = this.muted;
    this.adaptiveMusic.set(tier, track);
    return track;
  }

  private stopAdaptiveMusic(): void {
    cancelAnimationFrame(this.adaptiveFadeRaf);
    this.adaptiveFadeRaf = 0;
    for (const track of this.adaptiveMusic.values()) {
      track.pause();
      track.currentTime = 0;
      track.volume = 0;
    }
    this.adaptiveTier = null;
    this.adaptiveRequestedTier = null;
  }

  private ensureAudioContext(): AudioContext {
    this.audioContext ??= new AudioContext();
    return this.audioContext;
  }

  /** Prefer Opus/WebM for generated battle media, keep MP3 as broad fallback. */
  private resolveAudioAsset(src: string): string {
    const hasOpusVariant =
      src.includes('/audio/music/tavern_battle_') ||
      src.includes('/audio/ambience/') ||
      src.includes('/audio/sfx/generated/hand_') ||
      src.includes('/audio/voice/heroes/emotes/') ||
      src.includes('/audio/voice/server/');
    const selected =
      this.opusWebmSupported && hasOpusVariant ? src.replace(/\.mp3$/i, '.webm') : src;
    return assetUrl(selected);
  }

  private loadSpatialBuffer(src: string): Promise<AudioBuffer> {
    const cached = this.spatialBuffers.get(src);
    if (cached) return cached;
    const pending = fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error(`音频加载失败：${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => this.ensureAudioContext().decodeAudioData(data));
    this.spatialBuffers.set(src, pending);
    return pending;
  }

  private scheduleTavernOneShot(
    src: string,
    positions: SpatialPosition[],
    volume: number,
    minDelay: number,
    maxDelay: number
  ): void {
    const schedule = (): void => {
      if (!this.tavernRequested) return;
      const delay = minDelay + Math.random() * (maxDelay - minDelay);
      const timer = window.setTimeout(() => {
        this.tavernTimers.delete(timer);
        if (!this.tavernRequested) return;
        const position = positions[Math.floor(Math.random() * positions.length)] ?? positions[0];
        if (position) void this.playSpatialSfx(src, position, volume);
        schedule();
      }, delay);
      this.tavernTimers.add(timer);
    };
    schedule();
  }
}

function setPannerPosition(panner: PannerNode, position: SpatialPosition): void {
  const now = panner.context.currentTime;
  panner.positionX.setValueAtTime(position.x, now);
  panner.positionY.setValueAtTime(position.y, now);
  panner.positionZ.setValueAtTime(position.z, now);
}

export const audio = new AudioManager();
