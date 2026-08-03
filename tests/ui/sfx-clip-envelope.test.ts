import { describe, expect, test } from 'bun:test';
import { resolveSfxClipEnvelope, sfxClipEnvelopeGainAt } from '../../src/ui/audio/SfxClipEnvelope';

describe('short SFX clip envelope', () => {
  test('caps a long cheer and provides a short fade-in/out', () => {
    const envelope = resolveSfxClipEnvelope(8200, {
      durationMs: 1250,
      fadeInMs: 50,
      fadeOutMs: 250,
    });
    expect(envelope).toEqual({
      durationMs: 1250,
      fadeInMs: 50,
      fadeOutMs: 250,
      fadeOutStartMs: 1000,
    });
    expect(sfxClipEnvelopeGainAt(0, envelope)).toBe(0);
    expect(sfxClipEnvelopeGainAt(25, envelope)).toBeCloseTo(0.5);
    expect(sfxClipEnvelopeGainAt(500, envelope)).toBe(1);
    expect(sfxClipEnvelopeGainAt(1125, envelope)).toBeCloseTo(0.5);
    expect(sfxClipEnvelopeGainAt(1250, envelope)).toBe(0);
  });

  test('scales overlapping fades to fit a very short source', () => {
    const envelope = resolveSfxClipEnvelope(100, { fadeInMs: 80, fadeOutMs: 80 });
    expect(envelope.durationMs).toBe(100);
    expect(envelope.fadeInMs).toBeCloseTo(50);
    expect(envelope.fadeOutMs).toBeCloseTo(50);
    expect(envelope.fadeOutStartMs).toBeCloseTo(50);
  });
});
