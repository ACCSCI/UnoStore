import * as THREE from 'three';
import type { HeroId } from '../../game/heroes';
import { assetUrl } from '../assets/url';

type PuppetGesture = 'idle' | 'greeting' | 'praise' | 'thanks' | 'wow' | 'threat' | 'taunt';

interface Point {
  x: number;
  y: number;
}

interface ArmLandmarks {
  shoulder: Point;
  elbow: Point;
  wrist: Point;
  fingertips: Point;
}

interface RigDefinition {
  aspect: number;
  head: readonly Point[];
  torso: readonly Point[];
  lowerBody: readonly Point[];
  hip: Point;
  headPivot: Point;
  left: ArmLandmarks;
  right: ArmLandmarks;
  upperWidth: [number, number];
  forearmWidth: [number, number];
  handWidth: [number, number];
}

interface PuppetBones {
  root: THREE.Bone;
  hips: THREE.Bone;
  torso: THREE.Bone;
  head: THREE.Bone;
  leftUpperArm: THREE.Bone;
  leftForearm: THREE.Bone;
  leftHand: THREE.Bone;
  rightUpperArm: THREE.Bone;
  rightForearm: THREE.Bone;
  rightHand: THREE.Bone;
  coat: THREE.Bone;
}

interface PuppetPose {
  bodyX: number;
  bodyY: number;
  bodyRoll: number;
  headX: number;
  headY: number;
  headRoll: number;
  leftUpperArm: number;
  leftForearm: number;
  leftHand: number;
  rightUpperArm: number;
  rightForearm: number;
  rightHand: number;
  coatSway: number;
  speech: number;
}

const HERO_TEXTURES: Record<HeroId, string> = {
  cardMaster: '/assets/images/tavern/cardMaster-rig',
  thug: '/assets/images/tavern/thug-rig',
  inspector: '/assets/images/tavern/inspector-rig',
};

const rect = (left: number, top: number, right: number, bottom: number): readonly Point[] => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
];

/**
 * Landmarks are authored against the generated transparent T-pose textures.
 * They define independent art meshes; no mesh spans two anatomical joints.
 */
const RIGS: Record<HeroId, RigDefinition> = {
  thug: {
    aspect: 970 / 1024,
    head: rect(0.395, 0.025, 0.61, 0.23),
    torso: [
      { x: 0.405, y: 0.15 },
      { x: 0.595, y: 0.15 },
      { x: 0.65, y: 0.23 },
      { x: 0.64, y: 0.42 },
      { x: 0.695, y: 0.55 },
      { x: 0.305, y: 0.55 },
      { x: 0.36, y: 0.42 },
      { x: 0.35, y: 0.23 },
    ],
    lowerBody: rect(0.305, 0.47, 0.695, 0.995),
    hip: { x: 0.5, y: 0.51 },
    headPivot: { x: 0.5, y: 0.205 },
    left: {
      shoulder: { x: 0.39, y: 0.225 },
      elbow: { x: 0.205, y: 0.282 },
      wrist: { x: 0.085, y: 0.318 },
      fingertips: { x: 0.018, y: 0.335 },
    },
    right: {
      shoulder: { x: 0.61, y: 0.225 },
      elbow: { x: 0.795, y: 0.282 },
      wrist: { x: 0.915, y: 0.318 },
      fingertips: { x: 0.982, y: 0.335 },
    },
    upperWidth: [0.105, 0.078],
    forearmWidth: [0.08, 0.065],
    handWidth: [0.064, 0.052],
  },
  cardMaster: {
    aspect: 860 / 1024,
    head: rect(0.405, 0.025, 0.605, 0.205),
    torso: [
      { x: 0.41, y: 0.14 },
      { x: 0.59, y: 0.14 },
      { x: 0.635, y: 0.215 },
      { x: 0.625, y: 0.39 },
      { x: 0.705, y: 0.525 },
      { x: 0.295, y: 0.525 },
      { x: 0.375, y: 0.39 },
      { x: 0.365, y: 0.215 },
    ],
    lowerBody: rect(0.275, 0.41, 0.725, 0.99),
    hip: { x: 0.5, y: 0.48 },
    headPivot: { x: 0.505, y: 0.185 },
    left: {
      shoulder: { x: 0.38, y: 0.205 },
      elbow: { x: 0.17, y: 0.247 },
      wrist: { x: 0.105, y: 0.278 },
      fingertips: { x: 0.02, y: 0.275 },
    },
    right: {
      shoulder: { x: 0.62, y: 0.205 },
      elbow: { x: 0.83, y: 0.247 },
      wrist: { x: 0.895, y: 0.278 },
      fingertips: { x: 0.98, y: 0.275 },
    },
    upperWidth: [0.13, 0.19],
    forearmWidth: [0.19, 0.09],
    handWidth: [0.065, 0.052],
  },
  inspector: {
    aspect: 816 / 1024,
    head: rect(0.405, 0.018, 0.6, 0.205),
    torso: [
      { x: 0.405, y: 0.145 },
      { x: 0.595, y: 0.145 },
      { x: 0.645, y: 0.22 },
      { x: 0.635, y: 0.41 },
      { x: 0.7, y: 0.53 },
      { x: 0.3, y: 0.53 },
      { x: 0.365, y: 0.41 },
      { x: 0.355, y: 0.22 },
    ],
    lowerBody: rect(0.295, 0.42, 0.705, 0.995),
    hip: { x: 0.5, y: 0.49 },
    headPivot: { x: 0.505, y: 0.185 },
    left: {
      shoulder: { x: 0.37, y: 0.215 },
      elbow: { x: 0.18, y: 0.255 },
      wrist: { x: 0.105, y: 0.278 },
      fingertips: { x: 0.022, y: 0.275 },
    },
    right: {
      shoulder: { x: 0.63, y: 0.215 },
      elbow: { x: 0.82, y: 0.255 },
      wrist: { x: 0.895, y: 0.278 },
      fingertips: { x: 0.978, y: 0.275 },
    },
    upperWidth: [0.105, 0.085],
    forearmWidth: [0.09, 0.07],
    handWidth: [0.067, 0.05],
  },
};

