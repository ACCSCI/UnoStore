import { createGame, dispatch, playableUnoIndices } from '../src/game';
import { Rng } from '../src/game/core/rng';
import type { GameState } from '../src/game/core/state';
import { getDeck } from '../src/game/hearth/decks';
import { getEffect } from '../src/game/hearth/effects/registry';
import type { UnoCard, UnoColor } from '../src/game/uno/types';

/**
 * 文字化对战（Phase 1.5 验收工具）：
 *   bun run replay            → 2 人快速对战（自动 AI 随机出牌）
 *   bun run replay --seed N   → 指定随机种子
 *   bun run replay --hands    → 显示双方完整手牌（调试用）
 *   bun run replay --slow     → 每步暂停等待回车
 * 命令行输入（--hands 模式）：
 *   p <n>         打手牌第 n 张
 *   h <n> [target] 打炉石牌第 n 张（可选目标玩家）
 *   d             抽牌（打不出时）
 *   e             结束回合
 *   q             退出
 */

const args = process.argv.slice(2);
const seedIdx = args.indexOf('--seed');
const seed = seedIdx >= 0 ? Number(args[seedIdx + 1]) || 42 : 42;
const showHands = args.includes('--hands');
const slow = args.includes('--slow');

const rng = new Rng(seed);
const deck = getDeck('combo');
const state: GameState = createGame(2, deck.cardIds, seed);

const COLOR_CHARS: Record<string, string> = {
  red: 'R',
  yellow: 'Y',
  green: 'G',
  blue: 'B',
};

function cardStr(c: UnoCard): string {
  if (c.color === null) return `*${c.value}`;
  return `${COLOR_CHARS[c.color] ?? '?'}${c.value}`;
}

function cardList(cards: UnoCard[], markPlayable: boolean): string {
  return cards
    .map((c, i) => {
      const playable = markPlayable && c !== null ? playableUnoIndices(state).includes(i) : false;
      return `${i}:${cardStr(c)}${playable ? '*' : ''}`;
    })
    .join(' ');
}

function render(): void {
  console.log('─'.repeat(60));
  const p = state.players[state.turn]!;
  const top = state.topCard ? cardStr(state.topCard) : '-';
  console.log(
    `回合: ${state.turn}号玩家${state.turn === 0 ? ' (你)' : ''}  顶牌: ${top}  方向: ${state.direction === 1 ? '→' : '←'}`
  );
  console.log(
    `Uno行动余量: ${state.unoActionsLeft}  水晶(可用/冻结): ${p.free}/${p.frozen}  罚抽待处理: ${p.pendingDraw}`
  );
  console.log(
    `你(0号) 手牌[${state.players[0]!.hand.length}]: ${cardList(state.players[0]!.hand, state.turn === 0)}`
  );
  if (showHands) {
    console.log(`对手手牌: ${cardList(state.players[1]!.hand, false)}`);
    const hh = state.players[0]!.hearthHand;
    console.log(
      `炉石手牌: ${hh.map((c, i) => `${i}:${getEffect(c.effectId)?.name ?? '?'}(${getEffect(c.effectId)?.cost ?? '?'}费)`).join(' ')}`
    );
  } else {
    console.log(
      `炉石手牌: ${state.players[0]!.hearthHand.map((c) => getEffect(c.effectId)?.name ?? '?').join(' / ')}`
    );
  }
  console.log(
    `弃牌堆: ${state.unoDiscard.slice(-5).map(cardStr).join(' ')}  [共${state.unoDiscard.length}张]`
  );
  console.log(`牌堆剩余: ${state.unoDraw.length}`);
  if (state.phase === 'gameOver') {
    const events = state.pendingEvents.filter((e) => e.type === 'gameOver');
    if (events.length > 0)
      console.log(`🏆 获胜者: ${(events[0] as { winner: number }).winner}号玩家！`);
  }
}

function printEvents(events: { type: string; player?: number }[]): void {
  for (const e of events) {
    switch (e.type) {
      case 'turnStart':
        console.log(`  ▶ 玩家 ${e.player} 回合开始（抽 1 Uno + 1 炉石）`);
        break;
      case 'unoPlayed':
        console.log(
          `  ⛅ 玩家 ${e.player} 打出 Uno 牌${(e as unknown as { crystalFrozen: number }).crystalFrozen > 0 ? `（冻结 ${(e as unknown as { crystalFrozen: number }).crystalFrozen} 水晶）` : ''}`
        );
        break;
      case 'hearthPlayed':
        console.log(
          `  🔥 玩家 ${e.player} 打出炉石牌（消耗 ${(e as unknown as { cost: number }).cost} 水晶）`
        );
        break;
      case 'drawUno':
        console.log(`  🂠 玩家 ${e.player} 抽 1 张 Uno 牌（打不出）`);
        break;
      case 'drawPenalty':
        console.log(`  ⚡ 玩家 ${e.player} 被罚抽 ${(e as unknown as { count: number }).count} 张`);
        break;
      case 'unoAlert':
        console.log(`  🔊 玩家 ${e.player} 只剩 1 张牌 —— UNO！`);
        break;
      case 'unoCaught':
        console.log(`  ❌ 玩家 ${e.player} 未报牌出完 → 罚抽 4`);
        break;
      case 'endTurn':
        console.log(`  ⏭ 玩家 ${e.player} 结束回合（冻结水晶解冻）`);
        break;
      case 'gameOver': {
        const gameOver = e as unknown as {
          winner: number;
          reason: 'unoEmpty' | 'lastStanding';
        };
        console.log(
          `  🏆 玩家 ${gameOver.winner}${gameOver.reason === 'lastStanding' ? '成为最后幸存者' : '清空 UNO 手牌'}获胜！`
        );
        break;
      }
      default:
        console.log(`  · ${e.type}`);
    }
  }
}

