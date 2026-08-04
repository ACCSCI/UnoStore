import { describe, expect, test } from 'bun:test';
import {
  HAND_CANDIDATE_OUTLINE,
  HAND_SELECTED_OUTLINE,
  resolveHandCardOutline,
  resolveHandInteractionMode,
  shouldSelectHandCard,
} from '../../src/ui/scene/HandInteractionMode';

describe('shared hand selection mode', () => {
  test('directly selects an eligible card even when the selection starts empty', () => {
    const mode = resolveHandInteractionMode({
      hearthCardId: null,
      unoTargetCardId: null,
      heroUnoSelection: new Set(),
    });

    expect(mode).toBe('select');
    expect(shouldSelectHandCard(mode, true)).toBe(true);
  });

  test('uses the same mode for UNO Annihilation and other Hearth hand targeting', () => {
    const mode = resolveHandInteractionMode({
      hearthCardId: 'uno-annihilation-instance',
      unoTargetCardId: null,
      heroUnoSelection: null,
    });

    expect(mode).toBe('select');
    expect(shouldSelectHandCard('select', true)).toBe(true);
  });

  test('does not steal normal play interactions or accept ineligible cards', () => {
    expect(shouldSelectHandCard('play', true)).toBe(false);
    expect(shouldSelectHandCard('select', false)).toBe(false);
    expect(
      resolveHandInteractionMode({
        hearthCardId: null,
        unoTargetCardId: null,
        heroUnoSelection: null,
      })
    ).toBe('play');
  });

  test('uses a red outline for every selected card and gold only for candidates', () => {
    expect(resolveHandCardOutline(true, false)).toMatchObject({
      visible: true,
      color: HAND_CANDIDATE_OUTLINE,
    });
    expect(resolveHandCardOutline(true, true)).toMatchObject({
      visible: true,
      color: HAND_SELECTED_OUTLINE,
    });
    expect(resolveHandCardOutline(false, true)).toMatchObject({
      visible: true,
      color: HAND_SELECTED_OUTLINE,
    });
    expect(resolveHandCardOutline(false, false).visible).toBe(false);
  });
});

test('所有回合内交互在超时或权威回合变更时都会被清理', async () => {
  const localSource = await Bun.file(
    new URL('../../src/ui/screens/BattleScreen.ts', import.meta.url)
  ).text();
  const multiplayerSource = await Bun.file(
    new URL('../../src/ui/screens/MultiplayerBattleScreen.ts', import.meta.url)
  ).text();
  const localTimeout = localSource.slice(
    localSource.indexOf('private expireLocalTurn'),
    localSource.indexOf('private reactToEvents')
  );
  const multiplayerSnapshot = multiplayerSource.slice(
    multiplayerSource.indexOf('private applySnapshot'),
    multiplayerSource.indexOf('private playHeroEmoteSideChannel')
  );

  expect(localTimeout).toContain('this.cancelTargeting(false)');
  expect(localTimeout).toContain('dismissColorPickers(this.root)');
  expect(multiplayerSnapshot).toContain('this.cancelTargeting(false)');
  expect(multiplayerSnapshot).toContain('dismissColorPickers(this.root)');
});