const textureCache = new Map<string, THREE.Texture>();
const textureWaiters = new Map<string, Array<(texture: THREE.Texture) => void>>();
export const PAPER_PUPPET_SOURCE_HEIGHT = 4;
export const PAPER_PUPPET_BASE_SCALE = 0.92;
const PUPPET_HEIGHT = PAPER_PUPPET_SOURCE_HEIGHT;
const REST_LEFT_UPPER = 1.02;
const REST_LEFT_FOREARM = 0.34;
const REST_RIGHT_UPPER = -1.02;
const REST_RIGHT_FOREARM = -0.34;
type RestPose = Pick<
  PuppetPose,
  | 'bodyRoll'
  | 'headRoll'
  | 'leftUpperArm'
  | 'leftForearm'
  | 'leftHand'
  | 'rightUpperArm'
  | 'rightForearm'
  | 'rightHand'
>;
const CHARACTER_REST: Record<HeroId, RestPose> = {
  thug: {
    bodyRoll: -0.026,
    headRoll: 0.032,
    leftUpperArm: 0.94,
    leftForearm: 0.5,
    leftHand: -0.14,
    rightUpperArm: -1.08,
    rightForearm: -0.22,
    rightHand: 0.04,
  },
  cardMaster: {
    bodyRoll: 0.02,
    headRoll: -0.03,
    leftUpperArm: 1.08,
    leftForearm: 0.24,
    leftHand: -0.04,
    rightUpperArm: -0.9,
    rightForearm: -0.5,
    rightHand: 0.14,
  },
  inspector: {
    bodyRoll: -0.012,
    headRoll: 0.018,
    leftUpperArm: 0.98,
    leftForearm: 0.44,
    leftHand: -0.12,
    rightUpperArm: -1.08,
    rightForearm: -0.24,
    rightHand: 0.05,
  },
};

/**
 * Layered 2D art-mesh puppet.
 *
 * This follows the same construction rule used by Cubism/Spine: independently
 * cut torso, head, upper-arm, forearm and hand meshes are attached to a parent-
 * child bone hierarchy. Large joint motion uses rotation bones; only breathing,
 * gaze and cloth follow-through use small local deformations.
 */
export class PaperPuppet {
  readonly group = new THREE.Group();
  readonly skeleton: THREE.Skeleton;

  private readonly material: THREE.MeshBasicMaterial;
  private readonly outlineMaterial: THREE.ShaderMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly outlineMeshes: THREE.Mesh[] = [];
  private readonly hudAnchor = new THREE.Object3D();
  private readonly footAnchor = new THREE.Object3D();
  private readonly bones: PuppetBones;
  private gesture: PuppetGesture = 'idle';
  private gestureStarted = 0;
  private gestureUntil = 0;
  private gestureSeed = 0;
  private speaking = false;

