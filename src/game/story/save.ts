/**
 * 存档系统（Phase 5）：localStorage 持久化。
 * 进度 = 已完成章节 id 列表 + 已解锁章节。
 * V2 联机阶段迁移到 VibeHub save 作用域（同接口，换实现）。
 */

const SAVE_KEY = 'unostore_save_v1';
const UPDATED_KEY = 'unostore_save_updated_at';

export interface SaveData {
  completedChapters: string[];
  unlockedChapters: string[];
  totalWins: number;
  totalLosses: number;
}

const EMPTY_SAVE: SaveData = {
  completedChapters: [],
  unlockedChapters: ['ch1'],
  totalWins: 0,
  totalLosses: 0,
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { ...EMPTY_SAVE };
    return sanitizeStoryProgress({
      ...EMPTY_SAVE,
      ...(JSON.parse(raw) as Partial<SaveData>),
    });
  } catch {
    return { ...EMPTY_SAVE };
  }
}

/** 修复旧版本“失败也解锁”的脏数据：下一章只能由前一章的完成记录推导。 */
export function sanitizeStoryProgress(data: SaveData): SaveData {
  const completed = new Set(data.completedChapters);
  const unlocked = ['ch1'];
  for (let chapter = 1; chapter < 4; chapter++) {
    const required = Array.from({ length: chapter }, (_, index) => `ch${index + 1}`);
    if (required.every((id) => completed.has(id))) unlocked.push(`ch${chapter + 1}`);
  }
  return { ...data, unlockedChapters: unlocked };
}

export function saveProgress(data: SaveData): void {
  try {
    const updatedAt = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    localStorage.setItem(UPDATED_KEY, String(updatedAt));
    void import('../../net/cloudSave')
      .then(({ mirrorStorySave }) => mirrorStorySave(data, updatedAt))
      .catch((error: unknown) => console.warn('VibeHub 剧情存档同步失败', error));
  } catch {
    console.warn('存档失败（localStorage 不可用）');
  }
}

/** 章节通关后更新存档 */
export function completeChapter(
  data: SaveData,
  chapterId: string,
  nextChapterId: string | null
): SaveData {
  const completed = data.completedChapters.includes(chapterId)
    ? data.completedChapters
    : [...data.completedChapters, chapterId];
  const unlocked = data.unlockedChapters.includes(chapterId)
    ? data.unlockedChapters
    : [...data.unlockedChapters, chapterId];
  const next =
    nextChapterId && !unlocked.includes(nextChapterId) ? [...unlocked, nextChapterId] : unlocked;
  return { ...data, completedChapters: completed, unlockedChapters: next };
}

export function recordResult(data: SaveData, won: boolean): SaveData {
  return won
    ? { ...data, totalWins: data.totalWins + 1 }
    : { ...data, totalLosses: data.totalLosses + 1 };
}

/** 一局剧情的唯一结算入口：失败只记败场，胜利才完成并解锁下一章。 */
export function recordStoryMatchResult(
  data: SaveData,
  won: boolean,
  chapterId: string | null,
  nextChapterId: string | null
): SaveData {
  const recorded = recordResult(data, won);
  return won && chapterId ? completeChapter(recorded, chapterId, nextChapterId) : recorded;
}

export function isChapterUnlocked(data: SaveData, chapterId: string): boolean {
  return data.unlockedChapters.includes(chapterId);
}

export function isChapterCompleted(data: SaveData, chapterId: string): boolean {
  return data.completedChapters.includes(chapterId);
}

export type { StorySession } from './session';
export { createStorySession, opponentDecide, playerWon, storyDispatch } from './session';
