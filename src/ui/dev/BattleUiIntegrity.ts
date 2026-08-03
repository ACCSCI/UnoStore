export type BattleUiIntegrityCode =
  | 'portrait-outside-wrap'
  | 'portrait-oversize-container'
  | 'portrait-oversize-viewport'
  | 'battle-canvas-count'
  | 'action-bar-count'
  | 'action-control-count';

export interface BattleUiIntegrityIssue {
  code: BattleUiIntegrityCode;
  message: string;
  element?: Element;
}

export interface BattleUiIntegrityOptions {
  /** Override build mode. Intended for tests; production callers should omit it. */
  enabled?: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface ScheduleBattleUiIntegrityOptions extends BattleUiIntegrityOptions {
  /** Defaults to two frames so CSS layout and the WebGL canvas have settled. */
  frames?: number;
  onError?: (error: BattleUiIntegrityError) => void;
}

export class BattleUiIntegrityError extends Error {
  constructor(readonly issues: readonly BattleUiIntegrityIssue[]) {
    super(
      `Battle UI integrity check failed:\n${issues
        .map((issue) => `- [${issue.code}] ${issue.message}`)
        .join('\n')}`
    );
    this.name = 'BattleUiIntegrityError';
  }
}

/**
 * Throws when the mounted battle UI contains a known structural/layout
 * regression. Vite folds the DEV branch away in production; `enabled: true`
 * exists only so the pure checker can be exercised in tests.
 */
export function assertBattleUiIntegrity(
  root: ParentNode,
  options: BattleUiIntegrityOptions = {}
): readonly BattleUiIntegrityIssue[] {
  if (!integrityChecksEnabled(options.enabled)) return [];
  const issues = collectIssues(root, options);
  if (issues.length > 0) throw new BattleUiIntegrityError(issues);
  return issues;
}

/**
 * Runs the assertion after layout settles. Returns a cancellation function.
 * In production this immediately returns a stable no-op.
 */
export function scheduleBattleUiIntegrity(
  root: ParentNode,
  options: ScheduleBattleUiIntegrityOptions = {}
): () => void {
  if (!integrityChecksEnabled(options.enabled)) return noop;

  let cancelled = false;
  let frameHandle: number | null = null;
  let remainingFrames = Math.max(0, options.frames ?? 2);
  const run = (): void => {
    if (cancelled) return;
    if (remainingFrames > 0) {
      remainingFrames--;
      frameHandle = requestFrame(run);
      return;
    }
    try {
      assertBattleUiIntegrity(root, { ...options, enabled: true });
    } catch (error) {
      if (!(error instanceof BattleUiIntegrityError)) throw error;
      if (options.onError) options.onError(error);
      else console.error(error);
    }
  };
  frameHandle = requestFrame(run);

  return () => {
    cancelled = true;
    if (frameHandle !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameHandle);
    }
  };
}

function collectIssues(
  root: ParentNode,
  options: BattleUiIntegrityOptions
): BattleUiIntegrityIssue[] {
  const issues: BattleUiIntegrityIssue[] = [];
  assertSingleton(root, '.battle-canvas > canvas', 'battle-canvas-count', 'battle canvas', issues);
  assertSingleton(root, '.action-bar', 'action-bar-count', 'action bar', issues);
  assertSingleton(
    root,
    '.action-bar .action-btn',
    'action-control-count',
    'turn action control',
    issues
  );

  const viewportRect = elementRect(root);
  const viewportWidth = options.viewportWidth ?? viewportRect?.width ?? 0;
  const viewportHeight = options.viewportHeight ?? viewportRect?.height ?? 0;
  for (const portrait of root.querySelectorAll<HTMLElement>('.seat-hero-portrait')) {
    const wrap = portrait.closest<HTMLElement>('.seat-portrait-wrap');
    if (!wrap) {
      issues.push({
        code: 'portrait-outside-wrap',
        message: 'A .seat-hero-portrait is not nested inside .seat-portrait-wrap.',
        element: portrait,
      });
      continue;
    }

    const portraitRect = portrait.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    if (
      portraitRect.width > 0 &&
      wrapRect.width > 0 &&
      (portraitRect.width > wrapRect.width + 2 || portraitRect.height > wrapRect.height + 2)
    ) {
      issues.push({
        code: 'portrait-oversize-container',
        message: `Seat portrait ${formatSize(portraitRect)} exceeds its ${formatSize(wrapRect)} wrapper.`,
        element: portrait,
      });
    }
    if (
      portraitRect.width > 0 &&
      viewportWidth > 0 &&
      viewportHeight > 0 &&
      (portraitRect.width > viewportWidth * 0.5 || portraitRect.height > viewportHeight * 0.5)
    ) {
      issues.push({
        code: 'portrait-oversize-viewport',
        message: `Seat portrait ${formatSize(portraitRect)} occupies over half of the ${Math.round(
          viewportWidth
        )}×${Math.round(viewportHeight)} battle viewport.`,
        element: portrait,
      });
    }
  }
  return issues;
}

function assertSingleton(
  root: ParentNode,
  selector: string,
  code: BattleUiIntegrityCode,
  label: string,
  issues: BattleUiIntegrityIssue[]
): void {
  const count = root.querySelectorAll(selector).length;
  if (count === 1) return;
  issues.push({ code, message: `Expected exactly one ${label}; found ${count}.` });
}

function integrityChecksEnabled(override: boolean | undefined): boolean {
  if (override !== undefined) return override;
  return String(import.meta.env.DEV) === 'true';
}

function elementRect(root: ParentNode): DOMRect | null {
  const candidate = root as ParentNode & { getBoundingClientRect?: () => DOMRect };
  return typeof candidate.getBoundingClientRect === 'function'
    ? candidate.getBoundingClientRect()
    : null;
}

function formatSize(rect: Pick<DOMRect, 'width' | 'height'>): string {
  return `${Math.round(rect.width)}×${Math.round(rect.height)}`;
}

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  queueMicrotask(() => callback(performance.now()));
  return -1;
}

function noop(): void {}