  constructor(
    readonly heroId: HeroId,
    private readonly idlePhase = 0
  ) {
    const rig = RIGS[heroId];
    const width = PUPPET_HEIGHT * rig.aspect;
    this.group.name = `layered-artmesh-puppet-${heroId}`;
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: false,
      alphaTest: 0.035,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.outlineMaterial = createPuppetOutlineMaterial();
    loadModernTexture(HERO_TEXTURES[heroId], (texture) => {
      this.material.map = texture;
      this.material.needsUpdate = true;
      this.outlineMaterial.uniforms.uMap!.value = texture;
      for (const outline of this.outlineMeshes) outline.visible = true;
    });

    this.bones = this.createLayeredRig(rig, width);
    const boneList = Object.values(this.bones);
    this.skeleton = new THREE.Skeleton(boneList);
    this.group.add(this.bones.root);
    this.hudAnchor.name = `${heroId}-waist-hud-anchor`;
    this.hudAnchor.position.set(0, 0.12, 0);
    this.bones.torso.add(this.hudAnchor);
    this.footAnchor.name = `${heroId}-foot-occlusion-anchor`;
    this.footAnchor.position.set(0, 0.025, 0);
    this.group.add(this.footAnchor);
    this.group.scale.setScalar(PAPER_PUPPET_BASE_SCALE);
    this.group.userData.rig = {
      type: 'layered-artmesh-bone-hierarchy',
      authoringModel: 'Cubism-compatible cutout structure',
      bones: boneList.map((bone) => bone.name),
      parts: this.geometries.length,
    };
  }

  playGesture(emoteId: string, durationMs = 4200): void {
    this.gesture = isGesture(emoteId) ? emoteId : 'greeting';
    this.gestureStarted = performance.now();
    this.gestureUntil = this.gestureStarted + durationMs;
    this.gestureSeed = (this.gestureStarted % 997) / 997;
    this.speaking = true;
  }

  update(elapsed: number, nowMs: number): void {
    if (nowMs >= this.gestureUntil) {
      this.gesture = 'idle';
      this.speaking = false;
    }
    const pose = this.timelinePose(elapsed, nowMs);
    this.applyPose(pose, elapsed);
  }

  getHudWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    this.group.updateWorldMatrix(true, true);
    return this.hudAnchor.getWorldPosition(target);
  }

  getFootWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    this.group.updateWorldMatrix(true, true);
    return this.footAnchor.getWorldPosition(target);
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    this.material.dispose();
    this.outlineMaterial.dispose();
  }

  private createLayeredRig(rig: RigDefinition, width: number): PuppetBones {
    const bone = (name: string): THREE.Bone => {
      const next = new THREE.Bone();
      next.name = name;
      return next;
    };
    const root = bone('root');
    const hips = bone('hips');
    const torso = bone('torso-warp');
    const coat = bone('coat-follow-through');
    const head = bone('head-warp');
    const leftUpperArm = bone('left-upper-arm');
    const leftForearm = bone('left-forearm');
    const leftHand = bone('left-hand');
    const rightUpperArm = bone('right-upper-arm');
    const rightForearm = bone('right-forearm');
    const rightHand = bone('right-hand');

    hips.position.copy(toWorld(rig.hip, width));
    root.add(hips);
    hips.add(coat, torso);
    head.position.copy(deltaWorld(rig.headPivot, rig.hip, width));
    torso.add(head);
    leftUpperArm.position.copy(deltaWorld(rig.left.shoulder, rig.hip, width));
    rightUpperArm.position.copy(deltaWorld(rig.right.shoulder, rig.hip, width));
    torso.add(leftUpperArm, rightUpperArm);
    leftForearm.position.copy(deltaWorld(rig.left.elbow, rig.left.shoulder, width));
    rightForearm.position.copy(deltaWorld(rig.right.elbow, rig.right.shoulder, width));
    leftUpperArm.add(leftForearm);
    rightUpperArm.add(rightForearm);
    leftHand.position.copy(deltaWorld(rig.left.wrist, rig.left.elbow, width));
    rightHand.position.copy(deltaWorld(rig.right.wrist, rig.right.elbow, width));
    leftForearm.add(leftHand);
    rightForearm.add(rightHand);

    this.attachPart(coat, rig.lowerBody, rig.hip, width, -8, 'lower-body-artmesh');
    this.attachLimb(
      leftUpperArm,
      rig.left.shoulder,
      rig.left.elbow,
      rig.upperWidth,
      width,
      -7,
      'left-upper-arm-artmesh'
    );
    this.attachLimb(
      rightUpperArm,
      rig.right.shoulder,
      rig.right.elbow,
      rig.upperWidth,
      width,
      -7,
      'right-upper-arm-artmesh'
    );
    this.attachLimb(
      leftForearm,
      rig.left.elbow,
      rig.left.wrist,
      rig.forearmWidth,
      width,
      -6.8,
      'left-forearm-artmesh'
    );
    this.attachLimb(
      rightForearm,
      rig.right.elbow,
      rig.right.wrist,
      rig.forearmWidth,
      width,
      -6.8,
      'right-forearm-artmesh'
    );
    this.attachPart(torso, rig.torso, rig.hip, width, -6, 'torso-artmesh');
    this.attachPart(head, rig.head, rig.headPivot, width, -5.7, 'head-artmesh');
    this.attachLimb(
      leftHand,
      rig.left.wrist,
      rig.left.fingertips,
      rig.handWidth,
      width,
      -5.4,
      'left-hand-artmesh'
    );
    this.attachLimb(
      rightHand,
      rig.right.wrist,
      rig.right.fingertips,
      rig.handWidth,
      width,
      -5.4,
      'right-hand-artmesh'
    );

    return {
      root,
      hips,
      torso,
      head,
      leftUpperArm,
      leftForearm,
      leftHand,
      rightUpperArm,
      rightForearm,
      rightHand,
      coat,
    };
  }

  private attachLimb(
    parent: THREE.Bone,
    start: Point,
    end: Point,
    widths: [number, number],
    width: number,
    renderOrder: number,
    name: string
  ): void {
    const polygon = segmentPolygon(start, end, widths[0], widths[1], 0.025, 0.055);
    this.attachPart(parent, polygon, start, width, renderOrder, name);
  }

  private attachPart(
    parent: THREE.Bone,
    polygon: readonly Point[],
    pivot: Point,
    width: number,
    renderOrder: number,
    name: string
  ): void {
    const geometry = createArtMesh(polygon, pivot, width);
    const outline = new THREE.Mesh(geometry, this.outlineMaterial);
    outline.name = `${name}-outline`;
    outline.scale.setScalar(1.042);
    outline.renderOrder = -20;
    outline.frustumCulled = false;
    outline.visible = false;
    parent.add(outline);
    this.outlineMeshes.push(outline);

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = name;
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    parent.add(mesh);
    this.geometries.push(geometry);
  }

  private timelinePose(elapsed: number, nowMs: number): PuppetPose {
    const idle = idlePose(elapsed, this.heroId, this.idlePhase);
    if (this.gesture === 'idle') return idle;
    const duration = Math.max(1, this.gestureUntil - this.gestureStarted);
    const raw = THREE.MathUtils.clamp((nowMs - this.gestureStarted) / duration, 0, 1);
    const envelope =
      THREE.MathUtils.smoothstep(raw, 0, 0.14) * (1 - THREE.MathUtils.smoothstep(raw, 0.76, 1));
    const target = gestureTarget(this.gesture, elapsed, this.gestureSeed);
    const speech = this.speaking ? 0.5 + Math.sin(elapsed * 6.2 + this.gestureSeed * 8) * 0.5 : 0;
    const pose = blendPose(idle, target, envelope);
    pose.headRoll += Math.sin(elapsed * 4.3 + this.gestureSeed * 5) * 0.018 * speech;
    pose.bodyRoll += Math.sin(elapsed * 3.1 + this.gestureSeed * 11) * 0.01 * speech;
    pose.leftForearm += Math.sin(elapsed * 4.8 + 1.7) * 0.025 * speech;
    pose.rightForearm -= Math.sin(elapsed * 4.6 + 0.4) * 0.025 * speech;
    pose.leftHand += Math.sin(elapsed * 6.4) * 0.035 * speech;
    pose.rightHand -= Math.sin(elapsed * 6.1) * 0.035 * speech;
    pose.speech = speech;
    return clampPose(pose);
  }

  private applyPose(pose: PuppetPose, elapsed: number): void {
    const breath = Math.sin(elapsed * 1.82 + this.heroId.length + this.idlePhase);
    this.bones.hips.position.x = pose.bodyX;
    this.bones.hips.position.y += pose.bodyY - (this.bones.hips.userData.lastBodyY ?? 0);
    this.bones.hips.userData.lastBodyY = pose.bodyY;
    this.bones.torso.rotation.z = pose.bodyRoll;
    this.bones.torso.scale.set(1 + breath * 0.009, 1 + breath * 0.007, 1);
    this.bones.head.position.x += pose.headX - (this.bones.head.userData.lastHeadX ?? 0);
    this.bones.head.position.y += pose.headY - (this.bones.head.userData.lastHeadY ?? 0);
    this.bones.head.userData.lastHeadX = pose.headX;
    this.bones.head.userData.lastHeadY = pose.headY;
    this.bones.head.rotation.z = pose.headRoll;
    this.bones.head.scale.set(1 + pose.speech * 0.002, 1 - pose.speech * 0.0015, 1);
    this.bones.leftUpperArm.rotation.z = pose.leftUpperArm;
    this.bones.leftForearm.rotation.z = pose.leftForearm;
    this.bones.leftHand.rotation.z = pose.leftHand;
    this.bones.rightUpperArm.rotation.z = pose.rightUpperArm;
    this.bones.rightForearm.rotation.z = pose.rightForearm;
    this.bones.rightHand.rotation.z = pose.rightHand;
    this.bones.coat.rotation.z = pose.coatSway + Math.sin(elapsed * 1.3 + this.idlePhase) * 0.004;
    this.skeleton.update();
  }
}

function createPuppetOutlineMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: null },
      uColor: { value: new THREE.Color(0xe8c98d) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float alpha = texture2D(uMap, vUv).a;
        if (alpha < 0.035) discard;
        gl_FragColor = vec4(uColor, 1.0);
      }
    `,
    transparent: false,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function createArtMesh(
  polygon: readonly Point[],
  pivot: Point,
  width: number
): THREE.BufferGeometry {
  const contour = polygon.map((point) => new THREE.Vector2(point.x, point.y));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  const pivotWorld = toWorld(pivot, width);
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const point of polygon) {
    const world = toWorld(point, width);
    positions.push(world.x - pivotWorld.x, world.y - pivotWorld.y, 0);
    uvs.push(point.x, 1 - point.y);
  }
  const indices = triangles.flat();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function segmentPolygon(
  start: Point,
  end: Point,
  startWidth: number,
  endWidth: number,
  extendStart: number,
  extendEnd: number
): readonly Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const a = { x: start.x - ux * extendStart, y: start.y - uy * extendStart };
  const b = { x: end.x + ux * extendEnd, y: end.y + uy * extendEnd };
  return [
    { x: a.x + nx * startWidth * 0.5, y: a.y + ny * startWidth * 0.5 },
    { x: b.x + nx * endWidth * 0.5, y: b.y + ny * endWidth * 0.5 },
    { x: b.x - nx * endWidth * 0.5, y: b.y - ny * endWidth * 0.5 },
    { x: a.x - nx * startWidth * 0.5, y: a.y - ny * startWidth * 0.5 },
  ];
}

function toWorld(point: Point, width: number): THREE.Vector3 {
  return new THREE.Vector3((point.x - 0.5) * width, (1 - point.y) * PUPPET_HEIGHT, 0);
}

function deltaWorld(point: Point, origin: Point, width: number): THREE.Vector3 {
  return toWorld(point, width).sub(toWorld(origin, width));
}

function idlePose(elapsed: number, heroId: HeroId, idlePhase: number): PuppetPose {
  const heroOffset = heroId.length + idlePhase;
  const breath = Math.sin(elapsed * 1.1 + heroOffset);
  const rest = CHARACTER_REST[heroId];
  return {
    bodyX: Math.sin(elapsed * 0.58 + heroOffset) * 0.006,
    bodyY: breath * 0.011,
    bodyRoll: rest.bodyRoll + Math.sin(elapsed * 0.66 + heroOffset) * 0.006,
    headX: 0,
    headY: 0,
    headRoll: rest.headRoll + Math.sin(elapsed * 0.92 + heroOffset) * 0.012,
    leftUpperArm: rest.leftUpperArm + Math.sin(elapsed * 0.72 + idlePhase) * 0.008,
    leftForearm: rest.leftForearm + Math.sin(elapsed * 0.81 + idlePhase) * 0.01,
    leftHand: rest.leftHand,
    rightUpperArm: rest.rightUpperArm - Math.sin(elapsed * 0.75 + idlePhase) * 0.008,
    rightForearm: rest.rightForearm - Math.sin(elapsed * 0.84 + idlePhase) * 0.01,
    rightHand: rest.rightHand,
    coatSway: Math.sin(elapsed * 0.55 + heroOffset) * 0.006,
    speech: 0,
  };
}

function gestureTarget(gesture: PuppetGesture, elapsed: number, seed: number): PuppetPose {
  const beat = Math.sin(elapsed * (4.8 + seed));
  const poses: Record<Exclude<PuppetGesture, 'idle'>, PuppetPose> = {
    greeting: pose({
      rightUpperArm: -0.55,
      rightForearm: -0.28 + beat * 0.16,
      rightHand: beat * 0.12,
      headRoll: -0.035,
    }),
    praise: pose({
      leftUpperArm: 0.76,
      leftForearm: 0.18,
      rightUpperArm: -0.76,
      rightForearm: -0.18,
      headY: 0.018,
    }),
    thanks: pose({
      leftUpperArm: 0.88,
      leftForearm: 0.62,
      rightUpperArm: -0.88,
      rightForearm: -0.62,
      headRoll: 0.04,
      bodyRoll: -0.02,
    }),
    wow: pose({
      leftUpperArm: 0.72,
      leftForearm: 0.15,
      rightUpperArm: -0.72,
      rightForearm: -0.15,
      headY: 0.025,
    }),
    threat: pose({
      leftUpperArm: 0.82,
      leftForearm: 0.2,
      rightUpperArm: -0.7,
      rightForearm: -0.12,
      headRoll: -0.03,
      bodyRoll: 0.04,
    }),
    taunt: pose({
      leftUpperArm: 0.78 + beat * 0.04,
      leftForearm: 0.54,
      rightUpperArm: -0.78 - beat * 0.04,
      rightForearm: -0.54,
      headRoll: 0.05,
      bodyRoll: -0.03,
    }),
  };
  return gesture === 'idle' ? pose({}) : poses[gesture];
}

function pose(overrides: Partial<PuppetPose>): PuppetPose {
  return {
    bodyX: 0,
    bodyY: 0,
    bodyRoll: 0,
    headX: 0,
    headY: 0,
    headRoll: 0,
    leftUpperArm: REST_LEFT_UPPER,
    leftForearm: REST_LEFT_FOREARM,
    leftHand: -0.08,
    rightUpperArm: REST_RIGHT_UPPER,
    rightForearm: REST_RIGHT_FOREARM,
    rightHand: 0.08,
    coatSway: 0,
    speech: 1,
    ...overrides,
  };
}

function clampPose(value: PuppetPose): PuppetPose {
  return {
    ...value,
    bodyRoll: THREE.MathUtils.clamp(value.bodyRoll, -0.08, 0.08),
    headRoll: THREE.MathUtils.clamp(value.headRoll, -0.12, 0.12),
    leftUpperArm: THREE.MathUtils.clamp(value.leftUpperArm, 0.48, 1.18),
    leftForearm: THREE.MathUtils.clamp(value.leftForearm, 0.04, 0.72),
    rightUpperArm: THREE.MathUtils.clamp(value.rightUpperArm, -1.18, -0.48),
    rightForearm: THREE.MathUtils.clamp(value.rightForearm, -0.72, -0.04),
  };
}

function blendPose(from: PuppetPose, to: PuppetPose, amount: number): PuppetPose {
  const next = {} as PuppetPose;
  for (const key of Object.keys(from) as Array<keyof PuppetPose>) {
    next[key] = THREE.MathUtils.lerp(from[key], to[key], amount);
  }
  return next;
}

function loadModernTexture(basePath: string, assign: (texture: THREE.Texture) => void): void {
  const cached = textureCache.get(basePath);
  if (cached) {
    assign(cached);
    return;
  }
  const pending = textureWaiters.get(basePath);
  if (pending) {
    pending.push(assign);
    return;
  }
  textureWaiters.set(basePath, [assign]);
  const loader = new THREE.TextureLoader();
  const configure = (texture: THREE.Texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    textureCache.set(basePath, texture);
    for (const waiter of textureWaiters.get(basePath) ?? []) waiter(texture);
    textureWaiters.delete(basePath);
  };
  loader.load(assetUrl(`${basePath}.avif`), configure, undefined, () =>
    loader.load(assetUrl(`${basePath}.webp`), configure)
  );
}

function isGesture(value: string): value is Exclude<PuppetGesture, 'idle'> {
  return ['greeting', 'praise', 'thanks', 'wow', 'threat', 'taunt'].includes(value);
}
