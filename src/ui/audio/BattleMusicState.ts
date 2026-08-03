export type BattleMusicTier = 'calm' | 'tension' | 'climax';

export interface BattleMusicSignal {
  phase: string;
  players: Array<{
    active: boolean;
    unoCount: number;
    pendingDraw: number;
    unoAlert: boolean;
  }>;
}

export function battleMusicTier(signal: BattleMusicSignal): BattleMusicTier {
  if (signal.phase === 'gameOver') return 'calm';
  const active = signal.players.filter((player) => player.active);
  const minUno = Math.min(...active.map((player) => player.unoCount), Number.POSITIVE_INFINITY);
  const maxPenalty = Math.max(...active.map((player) => player.pendingDraw), 0);
  const eliminated = signal.players.length - active.length;
  if (
    (signal.players.length > 2 && active.length <= 2) ||
    minUno <= 1 ||
    maxPenalty >= 6 ||
    active.some((player) => player.unoAlert)
  ) {
    return 'climax';
  }
  if (minUno <= 3 || maxPenalty >= 2 || eliminated > 0) return 'tension';
  return 'calm';
}
