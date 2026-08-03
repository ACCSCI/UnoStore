import * as THREE from 'three';
import type { HeroId } from '../../game/heroes';
import { assetUrl } from '../assets/url';
import { PAPER_PUPPET_BASE_SCALE, PAPER_PUPPET_SOURCE_HEIGHT, PaperPuppet } from './PaperPuppet';
import { seatNearFactor, seatWorldPosition } from './SeatLayout';

const SERVER_WAIT_DURATION = 1.2;
const SERVER_ENTER_DURATION = 3.8;
const SERVER_SETTLE_DURATION = 0.65;
const SERVER_POUR_DURATION = 2.2;
const SERVER_TURN_DURATION = 0.65;
const SERVER_EXIT_DURATION = 3.5;
const SERVER_VISIT_DURATION =
  SERVER_WAIT_DURATION +
  SERVER_ENTER_DURATION +
  SERVER_SETTLE_DURATION +
  SERVER_POUR_DURATION +
  SERVER_TURN_DURATION +
  SERVER_EXIT_DURATION;
/** Every paper actor's real foot point sits this far inside the table rim. */
const PUPPET_FOOT_TUCK_DEPTH = 0.48;
/** The far seating edge is the lower inner wood rim, not the sprite's outer silhouette. */
const FAR_INNER_RIM_INSET = 0.22;
const SERVER_SOURCE_ASPECT = 361 / 1100;
const TABLE_VIEW_LENGTH = Math.hypot(5.45, 7.8);
const TABLE_CAMERA_UP = new THREE.Vector3(0, 7.8 / TABLE_VIEW_LENGTH, -5.45 / TABLE_VIEW_LENGTH);

/** 2.5D tavern stage: full-screen painted plate, layered art-mesh actors and props. */
export class TavernScene {
  readonly root = new THREE.Group();
  readonly architecture = new THREE.Group();
  readonly props = new THREE.Group();
  readonly actors = new THREE.Group();
  readonly lights = new THREE.Group();
  readonly vfx = new THREE.Group();

