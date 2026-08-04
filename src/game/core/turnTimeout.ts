export const TURN_TIMEOUT_MS = 120_000;

export function remainingTurnSeconds(deadline: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function formatTurnClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

interface TurnIdentity {
  turn: number;
  turnSerial: number;
  phase: string;
}

/** Mandatory timeout resolution can advance the state by itself; never end the following turn. */
export function isSameActiveTurn(state: TurnIdentity, player: number, turnSerial: number): boolean {
  return state.phase !== 'gameOver' && state.turn === player && state.turnSerial === turnSerial;
}
