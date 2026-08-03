export interface SfxClipEnvelopeOptions {
  durationMs?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
}

export interface ResolvedSfxClipEnvelope {
  durationMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  fadeOutStartMs: number;
}

/** Clamp a requested one-shot envelope to the decoded asset duration. */
export function resolveSfxClipEnvelope(
  bufferDurationMs: number,
  options: SfxClipEnvelopeOptions = {}
): ResolvedSfxClipEnvelope {
  const available = finitePositive(bufferDurationMs, 1);
  const durationMs = Math.min(available, finitePositive(options.durationMs, available));
  let fadeInMs = Math.min(durationMs, finiteNonNegative(options.fadeInMs, 35));
  let fadeOutMs = Math.min(durationMs, finiteNonNegative(options.fadeOutMs, 180));
  const fadeTotal = fadeInMs + fadeOutMs;
  if (fadeTotal > durationMs && fadeTotal > 0) {
    const scale = durationMs / fadeTotal;
    fadeInMs *= scale;
    fadeOutMs *= scale;
  }
  return {
    durationMs,
    fadeInMs,
    fadeOutMs,
    fadeOutStartMs: durationMs - fadeOutMs,
  };
}

/** Pure envelope sampler used by tests and visual/audio diagnostics. */
export function sfxClipEnvelopeGainAt(
  elapsedMs: number,
  envelope: ResolvedSfxClipEnvelope
): number {
  if (elapsedMs < 0 || elapsedMs >= envelope.durationMs) return 0;
  if (envelope.fadeInMs > 0 && elapsedMs < envelope.fadeInMs) {
    return elapsedMs / envelope.fadeInMs;
  }
  if (envelope.fadeOutMs > 0 && elapsedMs > envelope.fadeOutStartMs) {
    return (envelope.durationMs - elapsedMs) / envelope.fadeOutMs;
  }
  return 1;
}

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}
