import { expect, test } from 'bun:test';

import { attackRouteGeometry, combatHeroTargetSelectors } from '../../src/ui/scene/MinionBoard';

test('attack route uses a visible great-circle-style arc even for vertically aligned targets', () => {
  const from = { x: 500, y: 800 };
  const to = { x: 500, y: 180 };
  const route = attackRouteGeometry(from, to, { x: 500, y: 500 });
  expect(route.control.x).not.toBe(500);
  expect(route.path).toStartWith('M 500.0 800.0 Q ');
  expect(route.path).toEndWith(' 500.0 180.0');
});

test('attack route keeps exact attacker and target endpoints for hero and minion targeting', () => {
  const from = { x: 120, y: 700 };
  const to = { x: 840, y: 260 };
  const route = attackRouteGeometry(from, to, { x: 480, y: 450 });
  expect(route.path).toStartWith('M 120.0 700.0');
  expect(route.path).toEndWith('840.0 260.0');
  const cross =
    (to.x - from.x) * (route.control.y - from.y) - (to.y - from.y) * (route.control.x - from.x);
  expect(Math.abs(cross)).toBeGreaterThan(1);
});

test('attacks targeting the local hero prefer its visible crest over the hidden round-table seat', () => {
  expect(combatHeroTargetSelectors(0)).toEqual([
    '.player-hero .player-crest',
    '.table-seat[data-seat="0"] .seat-target-button',
  ]);
  expect(combatHeroTargetSelectors(3)).toEqual(['.table-seat[data-seat="3"] .seat-target-button']);
});