function autoStep(): boolean {
  // 驱动一步：打炉石牌（有 free 水晶时）→ 出 Uno → 打不出则抽 → 结束回合
  if (state.phase === 'gameOver') return false;
  const player = state.players[state.turn]!;
  // 1. 有可用水晶 → 随机打一张能付得起的炉石牌
  const affordable = player.hearthHand
    .map((c, i) => ({ i, cost: getEffect(c.effectId)?.cost ?? 99 }))
    .filter((c) => c.cost <= player.free);
  if (affordable.length > 0) {
    const choice = affordable[Math.floor(rng.next() * affordable.length)]!;
    const targets = state.players
      .map((_, i) => i)
      .filter((i) => i !== state.turn && state.players[i]!.active);
    const target = targets.length > 0 ? targets[rng.int(targets.length)] : undefined;
    const r = dispatch(state, rng, {
      type: 'playHearth',
      player: state.turn,
      cardIdx: choice.i,
      targets: target !== undefined ? [target] : undefined,
    });
    if (r.ok) {
      printEvents(r.events);
      return true;
    }
  }
  // 2. 打 Uno 牌
  const playable = playableUnoIndices(state);
  if (playable.length > 0 && state.unoActionsLeft > 0) {
    const idx = playable[Math.floor(rng.next() * playable.length)]!;
    const card = state.players[state.turn]!.hand[idx]!;
    // Wild 类牌需要选颜色（AI 随机选一个）
    const color =
      card.color === null
        ? (['red', 'yellow', 'green', 'blue'][rng.int(4)] as UnoColor)
        : undefined;
    const r = dispatch(state, rng, {
      type: 'playUno',
      player: state.turn,
      cardIdx: idx,
      color,
    });
    if (r.ok) {
      printEvents(r.events);
      return true;
    }
  }
  // 3. 打不出 → 抽 1 即止
  if (state.unoActionsLeft > 0) {
    const r = dispatch(state, rng, { type: 'drawUno', player: state.turn });
    if (r.ok) {
      printEvents(r.events);
      return true;
    }
  }
  // 4. 抽不了或行动用尽 → 结束回合
  const e = dispatch(state, rng, { type: 'endTurn', player: state.turn });
  if (e.ok) printEvents(e.events);
  return true;
}

function handleInput(line: string): boolean {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  if (!cmd) return true;
  switch (cmd) {
    case 'p': {
      const idx = Number(parts[1]);
      const r = dispatch(state, rng, { type: 'playUno', player: 0, cardIdx: idx });
      if (r.ok) printEvents(r.events);
      else console.log(`  ✗ ${r.error}`);
      return true;
    }
    case 'h': {
      const idx = Number(parts[1]);
      const target = parts[2] ? Number(parts[2]) : 1;
      const r = dispatch(state, rng, {
        type: 'playHearth',
        player: 0,
        cardIdx: idx,
        targets: [target],
      });
      if (r.ok) printEvents(r.events);
      else console.log(`  ✗ ${r.error}`);
      return true;
    }
    case 'd': {
      const r = dispatch(state, rng, { type: 'drawUno', player: 0 });
      if (r.ok) printEvents(r.events);
      else console.log(`  ✗ ${r.error}`);
      return true;
    }
    case 'e': {
      const r = dispatch(state, rng, { type: 'endTurn', player: 0 });
      if (r.ok) printEvents(r.events);
      else console.log(`  ✗ ${r.error}`);
      return true;
    }
    case 'q':
      return false;
    default:
      console.log('  指令: p <n> 出牌 | h <n> [目标] 炉石牌 | d 抽牌 | e 结束回合 | q 退出');
      return true;
  }
}

async function main(): Promise<void> {
  console.log(`\n=== UnoStore 文字对战（seed=${seed}）===\n`);
  render();
  if (!showHands) {
    // 自动对战模式：双方随机出牌直到结束
    let steps = 0;
    while (state.phase !== 'gameOver' && steps < 500) {
      autoStep();
      if (slow) await new Promise((r) => setTimeout(r, 300));
      steps++;
    }
    render();
    console.log(`\n对局结束（${steps} 步）—— 逻辑验证完成`);
    return;
  }
  // 交互模式
  const readline = (await import('node:readline')).createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => readline.question(q, resolve));
  let running = true;
  while (running) {
    const line = await ask('> ');
    running = handleInput(line);
    render();
  }
  readline.close();
}

void main();
