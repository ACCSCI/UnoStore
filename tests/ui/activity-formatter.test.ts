import { expect, test } from 'bun:test';
import type { GameEvent } from '../../src/game/core/events';
import '../../src/game/hearth/cards';
import { formatActivity } from '../../src/ui/screens/ActivityFormatter';

const playerLabel = (player: number): string => `玩家${player + 1}`;

test('随从攻击记录明确显示使用者、攻击者、目标和双方结果，并支持多牌悬停', () => {
  const event: GameEvent = {
    type: 'minionAttack',
    player: 0,
    attackerId: 'attacker',
    attackerEffectId: 'emberWolf',
    targetPlayer: 1,
    targetMinionId: 'defender',
    targetMinionEffectId: 'crystalGuardian',
    attackDamage: 4,
    counterDamage: 4,
    drawCount: 0,
    attackerHealthBefore: 6,
    attackerHealthAfter: 2,
    targetHealthBefore: 7,
    targetHealthAfter: 3,
  };

  const entry = formatActivity(event, playerLabel)!;
  expect(entry.text).toContain('玩家1命令 余烬战狼攻击 玩家2的水晶守卫');
  expect(entry.text).toContain('余烬战狼生命 6→2');
  expect(entry.text).toContain('水晶守卫生命 7→3');
  expect(entry.references?.map((reference) => reference.label)).toEqual([
    '余烬战狼',
    '水晶守卫',
    '余烬战狼',
    '水晶守卫',
  ]);
});

test('清场记录逐个显示目标随从、生命变化、死亡和自罚结果', () => {
  const entry = formatActivity(
    {
      type: 'minionsCleared',
      player: 0,
      effectId: 'unstableNova',
      mode: 'damage',
      damage: 5,
      conditionMet: true,
      affected: [
        {
          targetPlayer: 0,
          minionId: 'friendly',
          effectId: 'stormDrake',
          beforeHealth: 6,
          afterHealth: 1,
          destroyed: false,
        },
        {
          targetPlayer: 1,
          minionId: 'enemy',
          effectId: 'emberWolf',
          beforeHealth: 3,
          afterHealth: 0,
          destroyed: true,
        },
      ],
      selfDrawback: 2,
      selfDrawn: 2,
    },
    playerLabel
  )!;

  expect(entry.text).toContain('玩家1的失稳新星清场');
  expect(entry.text).toContain('玩家1的风暴幼龙 6→1');
  expect(entry.text).toContain('玩家2的余烬战狼 3→0（消灭）');
  expect(entry.text).toContain('应抽 2 张，实际抽 2 张 UNO');
  expect(entry.references).toHaveLength(3);
});

test('炉石选目标记录同时让施放牌和目标随从显示为详情引用', () => {
  const entry = formatActivity(
    {
      type: 'hearthPlayed',
      player: 0,
      cardId: 'poly',
      effectId: 'polymorph',
      cost: 3,
      targetMinionId: 'target',
      targetMinionEffectId: 'goldenCitadel',
      targetMinionOwner: 1,
    },
    playerLabel
  )!;
  expect(entry.text).toContain('玩家1使用 变形术（3 费）→ 玩家2的鎏金圣垒');
  expect(entry.references?.map((reference) => reference.label)).toEqual(['变形术', '鎏金圣垒']);
});
