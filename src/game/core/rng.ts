/** 可复现的确定性随机数（mulberry32）。同一 seed 必产出同一序列。 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** 返回 [0, 1) 的浮点数 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 返回 [0, n) 的整数 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Fisher-Yates 洗牌（就地） */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j]!;
      arr[j] = tmp!;
    }
    return arr;
  }

  toJSON() {
    return { s: this.s };
  }
}
