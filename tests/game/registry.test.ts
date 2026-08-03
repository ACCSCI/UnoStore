import { expect, test } from 'bun:test';
import {
  allEffects,
  effectKeywords,
  getEffect,
  HEARTH_KEYWORDS,
} from '../../src/game/hearth/effects/registry';
import { CARD_PRESENTATION } from '../../src/ui/effects/CardEffects';
import '../../src/game/hearth/cards';

test('炉石 effect 注册表完整（无效果未知）', () => {
  const ids = [
    'bolt',
    'shield',
    'draw2',
    'fireball',
    'crystal2',
    'reverse2',
    'massSkip',
    'freeze2',
    'untap',
    'steal',
    'timeTwist',
    'echo',
    'manaBlast',
    'double',
    'clockworkSquire',
    'emberWolf',
    'fatefulGift',
    'chromaticConductor',
    'crystalGuardian',
    'stormDrake',
    'bloodboundTitan',
    'spyglassOracle',
    'ashPhoenix',
    'graveArchivist',
    'arcaneArchive',
    'calamityDealer',
    'doomDealer',
    'penaltyBulwark',
    'voidGambler',
    'penitentChampion',
    'polymorph',
    'equalityOfAll',
    'powerAcolyte',
    'powerUnbound',
    'berserkerOath',
    'vitalSurge',
    'warcryCommander',
    'bloodforgeColossus',
    'goldenCitadel',
    'agonyDevourer',
    'unoAnnihilation',
    'forcedConscription',
    'bloodMeasureArbiter',
    'battlefieldRotation',
    'duelOfAllegiance',
    'armyExchange',
    'chaosConscription',
    'cinderSweep',
    'unstableNova',
    'finalCollapse',
    'dustchargeSapper',
    'apocalypseHerald',
  ];
  for (const id of ids) {
    const effect = getEffect(id);
    expect(effect, `${id} 应已注册`).not.toBeNull();
    expect(effect!.name, `${id} 应有中文名`).toBeTruthy();
    expect(effect!.description, `${id} 应有描述`).toBeTruthy();
    expect(effect!.cost, `${id} 应有费用`).toBeGreaterThanOrEqual(1);
  }
});

test('每张炉石牌都有明确的视觉与音效主题', () => {
  for (const effect of allEffects()) {
    expect(CARD_PRESENTATION[effect.id], `${effect.id} 缺少逐牌表现配置`).toBeTruthy();
  }
});

test('回合触发描述必须明确是拥有者还是任意玩家的回合', () => {
  for (const effect of allEffects()) {
    expect(effect.description, `${effect.name} 的回合触发范围含糊`).not.toMatch(
      /^回合(?:开始|结束)/
    );
  }
  expect(getEffect('calamityDealer')?.description).toMatch(/^你的回合开始时/);
  expect(getEffect('doomDealer')?.description).toMatch(/^任意玩家的回合开始时/);
  expect(getEffect('voidGambler')?.description).toMatch(/^你的回合结束时/);
});

test('随从关键词由注册表统一推导并提供可复用释义', () => {
  expect(effectKeywords(getEffect('emberWolf'))).toContain('charge');
  expect(effectKeywords(getEffect('crystalGuardian'))).toContain('taunt');
  expect(effectKeywords(getEffect('ashPhoenix'))).toContain('deathrattle');
  expect(effectKeywords(getEffect('warcryCommander'))).toContain('battlecry');
  expect(effectKeywords(getEffect('goldenCitadel'))).toContain('taunt');
  expect(effectKeywords(getEffect('penaltyBulwark'))).toContain('penaltyProxy');
  expect(effectKeywords(getEffect('cinderSweep'))).toContain('boardClear');
  expect(effectKeywords(getEffect('dustchargeSapper'))).toContain('battlecry');
  expect(HEARTH_KEYWORDS.charge.description).toContain('立即攻击');
  expect(HEARTH_KEYWORDS.penaltyProxy.name).toBe('代罚');
});

test('高费嘲讽与代罚随从拥有足够强的身材', () => {
  expect(getEffect('goldenCitadel')).toMatchObject({
    cost: 8,
    attack: 13,
    health: 18,
    taunt: true,
  });
  expect(getEffect('agonyDevourer')).toMatchObject({
    cost: 9,
    attack: 15,
    health: 24,
    absorbsPenalty: true,
  });
});
