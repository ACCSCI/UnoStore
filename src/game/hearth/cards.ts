import { nextActiveFrom } from '../core/flow';
import {
  addPenalty,
  defaultTarget,
  discardRandomCards,
  discardSelectedUno,
  doubleMinionStat,
  drawHearthToHand,
  drawMixedToHand,
  exchangeAllMinions,
  exchangeRandomMinions,
  giveSelectedCards,
  passMinionBoards,
  redistributeAllMinions,
  revealUnoHand,
} from './effects/common';
import { getEffect, registerEffect } from './effects/registry';

/**
 * 炉石卡池：法术 + 可上场战斗的随从。
 * 全部通过 registerEffect 注册 —— 新卡牌 = 新数据 + 新 effect，零改动核心状态机。
 */

registerEffect({
  id: 'bolt',
  name: '闪电箭',
  cost: 1,
  description: '对目标玩家造成 3 张罚抽。',
  requiresTarget: true,
  targeting: { type: 'enemyPlayer', count: 1 },
  apply: (ctx) => addPenalty(ctx, ctx.targets?.[0] ?? defaultTarget(ctx), 3),
});

registerEffect({
  id: 'clockworkSquire',
  name: '发条侍从',
  cost: 1,
  description: '可靠的低费前排。',
  kind: 'minion',
  attack: 2,
  health: 3,
  apply: () => {},
});

registerEffect({
  id: 'emberWolf',
  name: '余烬战狼',
  cost: 2,
  description: '冲锋：放置后可立刻攻击。',
  kind: 'minion',
  attack: 4,
  health: 3,
  charge: true,
  apply: () => {},
});

registerEffect({
  id: 'fatefulGift',
  name: '命运馈赠',
  cost: 2,
  description: '选择自己的 2 张手牌，交给指定一名对手。',
  targeting: { type: 'giveCards', count: 2 },
  apply: (ctx) => giveSelectedCards(ctx, ctx.targets![0]!),
});

registerEffect({
  id: 'chromaticConductor',
  name: '虹彩指挥家',
  cost: 3,
  description: '战吼：选择一种颜色，将当前 UNO 颜色改为该颜色。',
  kind: 'minion',
  attack: 5,
  health: 5,
  requiresColor: true,
  apply: (ctx) => {
    if (['red', 'yellow', 'green', 'blue'].includes(ctx.color ?? '')) {
      ctx.state.chosenColor = ctx.color as typeof ctx.state.chosenColor;
    }
  },
});

registerEffect({
  id: 'crystalGuardian',
  name: '水晶守卫',
  cost: 3,
  description: '嘲讽：敌人必须先攻击嘲讽随从，才能攻击你的其他随从或英雄。',
  kind: 'minion',
  attack: 4,
  health: 7,
  taunt: true,
  apply: () => {},
});

registerEffect({
  id: 'stormDrake',
  name: '风暴幼龙',
  cost: 5,
  description: '拥有压倒性攻击力的风暴巨兽。',
  kind: 'minion',
  attack: 8,
  health: 6,
  apply: () => {},
});

registerEffect({
  id: 'shield',
  name: '护盾',
  cost: 2,
  description: '获得 2 层护盾，抵消接下来的两次罚抽。',
  apply: (ctx) => {
    ctx.state.players[ctx.source]!.shield += 2;
  },
});

registerEffect({
  id: 'draw2',
  name: '抽牌术',
  cost: 2,
  description: '随机抽 3 张牌；每张独立从 UNO 或炉石牌库抽取，可能全是同一种。',
  apply: (ctx) => drawMixedToHand(ctx, 3),
});

registerEffect({
  id: 'fireball',
  name: '火球术',
  cost: 3,
  description: '对目标玩家造成 6 张罚抽。',
  requiresTarget: true,
  targeting: { type: 'enemyPlayer', count: 1 },
  apply: (ctx) => addPenalty(ctx, ctx.targets?.[0] ?? defaultTarget(ctx), 6),
});

