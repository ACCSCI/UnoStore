import * as THREE from 'three';

/**
 * 轻量补间引擎（无外部依赖）。
 * 驱动 THREE 对象属性（position/rotation/scale/颜色）的平滑插值。
 * 所有动画在统一 rAF 循环中推进 —— 与规则引擎完全解耦。
 */

export type EaseFn = (t: number) => number;

/** 缓动函数集 */
export const Ease = {
  linear: (t: number) => t,
  quadIn: (t: number) => t * t,
  quadOut: (t: number) => t * (2 - t),
  cubicOut: (t: number) => 1 - (1 - t) ** 3,
  cubicInOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  backOut: (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
} satisfies Record<string, EaseFn>;

interface TweenState {
  target: THREE.Object3D;
  start: Record<string, number>;
  end: Record<string, number>;
  duration: number;
  elapsed: number;
  ease: EaseFn;
  onComplete?: () => void;
  /** 完成时回调一次 */
  done: boolean;
  /** 贝塞尔飞行曲线（fly 模式） */
  curve?: THREE.CubicBezierCurve3;
}

export class Tween {
  private tweens: TweenState[] = [];
  private readonly clock = new THREE.Clock();
  private running = false;

  /** 补间一个对象：props 形如 { 'position.x': 5, 'scale.y': 2 } */
  to(
    target: THREE.Object3D,
    props: Record<string, number>,
    duration: number,
    ease: EaseFn = Ease.cubicOut,
    onComplete?: () => void
  ): this {
    const start: Record<string, number> = {};
    const end: Record<string, number> = {};
    for (const [key, value] of Object.entries(props)) {
      const current = getPathValue(target, key);
      start[key] = current;
      end[key] = value;
    }
    this.tweens.push({ target, start, end, duration, elapsed: 0, ease, onComplete, done: false });
    if (!this.running) {
      this.running = true;
      this.clock.start();
      requestAnimationFrame(this.tick);
    }
    return this;
  }

  /** 沿贝塞尔曲线飞行（出牌轨迹） */
  fly(
    target: THREE.Object3D,
    from: THREE.Vector3,
    via: THREE.Vector3,
    to: THREE.Vector3,
    duration: number,
    ease: EaseFn = Ease.cubicInOut,
    onComplete?: () => void
  ): this {
    target.position.copy(from);
    const state: TweenState = {
      target,
      start: {},
      end: {},
      duration,
      elapsed: 0,
      ease,
      onComplete,
      done: false,
      curve: new THREE.CubicBezierCurve3(from, via, via, to),
    };
    this.tweens.push(state);
    if (!this.running) {
      this.running = true;
      this.clock.start();
      requestAnimationFrame(this.tick);
    }
    return this;
  }

  private tick = (): void => {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    let anyActive = false;
    for (const t of this.tweens) {
      if (t.done) continue;
      anyActive = true;
      t.elapsed += dt;
      const p = Math.min(t.elapsed / t.duration, 1);
      const e = t.ease(p);
      if (t.curve) {
        const pos = t.curve.getPoint(e);
        t.target.position.copy(pos);
      } else {
        for (const [key, start] of Object.entries(t.start)) {
          const diff = t.end[key]! - start;
          setPathValue(t.target, key, start + diff * e);
        }
      }
      if (p >= 1) {
        t.done = true;
        t.onComplete?.();
      }
    }
    if (anyActive) {
      requestAnimationFrame(this.tick);
    } else {
      this.running = false;
      this.tweens = [];
    }
  };
}

/** 读取对象路径值（如 position.x、material.opacity） */
function getPathValue(obj: THREE.Object3D, path: string): number {
  const parts = path.split('.');
  let holder: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    holder = (holder as Record<string, unknown>)[parts[i]!];
    if (holder === undefined) return 0;
  }
  const v = (holder as Record<string, unknown>)[parts[parts.length - 1]!];
  return typeof v === 'number' ? v : 0;
}

/** 写入对象路径值 */
function setPathValue(obj: THREE.Object3D, path: string, value: number): void {
  const parts = path.split('.');
  let holder: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    holder = (holder as Record<string, unknown>)[parts[i]!];
    if (holder === undefined) return;
  }
  (holder as Record<string, unknown>)[parts[parts.length - 1]!] = value;
}
