import { expect, test } from 'bun:test';
import {
  completeChapter,
  createStorySession,
  loadSave,
  opponentDecide,
  playerPlayableIndices,
  recordResult,
  recordStoryMatchResult,
  sanitizeStoryProgress,
  saveProgress,
  storyDispatch,
} from '../../src/game/story';
import { isChapterCompleted, isChapterUnlocked } from '../../src/game/story/save';
import { STORY_CHAPTERS, STORY_CHARACTERS } from '../../src/game/story/story';

/**
 * Phase 5 剧情验收：章节结构完整、会话可玩、存档正确、Boss 规则生效。
 */

test('剧情：4 章节结构完整', () => {
  expect(STORY_CHAPTERS).toHaveLength(4);
  for (const ch of STORY_CHAPTERS) {
    expect(ch.matches.length).toBeGreaterThan(0);
    for (const m of ch.matches) {
      expect(m.opponent).toBeTruthy();
      expect(['easy', 'normal', 'hard']).toContain(m.difficulty);
      expect(m.intro.length).toBeGreaterThan(0);
    }
  }
});

test('剧情：角色立绘/语音资产路径存在', () => {
  expect(STORY_CHARACTERS.length).toBeGreaterThanOrEqual(4);
  for (const c of STORY_CHARACTERS) {
    expect(c.portrait).toMatch(/\.webp$/);
    expect(c.name).toBeTruthy();
  }
});

test('剧情：会话创建 + 对手 AI 决策', () => {
  const match = STORY_CHAPTERS[0]!.matches[0]!;
  const session = createStorySession(match, 7);
  expect(session.state.players).toHaveLength(2);
  expect(session.phase).toBe('playing');
  const action = opponentDecide(session, match);
  expect(action).not.toBeNull();
});

test('剧情：Boss 规则注入（女王每回合 +2 水晶）', () => {
  const ch4 = STORY_CHAPTERS[3]!;
  const match = ch4.matches[0]!;
  expect(match.boss).toBeDefined();
  const session = createStorySession(match, 7);
  // 玩家 0 结束回合 → 对手（Boss）开始
  storyDispatch(session, { type: 'endTurn', player: 0 });
  expect(session.state.players[1]!.free).toBeGreaterThanOrEqual(2);
});

test('剧情：玩家可打索引正确', () => {
  const match = STORY_CHAPTERS[0]!.matches[0]!;
  const session = createStorySession(match, 7);
  const idx = playerPlayableIndices(session);
  expect(Array.isArray(idx)).toBe(true);
});

test('剧情：完整对局能打到游戏结束', () => {
  const match = STORY_CHAPTERS[0]!.matches[0]!;
  const session = createStorySession(match, 1);
  let steps = 0;
  // 玩家和对手轮流行动（用 AI 策略驱动玩家侧）
  while (session.phase !== 'gameOver' && steps < 2000) {
    steps++;
    if (session.state.turn === 0) {
      // 玩家：简单 AI 决策（玩家侧由 UI 操作，测试用 EasyRandom 代替）
      const playable = playerPlayableIndices(session);
      if (playable.length > 0) {
        const card = session.state.players[0]!.hand[playable[0]!]!;
        storyDispatch(session, {
          type: 'playUno',
          player: 0,
          cardIdx: playable[0]!,
          ...(card.value === '7' ? { targetPlayer: 1 } : {}),
          ...(card.color === null && card.value !== 'wildColorRoulette'
            ? { color: 'red' as const }
            : {}),
        });
      } else if (session.state.players[0]!.roulettePending) {
        storyDispatch(session, { type: 'resolveRoulette', player: 0, color: 'red' });
      } else if (
        session.state.unoActionsLeft > 0 &&
        session.state.players[0]!.pendingDrawMin === 0
      ) {
        storyDispatch(session, { type: 'drawUno', player: 0 });
      } else {
        storyDispatch(session, { type: 'endTurn', player: 0 });
      }
    } else {
      const action = opponentDecide(session, match);
      if (action) storyDispatch(session, action);
    }
  }
  expect(session.phase).toBe('gameOver');
  expect(session.winner).not.toBeNull();
});

test('存档：通关解锁下一章', () => {
  const data = loadSave();
  expect(isChapterUnlocked(data, 'ch1')).toBe(true);
  expect(isChapterCompleted(data, 'ch1')).toBe(false);
  const next = completeChapter(data, 'ch1', 'ch2');
  expect(isChapterCompleted(next, 'ch1')).toBe(true);
  expect(isChapterUnlocked(next, 'ch2')).toBe(true);
});

test('存档：失败只记录败场，不完成章节或解锁下一章', () => {
  const initial = loadSave();
  const failed = recordStoryMatchResult(initial, false, 'ch1', 'ch2');
  expect(failed.completedChapters).not.toContain('ch1');
  expect(failed.unlockedChapters).not.toContain('ch2');
  expect(failed.totalLosses).toBe(initial.totalLosses + 1);
});

test('存档：旧版本错误解锁但没有通关记录时会自动重新锁定', () => {
  const repaired = sanitizeStoryProgress({
    completedChapters: [],
    unlockedChapters: ['ch1', 'ch2', 'ch3', 'ch4'],
    totalWins: 0,
    totalLosses: 2,
  });
  expect(repaired.unlockedChapters).toEqual(['ch1']);
});

test('存档：胜负记录', () => {
  const data = loadSave();
  const won = recordResult(data, true);
  expect(won.totalWins).toBe(data.totalWins + 1);
  const lost = recordResult(won, false);
  expect(lost.totalLosses).toBe(won.totalLosses + 1);
});

test('存档：localStorage 往返', () => {
  // bun 测试环境没有 localStorage，模拟
  const store: Record<string, string> = {};
  const orig = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  } as unknown as Storage;
  const data = completeChapter(loadSave(), 'ch1', 'ch2');
  saveProgress(data);
  const loaded = loadSave();
  expect(loaded.completedChapters).toContain('ch1');
  expect(loaded.unlockedChapters).toContain('ch2');
  globalThis.localStorage = orig;
});
