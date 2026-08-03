import { describe, expect, mock, test } from 'bun:test';
import * as THREE from 'three';
import { createPlayedCardMesh } from '../../src/ui/scene/PlayedCardRenderer';

describe('played card animation renderer', () => {
  test('routes UNO and Hearth events to their real card renderers', () => {
    const unoMesh = new THREE.Mesh();
    const hearthMesh = new THREE.Mesh();
    const uno = mock(() => unoMesh);
    const hearth = mock(() => hearthMesh);
    const factories = { uno, hearth };

    expect(
      createPlayedCardMesh(
        { kind: 'uno', card: { id: 'uno-1', color: 'yellow', value: '7' } },
        factories
      )
    ).toBe(unoMesh);
    expect(
      createPlayedCardMesh(
        { kind: 'hearth', card: { id: 'hearth-1', effectId: 'unoAnnihilation' } },
        factories
      )
    ).toBe(hearthMesh);
    expect(uno).toHaveBeenCalledTimes(1);
    expect(hearth).toHaveBeenCalledTimes(1);
  });
});
