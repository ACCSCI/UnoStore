import { describe, expect, it } from 'bun:test';
import {
  advanceHandLayoutTimelineMs,
  HAND_LAYOUT_STAGGER_MS,
  HAND_LAYOUT_TRAVEL_MS,
  handCardLayoutProgress,
  handLayoutTransitionDurationMs,
} from '../../src/ui/scene/HandRenderer';
import { deckVisualNeedsRefresh } from '../../src/ui/scene/TableCenter';

describe('hand collapse and expand timing', () => {
  it('uses the base travel duration for zero or one card', () => {
    expect(handLayoutTransitionDurationMs(0)).toBe(HAND_LAYOUT_TRAVEL_MS);
    expect(handLayoutTransitionDurationMs(1)).toBe(HAND_LAYOUT_TRAVEL_MS);
  });

  it('adds one stagger interval for every additional card', () => {
    expect(handLayoutTransitionDurationMs(8)).toBe(
      HAND_LAYOUT_TRAVEL_MS + 7 * HAND_LAYOUT_STAGGER_MS
    );
    expect(handLayoutTransitionDurationMs(16)).toBe(
      HAND_LAYOUT_TRAVEL_MS + 15 * HAND_LAYOUT_STAGGER_MS
    );
  });

  it('sanitizes invalid or fractional counts', () => {
    expect(handLayoutTransitionDurationMs(Number.NaN)).toBe(HAND_LAYOUT_TRAVEL_MS);
    expect(handLayoutTransitionDurationMs(-2)).toBe(HAND_LAYOUT_TRAVEL_MS);
    expect(handLayoutTransitionDurationMs(2.9)).toBe(
      HAND_LAYOUT_TRAVEL_MS + HAND_LAYOUT_STAGGER_MS
    );
  });

  it('reverses from the current timeline position without restarting or jumping', () => {
    const total = handLayoutTransitionDurationMs(8);
    const partlyCollapsed = advanceHandLayoutTimelineMs(0, 190, true, total);
    expect(partlyCollapsed).toBe(190);
    expect(advanceHandLayoutTimelineMs(partlyCollapsed, 55, false, total)).toBe(135);
  });

  it('uses the same staggered card path in both playback directions', () => {
    const timeline = HAND_LAYOUT_STAGGER_MS * 3 + HAND_LAYOUT_TRAVEL_MS / 2;
    expect(handCardLayoutProgress(timeline, 3)).toBe(0.5);
    expect(handCardLayoutProgress(timeline, 4)).toBeLessThan(0.5);
    expect(handCardLayoutProgress(timeline, 2)).toBeGreaterThan(0.5);
  });
});

describe('table deck visual stability', () => {
  it('keeps the loaded top-card mesh when unrelated UI state redraws', () => {
    expect(deckVisualNeedsRefresh(30, 30)).toBe(false);
    expect(deckVisualNeedsRefresh(30, 29)).toBe(true);
    expect(deckVisualNeedsRefresh(0, 1)).toBe(true);
  });
});
