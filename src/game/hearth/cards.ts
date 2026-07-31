import { addPenalty, defaultTarget, drawUnoToHand } from './effects/common';
import { getEffect, registerEffect } from './effects/registry';

/**
 * V1 炉石卡池（14 张效果）。
 * 全部通过 registerEffect 注册 —— 新卡牌 = 新数据 + 新 effect，零改动核心状态机。
 */

registerEffect({
  id: 'bolt',
  name: '闪电箭',
  cost: 1,
  description: '对目标玩家造成 2 张罚抽',
  requiresTarget: true,
  apply: (ctx) => addPenalty(ctx, ctx.targets?.[0] ?? defaultTarget(ctx), 2),
});

registerEffect({
  id: 'shield',
  name: '护盾',
  cost: 2,
  description: '获得 1 层护盾，抵消下一次罚抽',
  apply: (ctx) => {
    ctx.state.players[ctx.source]!.shield += 1;
  },
});

registerEffect({
  id: 'draw2',
  name: '抽牌术',
  cost: 2,
  description: '抽 2 张 Uno 牌加入手牌',
  apply: (ctx) => drawUnoToHand(ctx, 2),
});

registerEffect({
  id: 'fireball',
  name: '火球术',
  cost: 3,
  description: '对目标玩家造成 4 张罚抽',
  requiresTarget: true,
  apply: (ctx) => addPenalty(ctx, ctx.targets?.[0] ?? defaultTarget(ctx), 4),
});

registerEffect({
  id: 'crystal2',
  name: '水晶充能',
  cost: 3,
  description: '获得 2 颗冻结水晶（下回合可用）',
  apply: (ctx) => {
    ctx.state.players[ctx.source]!.frozen += 2;
  },
});

registerEffect({
  id: 'reverse2',
  name: '逆转',
  cost: 3,
  description: '反转出牌方向',
  apply: (ctx) => {
    ctx.state.direction = (ctx.state.direction * -1) as 1 | -1;
  },
});

registerEffect({
  id: 'massSkip',
  name: '时间静止',
  cost: 4,
  description: '所有其他玩家跳过 1 次行动',
  requiresTarget: false,
  apply: (ctx) => {
    const others = ctx.state.players
      .map((pl, i) => (pl.active && i !== ctx.source ? i : -1))
      .filter((i) => i >= 0);
    ctx.state.skipQueue.push(...others);
  },
});

registerEffect({
  id: 'freeze2',
  name: '冰霜新星',
  cost: 2,
  description: '目标玩家下回合罚抽 1 张',
  requiresTarget: true,
  apply: (ctx) => addPenalty(ctx, ctx.targets?.[0] ?? defaultTarget(ctx), 1),
});

registerEffect({
  id: 'untap',
  name: '超载',
  cost: 2,
  description: '获得 4 颗冻结水晶，下回合可用',
  apply: (ctx) => {
    ctx.state.players[ctx.source]!.frozen += 4;
  },
});

registerEffect({
  id: 'steal',
  name: '窃取',
  cost: 3,
  description: '从目标玩家手牌随机偷 1 张 Uno 牌',
  requiresTarget: true,
  apply: (ctx) => {
    const target = ctx.targets?.[0] ?? defaultTarget(ctx);
    const t = ctx.state.players[target]!;
    if (t.hand.length === 0) return;
    const i = ctx.rng.int(t.hand.length);
    const [card] = t.hand.splice(i, 1);
    if (card) ctx.state.players[ctx.source]!.hand.push(card);
  },
});

registerEffect({
  id: 'timeTwist',
  name: '时间扭曲',
  cost: 5,
  description: '获得 2 点额外 Uno 行动（本回合可多打 2 张 Uno 牌）',
  apply: (ctx) => {
    ctx.state.unoActionsLeft += 2;
    ctx.state.massSkipUsed = true;
  },
});

registerEffect({
  id: 'echo',
  name: '回声',
  cost: 4,
  description: '复制上一张炉石牌的效果（无目标版本）',
  apply: (ctx) => {
    const p = ctx.state.players[ctx.source]!;
    const last = p.hearthPile[p.hearthPile.length - 2]; // 上一张打出的
    if (!last) return;
    const effect = getEffect(last.effectId);
    if (effect && effect.id !== 'echo') effect.apply(ctx);
  },
});

registerEffect({
  id: 'manaBlast',
  name: '法力风暴',
  cost: 4,
  description: '对目标玩家造成 2 张罚抽，并获得 1 张随机 Uno 牌',
  requiresTarget: true,
  apply: (ctx) => {
    addPenalty(ctx, ctx.targets?.[0] ?? defaultTarget(ctx), 2);
    drawUnoToHand(ctx, 1);
  },
});

registerEffect({
  id: 'double',
  name: '双重行动',
  cost: 3,
  description: '本回合再获得 1 次 Uno 行动',
  apply: (ctx) => {
    ctx.state.unoActionsLeft += 1;
  },
});
