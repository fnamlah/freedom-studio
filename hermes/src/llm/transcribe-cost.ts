/**
 * The pure half of voice transcription — split from `transcribe.ts` for the
 * same reason `recovery.ts` and `history.ts` are pure modules: the fetch half
 * imports `env`, which validates at import time, and a cost function worth
 * testing has to live where a test can import it without an environment.
 */

/**
 * Long enough for any real instruction, short enough that the 15s HTTP
 * timeout and the per-minute bill stay sane. A three-minute voice note is a
 * podcast, not a bookkeeping instruction.
 */
export const MAX_VOICE_SECONDS = 180;

/** Deliberate slight over-estimate; the cap maths must never undercount. */
export const TRANSCRIBE_USD_PER_MINUTE = 0.003;

/** What one voice note costs, by its declared duration. */
export function transcriptionCostUsd(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return (durationSec / 60) * TRANSCRIBE_USD_PER_MINUTE;
}
