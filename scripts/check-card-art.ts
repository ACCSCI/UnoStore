import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/game/hearth/cards';
import { allEffects } from '../src/game/hearth/effects/registry';
import { HERO_EMOTES, HEROES } from '../src/game/heroes';
import { STORY_CHAPTERS, STORY_CHARACTERS } from '../src/game/story';
import { CARD_PRESENTATION, soundAsset } from '../src/ui/effects/CardEffects';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(projectRoot, 'public');
const effects = allEffects();

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function publicPath(url: string): string {
  return resolve(publicRoot, url.replace(/^\//, ''));
}

function validMedia(path: string): boolean {
  try {
    if (statSync(path).size < 128) return false;
    const bytes = readFileSync(path).subarray(0, 16);
    const ascii = bytes.toString('ascii');
    switch (extname(path).toLowerCase()) {
      case '.webp':
        return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
      case '.ogg':
        return ascii.startsWith('OggS');
      case '.mp3':
        return ascii.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
      default:
        return true;
    }
  } catch {
    return false;
  }
}

const expected = new Map<string, string>();
const register = (category: string, url: string): void => {
  expected.set(url, category);
};

for (const effect of effects) {
  register('炉石卡牌立绘', `/assets/images/hearth/${effect.id}.webp`);
  if (effect.kind === 'minion') {
    for (const cue of ['summon', 'select', 'attack']) {
      register('随从语音', `/assets/audio/voice/minions/${effect.id}_${cue}.mp3`);
    }
  }
}
for (const hero of HEROES) {
  register('英雄立绘', hero.portrait);
  register('英雄技能语音', `/assets/audio/voice/heroes/${hero.id}_power.mp3`);
  for (const emote of HERO_EMOTES) {
    register('英雄表情语音', `/assets/audio/voice/heroes/emotes/${hero.id}_${emote.id}.mp3`);
  }
}
for (const character of STORY_CHARACTERS) register('剧情角色立绘', character.portrait);
for (const chapter of STORY_CHAPTERS) {
  if (chapter.image) register('章节立绘', chapter.image);
  for (const match of chapter.matches) {
    for (const event of [...match.intro, ...match.outro]) {
      if (event.voice) register('剧情语音', event.voice);
    }
  }
}
for (const presentation of Object.values(CARD_PRESENTATION)) {
  register('卡牌音效', soundAsset(presentation.sound));
}
for (const url of [
  '/assets/images/dual-deck-card-back.webp',
  '/assets/audio/music/menu_theme.mp3',
  '/assets/audio/music/battle_theme.mp3',
  '/assets/audio/music/victory.mp3',
  '/assets/audio/music/defeat.mp3',
  '/assets/audio/sfx/card_flip.mp3',
  '/assets/audio/sfx/uno_cheer.mp3',
  '/assets/audio/sfx/generated/minion_summon.mp3',
  '/assets/audio/sfx/generated/minion_attack_swing.mp3',
  '/assets/audio/sfx/generated/minion_hit.mp3',
  '/assets/audio/sfx/generated/hero_cardmaster.mp3',
  '/assets/audio/sfx/generated/hero_thug.mp3',
  '/assets/audio/sfx/generated/hero_inspector_shuffle.mp3',
  '/assets/audio/voice/work_done.mp3',
]) {
  register(url.includes('/images/') ? '公共牌背' : '对战音频', url);
}

const invalid = [...expected].filter(([url]) => !validMedia(publicPath(url)));
if (invalid.length > 0) {
  console.error('以下必需媒体缺失、为空或文件格式损坏：');
  for (const [url, category] of invalid) console.error(`- [${category}] ${url}`);
  process.exit(1);
}

const imageRoot = resolve(publicRoot, 'assets/images');
const audioRoot = resolve(publicRoot, 'assets/audio');
const unoptimizedImages = filesUnder(imageRoot).filter(
  (path) => !['.webp', '.svg'].includes(extname(path).toLowerCase())
);
const oversizedImages = filesUnder(imageRoot).filter((path) => statSync(path).size > 512 * 1024);
const invalidAudio = filesUnder(audioRoot).filter(
  (path) => ['.mp3', '.ogg'].includes(extname(path).toLowerCase()) && !validMedia(path)
);
if (unoptimizedImages.length || oversizedImages.length || invalidAudio.length) {
  console.error('媒体优化审计失败：');
  for (const path of unoptimizedImages) console.error(`- 未转换为 WebP/SVG：${path}`);
  for (const path of oversizedImages) console.error(`- 图片超过 512 KiB：${path}`);
  for (const path of invalidAudio) console.error(`- 音频文件损坏：${path}`);
  process.exit(1);
}

const minionCount = effects.filter((effect) => effect.kind === 'minion').length;
console.log(
  `媒体检查通过：${effects.length} 张炉石立绘、${minionCount * 3} 条随从语音、${HEROES.length} 名英雄立绘、${HEROES.length * HERO_EMOTES.length} 条英雄表情语音；共校验 ${expected.size} 个必需文件，并确认全部游戏图片已使用 WebP/SVG。`
);