registerEffect({
  id: 'crystal2',
  name: '水晶充能',
  cost: 1,
  description: '获得 5 颗冻结水晶，下个己方回合可用。',
  apply: (ctx) => {
    ctx.state.players[ctx.source]!.frozen += 5;
  },
});

registerEffect({
  id: 'arcaneArchive',
  name: '奥术档案',
  cost: 3,
  description: '抽 4 张炉石牌。私人炉石牌库耗尽后仍会自动重建。',
  apply: (ctx) => drawHearthToHand(ctx, 4, '奥术档案'),
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
  description: '目标玩家下回合罚抽 3 张。',
  requiresTarget: true,
  targeting: { type: 'enemyPlayer', count: 1 },
  apply: (ctx) => addPenalty(ctx, ctx.targets?.[0] ?? defaultTarget(ctx), 3),
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
  targeting: { type: 'enemyPlayer', count: 1 },
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
  description: '对目标玩家造成 4 张罚抽，并随机抽 2 张 UNO 或炉石牌。',
  requiresTarget: true,
  targeting: { type: 'enemyPlayer', count: 1 },
  apply: (ctx) => {
    addPenalty(ctx, ctx.targets?.[0] ?? defaultTarget(ctx), 4);
    drawMixedToHand(ctx, 2);
  },
});

registerEffect({
  id: 'double',
  name: '双重行动',
  cost: 3,
  description: '本回合再获得 2 次 UNO 行动。',
  apply: (ctx) => {
    ctx.state.unoActionsLeft += 2;
  },
});

registerEffect({
  id: 'bloodboundTitan',
  name: '血契泰坦',
  cost: 5,
  description: '战吼：选择并弃掉 2 张己方 UNO 牌。以鲜血换来压倒性的身材。',
  kind: 'minion',
  attack: 10,
  health: 10,
  targeting: { type: 'ownUnoCards', count: 2 },
  apply: (ctx) => discardSelectedUno(ctx, '血契泰坦的战吼'),
});

registerEffect({
  id: 'spyglassOracle',
  name: '窥镜先知',
  cost: 4,
  description: '战吼：查看对手随机 4 张 UNO；从中拿 1 张，再弃掉 1 张。',
  kind: 'minion',
  attack: 6,
  health: 7,
  targeting: { type: 'enemyPlayer', count: 1 },
  apply: (ctx) => {
    revealUnoHand(ctx, ctx.targets![0]!, 4, true);
  },
});

registerEffect({
  id: 'ashPhoenix',
  name: '余烬凤凰',
  cost: 5,
  description: '亡语：下一名仍在场的对手抽 4 张 UNO 牌。',
  kind: 'minion',
  attack: 7,
  health: 6,
  apply: () => {},
  deathrattle: (ctx) => {
    const target = nextActiveFrom(ctx.state, ctx.source);
    if (target !== ctx.source) ctx.forceUnoDraw(target, 4, '余烬凤凰的亡语');
  },
});

registerEffect({
  id: 'calamityDealer',
  name: '灾厄发牌官',
  cost: 6,
  description: '你的回合开始时：令所有仍在对局中的敌人各强制抽 3 张 UNO 牌。',
  kind: 'minion',
  attack: 8,
  health: 11,
  apply: () => {},
  onTurnStart: (ctx) => {
    for (let player = 0; player < ctx.state.players.length; player++) {
      if (player !== ctx.source && ctx.state.players[player]!.active) {
        ctx.forceUnoDraw(player, 3, '灾厄发牌官的回合开始效果');
      }
    }
  },
});

registerEffect({
  id: 'penaltyBulwark',
  name: '代罚壁垒',
  cost: 5,
  description: '在场时：你受到的全部罚抽改为对本随从造成等量伤害；过量伤害也不会转回玩家。',
  kind: 'minion',
  attack: 5,
  health: 14,
  absorbsPenalty: true,
  apply: () => {},
});

