import { describe, expect, it } from 'bun:test';
import {
  HAND_LAYOUT_STAGGER_MS,
  HAND_LAYOUT_TRAVEL_MS,
  handLayoutTransitionDurationMs,
} from '../../src/ui/scene/HandRenderer';

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
});
