import '../hearth/cards'; // 副作用导入：注册炉石 effect（所有入口必须经过）

export {
  completeChapter,
  isChapterCompleted,
  isChapterUnlocked,
  loadSave,
  recordResult,
  recordStoryMatchResult,
  sanitizeStoryProgress,
  saveProgress,
} from './save';
export type { StorySession } from './session';
export {
  createStorySession,
  opponentDecide,
  playerPlayableIndices,
  playerWon,
  storyDispatch,
} from './session';
export type { StoryChapter, StoryCharacter, StoryEvent, StoryMatch } from './story';
export { STORY_CHAPTERS, STORY_CHARACTERS } from './story';
