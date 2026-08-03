import { createGame, dispatch } from '../src/game';
import { NormalHeuristic } from '../src/game/ai/strategies';
import { Rng } from '../src/game/core/rng';
import { getDeck } from '../src/game/hearth/decks';
import type { HeroId } from '../src/game/heroes';

const HEROES: HeroId[] = ['cardMaster', 'thug', 'inspector'];
const gameArg = process.argv.find((arg) => arg.startsWith('--games='));
const playersArg = process.argv.find((arg) => arg.startsWith('--players='));
const deckArg = process.argv.find((arg) => arg.startsWith('--deck='));
const gameCount = Math.max(30, Number(gameArg?.split('=')[1] ?? 600) || 600);
const playerCount = Math.min(8, Math.max(2, Number(playersArg?.split('=')[1] ?? 3) || 3));
const deckId = deckArg?.split('=')[1] === 'burst' ? 'burst' : 'combo';
const maxSteps = 3_000;

interface MatchResult {
  completed: boolean;
  steps: number;
  turns: number;
  winner: number | null;
  heroIds: HeroId[];
  mercyEliminations: number;
  roulettes: number;
  rouletteTransfers: number;
}

function runMatch(seed: number, rouletteStacking: boolean): MatchResult {
  const deck = getDeck(deckId);
  const heroIds = Array.from(
    { length: playerCount },
    (_, seat) => HEROES[(seat + (seed - 1)) % HEROES.length]!
  );
  const state = createGame(playerCount, deck.cardIds, seed, {}, heroIds, { rouletteStacking });
  const gameRng = new Rng(seed);
  const ais = Array.from(
    { length: playerCount },
    (_, seat) => new NormalHeuristic(new Rng(seed * 97 + seat * 13 + 7))
  );
  let steps = 0;
  while (state.phase !== 'gameOver' && steps < maxSteps) {
    const player = state.turn;
    const action = ais[player]!.decide(state, player);
    if (!action) break;
    const result = dispatch(state, gameRng, action);
    if (!result.ok) break;
    steps++;
  }
  const gameOver = [...state.pendingEvents].reverse().find((event) => event.type === 'gameOver');
  return {
    completed: state.phase === 'gameOver',
    steps,
    turns: state.turnSerial,
    winner: gameOver?.type === 'gameOver' ? gameOver.winner : null,
    heroIds,
    mercyEliminations: state.players.filter((player) => !player.active).length,
    roulettes: state.log.filter((line) => line.includes('打出颜色轮盘')).length,
    rouletteTransfers: state.log.filter((line) => line.includes('通过加牌转移')).length,
  };
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * quantile))]!;
}

function summarize(matches: MatchResult[]) {
  const completed = matches.filter((match) => match.completed && match.winner !== null);
  const heroWins = Object.fromEntries(HEROES.map((hero) => [hero, 0])) as Record<HeroId, number>;
  const heroAppearances = Object.fromEntries(HEROES.map((hero) => [hero, 0])) as Record<
    HeroId,
    number
  >;
  const seatWins = Array.from({ length: playerCount }, () => 0);
  for (const match of completed) {
    const winner = match.winner!;
    for (const hero of match.heroIds) heroAppearances[hero]++;
    const winningHero = match.heroIds[winner];
    if (winningHero) heroWins[winningHero]++;
    seatWins[winner] = (seatWins[winner] ?? 0) + 1;
  }
  const average = (values: number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    games: matches.length,
    completionRate: completed.length / matches.length,
    averageSteps: average(completed.map((match) => match.steps)),
    p95Steps: percentile(
      completed.map((match) => match.steps),
      0.95
    ),
    averageTurns: average(completed.map((match) => match.turns)),
    averageMercyEliminations: average(completed.map((match) => match.mercyEliminations)),
    roulettesPerGame: average(completed.map((match) => match.roulettes)),
    transfersPerGame: average(completed.map((match) => match.rouletteTransfers)),
    heroWinRates: Object.fromEntries(
      HEROES.map((hero) => [hero, heroWins[hero] / Math.max(1, heroAppearances[hero])])
    ),
    seatWinRates: seatWins.map((wins) => wins / Math.max(1, completed.length)),
  };
}

const control: MatchResult[] = [];
const treatment: MatchResult[] = [];
for (let seed = 1; seed <= gameCount; seed++) {
  control.push(runMatch(seed, false));
  treatment.push(runMatch(seed, true));
}

console.log(
  JSON.stringify(
    {
      methodology: {
        pairedSeeds: gameCount,
        players: playerCount,
        ai: 'normal',
        deck: deckId,
        heroes: HEROES,
        maxSteps,
      },
      control: summarize(control),
      rouletteStacking: summarize(treatment),
    },
    null,
    2
  )
);
