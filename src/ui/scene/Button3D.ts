import * as THREE from 'three';

/**
 * 3D 交互按钮（炉石传说风格的圆角按钮）。
 * 悬停抬升 + 点击回调，用 Raycaster 拾取。
 */

const BTN_W = 1.5;
const BTN_H = 0.5;
const BTN_D = 0.08;

export class Button3D {
  private group = new THREE.Group();
  private mesh: THREE.Mesh;
  private baseY: number;
  private hovered = false;

  constructor(
    private scene: THREE.Scene,
    label: string,
    position: THREE.Vector3,
    color: number,
    private onClick: () => void
  ) {
    this.baseY = position.y;
    // 按钮主体
    const geo = new THREE.BoxGeometry(BTN_W, BTN_D, BTN_H);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(position);
    this.mesh.castShadow = true;
    this.mesh.userData.button = label;
    this.group.add(this.mesh);
    // 文字（Canvas 纹理）
    const textSprite = this.makeLabel(label);
    textSprite.position.set(0, BTN_D / 2 + 0.06, 0);
    this.group.add(textSprite);
    this.scene.add(this.group);
  }

  dispose(): void {
    this.scene.remove(this.group);
  }

  /** 用 Raycaster 检测悬停（返回是否命中） */
  intersect(raycaster: THREE.Raycaster): boolean {
    const hit = raycaster.intersectObject(this.mesh, false)[0];
    if (hit && !this.hovered) {
      this.hovered = true;
      this.mesh.position.y = this.baseY + 0.1;
      (this.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x333333);
    } else if (!hit && this.hovered) {
      this.hovered = false;
      this.mesh.position.y = this.baseY;
      (this.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
    }
    return !!hit;
  }

  /** 点击检测（Raycaster 命中时触发） */
  tryClick(raycaster: THREE.Raycaster): boolean {
    if (raycaster.intersectObject(this.mesh, false)[0]) {
      this.onClick();
      return true;
    }
    return false;
  }

  private makeLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.2, 0.3, 1);
    return sprite;
  }
}
