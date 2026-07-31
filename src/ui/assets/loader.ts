import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * GLB 资产加载器。
 * Blender 建模 → public/assets/*.glb → gltf-transform 压缩（draco + webp）
 * → 运行时 GLTFLoader + DRACOLoader 加载。
 * 压缩管线：bun run compress
 */

export interface GameAssets {
  /** 主场景：牌桌 + 卡牌样例 + 吉祥物 */
  table: THREE.Group;
}

let loaderCache: Promise<GameAssets> | null = null;

export function loadGameAssets(): Promise<GameAssets> {
  if (loaderCache) return loaderCache;
  loaderCache = new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    // Draco 压缩解码（table.compressed.glb）
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(draco);
    loader.load(
      '/assets/table.compressed.glb',
      (gltf) => resolve({ table: gltf.scene }),
      undefined,
      (err) => reject(err)
    );
  });
  return loaderCache;
}

/** 同步占位（资产未就绪时给个空组，避免 UI 阻塞） */
export function emptyAssets(): GameAssets {
  return { table: new THREE.Group() };
}
