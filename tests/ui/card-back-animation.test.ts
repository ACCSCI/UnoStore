import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { CARD_BACK_ASSET, createDrawCardBackMesh } from '../../src/ui/scene/CardBackRenderer';

describe('draw card animation', () => {
  test('uses the shared card-back art on both visible faces', () => {
    const texture = new THREE.Texture();
    const mesh = createDrawCardBackMesh(texture);
    const materials = mesh.material as THREE.MeshStandardMaterial[];

    expect(CARD_BACK_ASSET).toBe('/assets/images/dual-deck-card-back.webp');
    expect(mesh.name).toBe('draw-card-back');
    expect(materials).toHaveLength(6);
    expect(materials[2]?.map).toBe(texture);
    expect(materials[3]?.map).toBe(texture);
    expect(materials.filter((material) => material.map === texture)).toHaveLength(2);
  });
});
