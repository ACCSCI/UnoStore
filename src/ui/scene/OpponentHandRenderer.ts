import * as THREE from 'three';
import { assetUrl } from '../assets/url';

/**
 * 对手手牌渲染（炉石传说风格）：
 * 顶部一排牌背（朝向自己），只显示数量，不暴露牌面。
 */
export class OpponentHandRenderer {
  private group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private backTex: THREE.Texture | null = null;

  constructor(private scene: THREE.Scene) {
    this.scene.add(this.group);
  }

  /** 同步对手手牌数（牌背数量 = 手牌数） */
  sync(count: number): void {
    // 移除多余的牌背
    while (this.meshes.length > count) {
      const m = this.meshes.pop()!;
      this.group.remove(m);
      m.geometry.dispose();
      disposeMaterial(m.material);
    }
    // 补充牌背
    while (this.meshes.length < count) {
      this.meshes.push(this.createBackCard());
    }
    // 布局：顶部紧凑扇形（牌背朝向玩家）
    const n = this.meshes.length;
    this.meshes.forEach((mesh, i) => {
      const t = n <= 1 ? 0 : i / (n - 1) - 0.5;
      const angle = t * 0.55;
      mesh.position.set(t * 0.3 * (n - 1), 0.8, -4.35 + Math.abs(angle) * 0.15);
      mesh.rotation.set(-0.12, -angle, 0);
    });
  }

  private createBackCard(): THREE.Mesh {
    if (!this.backTex) {
      this.backTex = new THREE.TextureLoader().load(
        assetUrl('/assets/images/dual-deck-card-back.webp')
      );
      this.backTex.colorSpace = THREE.SRGBColorSpace;
    }
    // 立起卡牌：+z 面 = 牌背（朝向玩家）
    const geo = new THREE.BoxGeometry(0.5, 0.72, 0.03);
    const back = new THREE.MeshStandardMaterial({ map: this.backTex, roughness: 0.4 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x15153c, roughness: 0.8 });
    const mesh = new THREE.Mesh(geo, [edge, edge, edge, edge, back, edge]);
    mesh.castShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      disposeMaterial(mesh.material);
    }
    this.meshes = [];
    this.backTex?.dispose();
    this.scene.remove(this.group);
  }
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  for (const item of Array.isArray(material) ? material : [material]) item.dispose();
}
