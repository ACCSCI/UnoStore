import { expect, test } from 'bun:test';
import { getEffect } from '../../src/game/hearth/effects/registry';
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
  ];
  for (const id of ids) {
    const effect = getEffect(id);
    expect(effect, `${id} 应已注册`).not.toBeNull();
    expect(effect!.name, `${id} 应有中文名`).toBeTruthy();
    expect(effect!.description, `${id} 应有描述`).toBeTruthy();
    expect(effect!.cost, `${id} 应有费用`).toBeGreaterThanOrEqual(1);
  }
});
