import { expect, test } from 'bun:test';

import {
  assertBattleUiIntegrity,
  BattleUiIntegrityError,
  scheduleBattleUiIntegrity,
} from '../../src/ui/dev/BattleUiIntegrity';

interface FakeElementOptions {
  classes?: string[];
  width?: number;
  height?: number;
  parent?: FakeElement;
}

class FakeElement {
  readonly classes: Set<string>;
  readonly width: number;
  readonly height: number;
  readonly parentElement?: FakeElement;

  constructor(options: FakeElementOptions = {}) {
    this.classes = new Set(options.classes ?? []);
    this.width = options.width ?? 0;
    this.height = options.height ?? 0;
    this.parentElement = options.parent;
  }

  closest(selector: string): FakeElement | null {
    const className = selector.startsWith('.') ? selector.slice(1) : selector;
    let current: FakeElement | undefined = this;
    while (current) {
      if (current.classes.has(className)) return current;
      current = current.parentElement;
    }
    return null;
  }

  getBoundingClientRect(): DOMRect {
    return rect(this.width, this.height);
  }
}

class FakeRoot {
  constructor(
    private readonly matches: Record<string, FakeElement[]>,
    private readonly width = 1280,
    private readonly height = 720
  ) {}

  querySelectorAll(selector: string): FakeElement[] {
    return this.matches[selector] ?? [];
  }

  getBoundingClientRect(): DOMRect {
    return rect(this.width, this.height);
  }
}

test('完整战斗 UI 通过结构和尺寸断言', () => {
  const wrap = new FakeElement({ classes: ['seat-portrait-wrap'], width: 32, height: 32 });
  const portrait = new FakeElement({
    classes: ['seat-hero-portrait'],
    width: 32,
    height: 32,
    parent: wrap,
  });
  const root = fakeRoot({
    '.battle-canvas > canvas': [new FakeElement()],
    '.action-bar': [new FakeElement()],
    '.action-bar .action-btn': [new FakeElement()],
    '.seat-hero-portrait': [portrait],
  });

  expect(assertBattleUiIntegrity(root, { enabled: true })).toEqual([]);
});

test('检测头像层级、异常尺寸和重复控制器', () => {
  const wrap = new FakeElement({ classes: ['seat-portrait-wrap'], width: 32, height: 32 });
  const oversized = new FakeElement({
    classes: ['seat-hero-portrait'],
    width: 700,
    height: 500,
    parent: wrap,
  });
  const orphan = new FakeElement({ classes: ['seat-hero-portrait'], width: 32, height: 32 });
  const root = fakeRoot({
    '.battle-canvas > canvas': [new FakeElement(), new FakeElement()],
    '.action-bar': [],
    '.action-bar .action-btn': [new FakeElement(), new FakeElement()],
    '.seat-hero-portrait': [oversized, orphan],
  });

  expect(() => assertBattleUiIntegrity(root, { enabled: true })).toThrow(BattleUiIntegrityError);
  try {
    assertBattleUiIntegrity(root, { enabled: true });
  } catch (error) {
    expect(error).toBeInstanceOf(BattleUiIntegrityError);
    const codes = (error as BattleUiIntegrityError).issues.map((issue) => issue.code);
    expect(codes).toContain('battle-canvas-count');
    expect(codes).toContain('action-bar-count');
    expect(codes).toContain('action-control-count');
    expect(codes).toContain('portrait-outside-wrap');
    expect(codes).toContain('portrait-oversize-container');
    expect(codes).toContain('portrait-oversize-viewport');
  }
});

test('显式关闭时 assert 与 schedule 都是 no-op', async () => {
  const invalidRoot = fakeRoot({});
  expect(assertBattleUiIntegrity(invalidRoot, { enabled: false })).toEqual([]);
  const cancel = scheduleBattleUiIntegrity(invalidRoot, { enabled: false });
  cancel();
  await Promise.resolve();
});

test('schedule 等待指定帧数并回传完整性错误', async () => {
  const root = fakeRoot({});
  const errors: BattleUiIntegrityError[] = [];
  scheduleBattleUiIntegrity(root, {
    enabled: true,
    frames: 0,
    onError: (error) => errors.push(error),
  });
  await Promise.resolve();
  expect(errors).toHaveLength(1);
  expect(errors[0]!.issues.map((issue) => issue.code)).toContain('battle-canvas-count');
});

function fakeRoot(matches: Record<string, FakeElement[]>): ParentNode {
  return new FakeRoot(matches) as unknown as ParentNode;
}

function rect(width: number, height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
}