registerEffect({
  id: 'voidGambler',
  name: '虚空赌徒',
  cost: 4,
  description: '你的回合结束时：你的英雄从 UNO 与炉石手牌中随机弃掉 3 张牌。',
  kind: 'minion',
  attack: 9,
  health: 9,
  apply: () => {},
  onTurnEnd: (ctx) => discardRandomCards(ctx, 3, '虚空赌徒的回合结束效果'),
});

registerEffect({
  id: 'graveArchivist',
  name: '墓库典藏官',
  cost: 6,
  description: '亡语：获得 2 层护盾与 3 颗冻结水晶。',
  kind: 'minion',
  attack: 9,
  health: 10,
  apply: () => {},
  deathrattle: (ctx) => {
    const owner = ctx.state.players[ctx.source]!;
    owner.shield += 2;
    owner.frozen += 3;
  },
});

registerEffect({
  id: 'penitentChampion',
  name: '赎罪斗士',
  cost: 4,
  description: '每次攻击时：不造成伤害，改为其拥有者随机弃掉等同于本随从攻击力的 UNO 牌。',
  kind: 'minion',
  attack: 6,
  health: 8,
  discardsInsteadOfDamage: true,
  apply: () => {},
});

registerEffect({
  id: 'bloodMeasureArbiter',
  name: '血尺裁决者',
  cost: 3,
  description: '每次攻击时：你的英雄弃掉所有点数严格小于本随从当前生命值的 UNO 数字牌。',
  kind: 'minion',
  attack: 2,
  health: 4,
  discardsNumbersBelowHealthOnAttack: true,
  apply: () => {},
});

registerEffect({
  id: 'battlefieldRotation',
  name: '战阵轮转',
  cost: 4,
  description: '按当前出牌方向，所有活跃玩家将自己的全部随从交给下一名玩家。',
  apply: (ctx) => passMinionBoards(ctx),
});

registerEffect({
  id: 'duelOfAllegiance',
  name: '单骑易位',
  cost: 3,
  description: '选择两名至少拥有一个随从的英雄，随机交换双方各一个随从。',
  targeting: { type: 'players', count: 2, includeSelf: true, requireMinions: true },
  apply: (ctx) => exchangeRandomMinions(ctx),
});

registerEffect({
  id: 'armyExchange',
  name: '军团易帜',
  cost: 6,
  description: '选择两名英雄，交换双方的全部随从。',
  targeting: { type: 'players', count: 2, includeSelf: true },
  apply: (ctx) => exchangeAllMinions(ctx),
});

registerEffect({
  id: 'chaosConscription',
  name: '混沌点将',
  cost: 7,
  description: '收集场上所有随从，洗混后在所有活跃玩家之间重新随机分配。',
  apply: (ctx) => redistributeAllMinions(ctx),
});

registerEffect({
  id: 'polymorph',
  name: '变形术',
  cost: 3,
  description: '将指定随从变成一个 1/1、没有任何效果的绵羊。',
  targeting: { type: 'minion', count: 1, side: 'any' },
  apply: (ctx) => {
    if (!ctx.targetMinionId) return;
    for (let targetPlayer = 0; targetPlayer < ctx.state.players.length; targetPlayer++) {
      const minion = ctx.state.players[targetPlayer]!.board.find(
        (entry) => entry.id === ctx.targetMinionId
      );
      if (!minion) continue;
      const fromEffectId = minion.effectId;
      minion.effectId = 'sheepToken';
      minion.attack = 1;
      minion.health = 1;
      minion.maxHealth = 1;
      ctx.events.push({
        type: 'minionTransformed',
        player: ctx.source,
        targetPlayer,
        minionId: minion.id,
        fromEffectId,
        toEffectId: 'sheepToken',
      });
      return;
    }
  },
});

registerEffect({
  id: 'equalityOfAll',
  name: '众生平等',
  cost: 4,
  description: '将场上所有随从的攻击力、当前生命值与生命上限变为 1；保留原有效果。',
  apply: (ctx) => {
    const affected = ctx.state.players.flatMap((player, targetPlayer) =>
      player.board.map((minion) => {
        const change = {
          targetPlayer,
          minionId: minion.id,
          beforeAttack: minion.attack,
          beforeHealth: minion.health,
          beforeMaxHealth: minion.maxHealth,
        };
        minion.attack = 1;
        minion.health = 1;
        minion.maxHealth = 1;
        return change;
      })
    );
    ctx.events.push({ type: 'minionsEqualized', player: ctx.source, affected });
  },
});