  private readonly puppets: Array<PaperPuppet | null> = [];
  private readonly particleFields: GpuParticleField[] = [];
  private readonly flameMaterial = createFlameMaterial();
  private readonly server = new THREE.Group();
  private serverMesh: THREE.Mesh | null = null;
  private readonly serverRaycaster = new THREE.Raycaster();
  private readonly serverPointer = new THREE.Vector2();
  // Temporarily keep decorative fire glow, embers, smoke and dust disabled while
  // the neutral art direction is evaluated. The fireplace remains in the plate.
  private readonly atmosphereEffectsEnabled = false;
  private readonly pointerTarget = new THREE.Vector2();
  private readonly pointer = new THREE.Vector2();
  private readonly projectedHudPosition = new THREE.Vector3();
  private readonly puppetFootPosition = new THREE.Vector3();
  private readonly footOcclusionTarget = new THREE.Vector3();
  private readonly cameraUp = new THREE.Vector3();
  private serverPlayerCount = 4;
  private serverSeat = 0;
  private serverVisitElapsed = 0;
  private serverClickReactionUntil = 0;
  private puppetKey = '';

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera
  ) {
    this.root.name = 'layered-tavern-stage';
    this.root.add(this.architecture, this.props, this.actors, this.lights, this.vfx);
    this.scene.add(this.root);
    this.buildServer();
    if (this.atmosphereEffectsEnabled) this.buildFireAndParticles();
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
  }

  syncPuppets(heroIds: readonly HeroId[]): void {
    const nextPlayerCount = THREE.MathUtils.clamp(heroIds.length, 2, 8);
    if (nextPlayerCount !== this.serverPlayerCount) {
      this.serverPlayerCount = nextPlayerCount;
      this.serverSeat %= nextPlayerCount;
      this.serverVisitElapsed = 0;
    }
    const nextKey = heroIds.join('|');
    if (nextKey === this.puppetKey) return;
    this.puppetKey = nextKey;
    for (const puppet of this.puppets) {
      if (!puppet) continue;
      this.actors.remove(puppet.group);
      puppet.dispose();
    }
    this.puppets.length = heroIds.length;
    heroIds.forEach((heroId, seat) => {
      // First-person local seat: hands/cards are visible, never a self puppet.
      if (seat === 0) {
        this.puppets[seat] = null;
        return;
      }
      // Offset every seat's idle clock so duplicate heroes do not breathe in sync.
      const puppet = new PaperPuppet(heroId, seat * 1.137);
      // This is the exact visible-table-outline anchor. Do not offset an actor
      // afterwards or the feet and waist HUD will drift away from the ellipse.
      const position = seatWorldPosition(seat, heroIds.length);
      const nearFactor = seatNearFactor(seat, heroIds.length);
      puppet.group.position.copy(position);
      // A paper actor is a screen-facing billboard, not a 3D board standing in
      // the world. Matching the camera quaternion keeps every seat vertical and
      // avoids the trapezoid skew produced by per-seat lookAt/yaw rotations.
      puppet.group.quaternion.copy(this.camera.quaternion);
      // All outline anchors share the table sprite's camera-facing plane, so
      // perspective cannot supply depth scaling for us. Apply it explicitly:
      // near seats read larger, far seats smaller, without moving either foot.
      const depthScale = paperActorDepthScale(nearFactor, heroIds.length);
      puppet.group.scale.multiplyScalar(depthScale);
      this.alignPuppetFeetToTableRim(puppet, position, nearFactor);
      this.puppets[seat] = puppet;
      this.actors.add(puppet.group);
    });
  }

  playHeroEmote(seat: number, emoteId: string, durationMs = 4200): void {
    this.puppets[seat]?.playGesture(emoteId, durationMs);
  }

  /** Hit-test the painted waiter and return the seat currently being served. */
  hitTestServer(clientX: number, clientY: number, viewport: DOMRect, react = true): number | null {
    if (!(this.server.visible && this.serverMesh) || viewport.width <= 0 || viewport.height <= 0) {
      return null;
    }
    this.serverPointer.set(
      ((clientX - viewport.left) / viewport.width) * 2 - 1,
      -((clientY - viewport.top) / viewport.height) * 2 + 1
    );
    this.camera.updateMatrixWorld(true);
    this.serverRaycaster.setFromCamera(this.serverPointer, this.camera);
    if (this.serverRaycaster.intersectObject(this.serverMesh, false).length === 0) return null;
    if (react) this.serverClickReactionUntil = performance.now() + 560;
    return this.serverSeat;
  }

  getServerWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    this.server.updateWorldMatrix(true, false);
    return this.server.getWorldPosition(target);
  }

  /** Actual action origin: puppet waist for opponents, first-person hand edge locally. */
  getSeatActionWorldPosition(
    seat: number,
    playerCount: number,
    target: THREE.Vector3
  ): THREE.Vector3 {
    const puppet = this.puppets[seat];
    if (puppet) {
      puppet.group.updateWorldMatrix(true, true);
      return puppet.getHudWorldPosition(target);
    }
    if (seat === 0) return target.set(0, 0.62, 3.45);
    return target.copy(seatWorldPosition(seat, playerCount)).add(new THREE.Vector3(0, 1.1, 0));
  }

  getPuppetHudPosition(
    seat: number,
    viewportWidth: number,
    viewportHeight: number
  ): { x: number; y: number } | null {
    const puppet = this.puppets[seat];
    if (!puppet || viewportWidth <= 0 || viewportHeight <= 0) return null;
    this.camera.updateMatrixWorld(true);
    puppet.getHudWorldPosition(this.projectedHudPosition).project(this.camera);
    return {
      x: (this.projectedHudPosition.x * 0.5 + 0.5) * viewportWidth,
      y: (-this.projectedHudPosition.y * 0.5 + 0.5) * viewportHeight,
    };
  }

  update(elapsed: number, delta: number): void {
    this.pointer.lerp(this.pointerTarget, Math.min(1, delta * 3.2));
    this.architecture.position.x = this.pointer.x * -0.18;
    this.architecture.position.y = this.pointer.y * -0.08;
    this.props.position.x = this.pointer.x * -0.34;
    if (this.atmosphereEffectsEnabled) this.flameMaterial.uniforms.uTime!.value = elapsed;
    this.updateServerTour(elapsed, delta);
    for (const field of this.particleFields) field.update(elapsed);
    const now = performance.now();
    for (const puppet of this.puppets) {
      puppet?.update(elapsed, now);
    }
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    for (const puppet of this.puppets) {
      if (!puppet) continue;
      this.actors.remove(puppet.group);
      puppet.dispose();
    }
    this.puppets.length = 0;
    for (const field of this.particleFields) field.dispose();
    this.particleFields.length = 0;
    if (!this.atmosphereEffectsEnabled) this.flameMaterial.dispose();
    this.scene.remove(this.root);
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
  }

  private buildServer(): void {
    const material = new THREE.MeshBasicMaterial({
      transparent: false,
      alphaTest: 0.035,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    loadModernTexture('/assets/images/tavern/server', (texture) => {
      material.map = texture;
      material.needsUpdate = true;
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(
        PAPER_PUPPET_SOURCE_HEIGHT * SERVER_SOURCE_ASPECT,
        PAPER_PUPPET_SOURCE_HEIGHT,
        10,
        20
      ),
      material
    );
    mesh.castShadow = true;
    // The server belongs to the background crowd layer and must never cover a
    // seated opponent's legs or coat tails.
    mesh.renderOrder = -30;
    this.serverMesh = mesh;
    this.server.add(mesh);
    this.server.position.set(5.35, 1.35, -2.5);
    this.server.quaternion.copy(this.camera.quaternion);
    this.server.scale.setScalar(0.64);
    this.server.visible = false;
    this.actors.add(this.server);
  }

  /** Keep every actual foot point at one exact screen-space depth under the rim. */
  private alignPuppetFeetToTableRim(
    puppet: PaperPuppet,
    tableAnchor: THREE.Vector3,
    nearFactor: number
  ): void {
    this.cameraUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
    const innerRimInset = FAR_INNER_RIM_INSET * (1 - nearFactor) ** 1.5;
    this.footOcclusionTarget
      .copy(tableAnchor)
      .addScaledVector(this.cameraUp, -(PUPPET_FOOT_TUCK_DEPTH + innerRimInset));
    puppet.getFootWorldPosition(this.puppetFootPosition);
    const distanceError = this.puppetFootPosition.sub(this.footOcclusionTarget).dot(this.cameraUp);
    // Correct both directions: neither a visible gap nor excessive sinking is
    // allowed, regardless of hero rig, player count or near/far scale.
    puppet.group.position.addScaledVector(this.cameraUp, -distanceError);
  }

  private updateServerTour(elapsed: number, delta: number): void {
    this.serverVisitElapsed += delta;
    while (this.serverVisitElapsed >= SERVER_VISIT_DURATION) {
      this.serverVisitElapsed -= SERVER_VISIT_DURATION;
      this.serverSeat = (this.serverSeat + 1) % this.serverPlayerCount;
    }

    const route = serverRouteForSeat(this.serverSeat, this.serverPlayerCount);
    const visit = this.serverVisitElapsed;
    const enterStart = SERVER_WAIT_DURATION;
    const enterEnd = enterStart + SERVER_ENTER_DURATION;
    const pourStart = enterEnd + SERVER_SETTLE_DURATION;
    const pourEnd = pourStart + SERVER_POUR_DURATION;
    const turnEnd = pourEnd + SERVER_TURN_DURATION;
    const visible = visit >= enterStart;
    this.server.visible = visible;
    if (this.serverMesh) {
      // The local player sits in front of the table, so this one visit must be
      // painted above the foreground rim. Opponent visits remain behind it.
      this.serverMesh.renderOrder = this.serverSeat === 0 ? -1 : -30;
    }

    let travel = 0;
    let directionScale: number = route.side;
    let scaleFactor = route.offscreenScale;
    let walkAmount = 0;
    if (visit < enterEnd) {
      travel = easeInOut((visit - enterStart) / SERVER_ENTER_DURATION);
      scaleFactor = THREE.MathUtils.lerp(route.offscreenScale, route.targetScale, travel);
      walkAmount = 1;
    } else if (visit < pourEnd) {
      travel = 1;
      scaleFactor = route.targetScale;
    } else if (visit < turnEnd) {
      travel = 1;
      scaleFactor = route.targetScale;
      const turnProgress = easeInOut((visit - pourEnd) / SERVER_TURN_DURATION);
      // A continuous horizontal squash makes the direction change read like a
      // paper cut-out being flipped, without a one-frame mirror pop.
      directionScale = route.side * Math.cos(turnProgress * Math.PI);
    } else {
      const exitProgress = easeInOut((visit - turnEnd) / SERVER_EXIT_DURATION);
      travel = 1 - exitProgress;
      directionScale = -route.side;
      scaleFactor = THREE.MathUtils.lerp(route.targetScale, route.offscreenScale, exitProgress);
      walkAmount = 1;
    }

    this.server.position.lerpVectors(route.offscreen, route.target, travel);
    if (walkAmount > 0) this.server.position.y += Math.sin(elapsed * 6.5) * 0.035;
    const serverBreath = Math.sin(elapsed * 1.72 + this.serverSeat * 1.31);
    this.server.scale.set(
      scaleFactor * directionScale * (1 + serverBreath * 0.004),
      scaleFactor * (1 + serverBreath * 0.008),
      scaleFactor
    );
    this.server.quaternion.copy(this.camera.quaternion);
    const clickReaction = THREE.MathUtils.clamp(
      (this.serverClickReactionUntil - performance.now()) / 560,
      0,
      1
    );
    this.server.rotation.z =
      Math.sin(elapsed * 1.4) * 0.012 +
      Math.sin((1 - clickReaction) * Math.PI * 3) * clickReaction * 0.035;
  }

  private buildFireAndParticles(): void {
    const flame = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 1.72, 12, 18), this.flameMaterial);
    flame.position.set(-7.55, 2.8, -8.72);
    this.vfx.add(flame);
    const embers = new GpuParticleField({
      count: 84,
      colorA: 0xffee91,
      colorB: 0xff4d18,
      height: 3.2,
      radius: 0.7,
      size: 4.5,
      opacity: 0.9,
      additive: true,
    });
    embers.points.position.set(-7.55, 1.8, -8.55);
    const smoke = new GpuParticleField({
      count: 54,
      colorA: 0xa18b7a,
      colorB: 0x392d29,
      height: 4.6,
      radius: 0.85,
      size: 14,
      opacity: 0.2,
      additive: false,
    });
    smoke.points.position.set(-7.55, 2.2, -8.5);
    const dust = new GpuParticleField({
      count: 72,
      colorA: 0xffd58b,
      colorB: 0xd99a54,
      height: 5.5,
      radius: 6.5,
      size: 3.5,
      opacity: 0.24,
      additive: true,
    });
    dust.points.position.set(0, 0.5, -5.5);
    this.particleFields.push(embers, smoke, dust);
    this.vfx.add(embers.points, smoke.points, dust.points);
  }

  private onPointerMove = (event: PointerEvent): void => {
    this.pointerTarget.set(
      event.clientX / Math.max(1, window.innerWidth) - 0.5,
      event.clientY / Math.max(1, window.innerHeight) - 0.5
    );
  };
}

