import { EasyRandom, HardCombo, NormalHeuristic } from '../ai/strategies';
import type { AiStrategy } from '../ai/types';
import { createGame, dispatch } from '../core/reducer';
import { Rng } from '../core/rng';
import type { GameAction, GameState } from '../core/state';
import { getDeck } from '../hearth/decks';
import type { StoryMatch } from './story';

/**
 * 剧情对战会话：管理一局故事对局的完整生命周期。
 * - 玩家 = 座位 0，对手 = 座位 1
 * - 对手 AI 按难度选择（easy/normal/hard）
 * - Boss 规则注入 createGame
 * - 会话持有持久 Rng（每次行动洗牌必须用同一实例，保证确定性）
 */

export type StoryPhase = 'playing' | 'gameOver';

export interface StorySession {
  state: GameState;
  phase: StoryPhase;
  winner: number | null;
  /** 会话内持久随机源 */
  rng: Rng;
}

export function createStorySession(match: StoryMatch, seed = 42): StorySession {
  const bossRules = match.boss ? { 1: match.boss } : undefined;
  const state = createGame(2, getDeck('combo').cardIds, seed, bossRules);
  return { state, phase: 'playing', winner: null, rng: new Rng(seed) };
}

/** 对手 AI 决策（一步） */
export function opponentDecide(session: StorySession, match: StoryMatch): GameAction | null {
  const ai: AiStrategy =
    match.difficulty === 'easy'
      ? new EasyRandom(session.rng)
      : match.difficulty === 'normal'
        ? new NormalHeuristic(session.rng)
        : new HardCombo(session.rng);
  return ai.decide(session.state, 1);
}

/** 执行一步行动（玩家或对手），自动更新会话状态 */
export function storyDispatch(
  session: StorySession,
  action: GameAction
): { ok: boolean; error?: string } {
  const result = dispatch(session.state, session.rng, action);
  if (!result.ok) return { ok: false, error: result.error };
  if (session.state.phase === 'gameOver') {
    session.phase = 'gameOver';
    const ev = session.state.pendingEvents.find((e) => e.type === 'gameOver');
    session.winner = ev?.type === 'gameOver' ? ev.winner : null;
  }
  return { ok: true };
}

/** 玩家是否获胜 */
export function playerWon(session: StorySession): boolean {
  return session.winner === 0;
}

/** 玩家（座位 0）可打的手牌索引 */
export function playerPlayableIndices(session: StorySession): number[] {
  const hand = session.state.players[0]!.hand;
  return hand
    .map((_, i) => i)
    .filter((i) => {
      const card = hand[i]!;
      return (
        session.state.unoActionsLeft > 0 &&
        (card.color === null ||
          card.color === session.state.chosenColor ||
          card.value === session.state.topCard.value)
      );
    });
}
