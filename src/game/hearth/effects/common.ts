import { nextActiveFrom } from '../../core/flow';
import type { EffectCtx } from './registry';

/** 公共辅助：给目标玩家加罚抽 */
export function addPenalty(ctx: EffectCtx, player: number, count: number): void {
  const p = ctx.state.players[player];
  if (!p) return;
  if (p.shield > 0) {
    p.shield -= 1;
    ctx.state.log.push(`玩家 ${player} 护盾抵消 ${count} 张罚抽`);
  } else {
    p.pendingDraw += count;
  }
}

/** 默认目标：当前玩家的下一个活跃玩家 */
export function defaultTarget(ctx: EffectCtx): number {
  return nextActiveFrom(ctx.state, ctx.state.turn);
}

/** 获得一张随机 Uno 牌加入手牌（从公共牌堆） */
export function drawUnoToHand(ctx: EffectCtx, count: number): void {
  const p = ctx.state.players[ctx.source]!;
  for (let i = 0; i < count; i++) {
    const card = ctx.state.unoDraw.pop();
    if (card) p.hand.push(card);
  }
}
