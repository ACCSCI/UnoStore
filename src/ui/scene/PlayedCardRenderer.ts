import * as THREE from 'three';
import type { HearthCard } from '../../game/core/state';
import type { UnoCard } from '../../game/uno/types';
import { createCardMesh } from './CardRenderer';
import { createHearthCardMesh } from './HearthCardRenderer';

export type PlayedCardVisual =
  | { kind: 'uno'; card: UnoCard }
  | { kind: 'hearth'; card: HearthCard };

interface PlayedCardMeshFactories {
  uno: (card: UnoCard) => THREE.Mesh;
  hearth: (card: HearthCard) => THREE.Mesh;
}

const DEFAULT_FACTORIES: PlayedCardMeshFactories = {
  uno: createCardMesh,
  hearth: createHearthCardMesh,
};

/** 出牌演出只能复用真实 UNO/炉石渲染器，不允许再生成纯色卡牌占位物。 */
export function createPlayedCardMesh(
  visual: PlayedCardVisual,
  factories: PlayedCardMeshFactories = DEFAULT_FACTORIES
): THREE.Mesh {
  return visual.kind === 'uno' ? factories.uno(visual.card) : factories.hearth(visual.card);
}

/** UNO 卡面纹理由该次演出独占；炉石卡面使用全局缓存，只释放材质本身。 */
export function disposePlayedCardMesh(mesh: THREE.Mesh, disposeMaps: boolean): void {
  mesh.geometry.dispose();
  const materials = new Set(Array.isArray(mesh.material) ? mesh.material : [mesh.material]);
  for (const material of materials) {
    if (disposeMaps && material instanceof THREE.MeshStandardMaterial) material.map?.dispose();
    material.dispose();
  }
}
