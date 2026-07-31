/**
 * 存档系统（Phase 5）：localStorage 持久化。
 * 进度 = 已完成章节 id 列表 + 已解锁章节。
 * V2 联机阶段迁移到 VibeHub save 作用域（同接口，换实现）。
 */

const SAVE_KEY = 'unostore_save_v1';

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
    return { ...EMPTY_SAVE, ...(JSON.parse(raw) as Partial<SaveData>) };
  } catch {
    return { ...EMPTY_SAVE };
  }
}

export function saveProgress(data: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
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

export function isChapterUnlocked(data: SaveData, chapterId: string): boolean {
  return data.unlockedChapters.includes(chapterId);
}

export function isChapterCompleted(data: SaveData, chapterId: string): boolean {
  return data.completedChapters.includes(chapterId);
}

export type { StorySession } from './session';
export { createStorySession, opponentDecide, playerWon, storyDispatch } from './session';