interface ParticleOptions {
  count: number;
  colorA: number;
  colorB: number;
  height: number;
  radius: number;
  size: number;
  opacity: number;
  additive: boolean;
}

class GpuParticleField {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  constructor(options: ParticleOptions) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(options.count * 3);
    const phases = new Float32Array(options.count);
    const speeds = new Float32Array(options.count);
    const sizes = new Float32Array(options.count);
    for (let index = 0; index < options.count; index++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * options.radius;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 2] = Math.sin(angle) * radius;
      phases[index] = Math.random();
      speeds[index] = 0.12 + Math.random() * 0.3;
      sizes[index] = options.size * (0.5 + Math.random());
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHeight: { value: options.height },
        uColorA: { value: new THREE.Color(options.colorA) },
        uColorB: { value: new THREE.Color(options.colorB) },
        uOpacity: { value: options.opacity },
      },
      vertexShader: `attribute float aPhase;attribute float aSpeed;attribute float aSize;uniform float uTime;uniform float uHeight;varying float vAge;void main(){float age=fract(uTime*aSpeed+aPhase);vAge=age;vec3 p=position;p.y+=age*uHeight;p.x+=sin(uTime*1.7+aPhase*19.0)*age*.28;vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=aSize*(1.-age*.55)*(240./max(1.,-mv.z));gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform vec3 uColorA;uniform vec3 uColorB;uniform float uOpacity;varying float vAge;void main(){float r=length(gl_PointCoord-.5);float a=smoothstep(.5,.08,r)*sin(vAge*3.14159)*uOpacity;gl_FragColor=vec4(mix(uColorA,uColorB,vAge),a);}`,
      transparent: true,
      depthWrite: false,
      blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
  }
  update(elapsed: number): void {
    this.points.material.uniforms.uTime!.value = elapsed;
  }
  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

function createFlameMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader:
      'uniform float uTime;varying vec2 vUv;void main(){vUv=uv;vec3 p=position;float s=uv.y*uv.y;p.x+=sin(uTime*8.+uv.y*11.)*.12*s;p.y+=sin(uTime*13.+uv.x*8.)*.055*s;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',
    fragmentShader:
      'varying vec2 vUv;void main(){float center=1.-abs(vUv.x-.5)*2.;float taper=smoothstep(0.,.48,center-vUv.y*.44);float base=smoothstep(1.,.05,vUv.y);float a=taper*base;vec3 c=mix(vec3(1.,.12,.01),vec3(1.,.96,.34),1.-vUv.y);gl_FragColor=vec4(c,a*.88);}',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function loadModernTexture(basePath: string, assign: (texture: THREE.Texture) => void): void {
  const loader = new THREE.TextureLoader();
  const configure = (texture: THREE.Texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    assign(texture);
  };
  loader.load(assetUrl(`${basePath}.avif`), configure, undefined, () =>
    loader.load(assetUrl(`${basePath}.webp`), configure)
  );
}

interface ServerRoute {
  side: -1 | 1;
  offscreen: THREE.Vector3;
  target: THREE.Vector3;
  offscreenScale: number;
  targetScale: number;
}