registerEffect({
  id: 'sheepToken',
  name: '绵羊',
  cost: 0,
  description: '一只 1/1、没有任何效果的绵羊。咩。',
  kind: 'minion',
  attack: 1,
  health: 1,
  apply: () => {},
});

registerEffect({
  id: 'powerAcolyte',
  name: '灵能侍祭',
  cost: 3,
  description: '在场时：你的英雄技能费用减少 1 点。',
  kind: 'minion',
  attack: 4,
  health: 5,
  heroPowerCostReduction: 1,
  apply: () => {},
});

registerEffect({
  id: 'powerUnbound',
  name: '失控的司炉',
  cost: 5,
  description: '在场时：你的英雄技能不再受每回合一次的限制。',
  kind: 'minion',
  attack: 7,
  health: 8,
  unlimitedHeroPower: true,
  apply: () => {},
});

registerEffect({
  id: 'berserkerOath',
  name: '狂战誓约',
  cost: 3,
  description: '使一个己方随从的攻击力翻倍。',
  targeting: { type: 'minion', count: 1, side: 'friendly' },
  apply: (ctx) => doubleMinionStat(ctx, 'attack'),
});

registerEffect({
  id: 'vitalSurge',
  name: '生命洪流',
  cost: 3,
  description: '使一个己方随从的当前生命值与生命上限翻倍。',
  targeting: { type: 'minion', count: 1, side: 'friendly' },
  apply: (ctx) => doubleMinionStat(ctx, 'health'),
});

registerEffect({
  id: 'warcryCommander',
  name: '战歌统帅',
  cost: 6,
  description: '战吼：使另一个己方随从的攻击力翻倍。',
  kind: 'minion',
  attack: 8,
  health: 8,
  targeting: { type: 'minion', count: 1, side: 'friendly' },
  apply: (ctx) => doubleMinionStat(ctx, 'attack'),
});

registerEffect({
  id: 'bloodforgeColossus',
  name: '血铸巨匠',
  cost: 7,
  description: '战吼：使另一个己方随从的当前生命值与生命上限翻倍。',
  kind: 'minion',
  attack: 8,
  health: 12,
  targeting: { type: 'minion', count: 1, side: 'friendly' },
  apply: (ctx) => doubleMinionStat(ctx, 'health'),
});

registerEffect({
  id: 'goldenCitadel',
  name: '鎏金圣垒',
  cost: 8,
  description: '嘲讽：敌人必须先攻击它，才能攻击你的其他随从或英雄。',
  kind: 'minion',
  attack: 13,
  health: 18,
  taunt: true,
  apply: () => {},
});

registerEffect({
  id: 'agonyDevourer',
  name: '苦痛吞噬者',
  cost: 9,
  description: '在场时：你的全部罚抽改为对本随从造成等量伤害，过量伤害也不会转回玩家。',
  kind: 'minion',
  attack: 15,
  health: 24,
  absorbsPenalty: true,
  apply: () => {},
});

registerEffect({
  id: 'unoAnnihilation',
  name: 'UNO 湮灭',
  cost: 7,
  description: '选择并弃掉最多 5 张己方 UNO 手牌；不足 5 张时弃掉全部。',
  targeting: { type: 'ownUnoCards', count: 5, useAllWhenShort: true },
  apply: (ctx) => discardSelectedUno(ctx, 'UNO 湮灭'),
});

registerEffect({
  id: 'forcedConscription',
  name: '强制征牌',
  cost: 4,
  description: '指定一名对手，立即向其手中塞入 5 张 UNO 牌。',
  targeting: { type: 'enemyPlayer', count: 1 },
  apply: (ctx) => ctx.forceUnoDraw(ctx.targets![0]!, 5, '强制征牌'),
});