function serverRouteForSeat(seat: number, playerCount: number): ServerRoute {
  const seatPosition = seatWorldPosition(seat, playerCount);
  const nearFactor = seatNearFactor(seat, playerCount);
  const side: -1 | 1 =
    Math.abs(seatPosition.x) < 0.45 ? (seat % 2 === 0 ? 1 : -1) : seatPosition.x > 0 ? 1 : -1;
  // Same source height, base scale and depth curve as a hero paper puppet.
  const heroScale = PAPER_PUPPET_BASE_SCALE * paperActorDepthScale(nearFactor, playerCount);
  const targetScale = seat === 0 ? heroScale * 1.8 : heroScale;
  const innerRimInset = FAR_INNER_RIM_INSET * (1 - nearFactor) ** 1.5;
  const localCameraDown = seat === 0 ? 0.68 + (PAPER_PUPPET_SOURCE_HEIGHT * targetScale) / 2 : 0;
  const footTarget = seatPosition
    .clone()
    .addScaledVector(TABLE_CAMERA_UP, -(PUPPET_FOOT_TUCK_DEPTH + innerRimInset + localCameraDown));
  const target = footTarget.addScaledVector(
    TABLE_CAMERA_UP,
    (PAPER_PUPPET_SOURCE_HEIGHT * targetScale) / 2
  );
  target.x =
    seat === 0 ? side * 4.75 : THREE.MathUtils.clamp(seatPosition.x + side * 0.75, -5.25, 5.25);
  return {
    side,
    target,
    targetScale,
    offscreenScale: targetScale * (seat === 0 ? 0.68 : 0.92),
    offscreen: new THREE.Vector3(side * 7.25, target.y + 0.08, target.z - 0.18),
  };
}

function paperActorDepthScale(nearFactor: number, playerCount: number): number {
  const crowdFactor = THREE.MathUtils.clamp((playerCount - 4) / 4, 0, 1);
  const crowdScale = THREE.MathUtils.lerp(1, 0.84, crowdFactor);
  return THREE.MathUtils.lerp(0.78, 1.06, nearFactor) * crowdScale;
}

function easeInOut(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}
