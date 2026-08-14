import assert from "node:assert/strict";
import test from "node:test";

import { MAX_VOICE_SECONDS, TRANSCRIBE_USD_PER_MINUTE, transcriptionCostUsd } from "./transcribe-cost.js";

test("transcription cost is per-minute, never negative, never NaN", () => {
  assert.equal(transcriptionCostUsd(0), 0);
  assert.equal(transcriptionCostUsd(-5), 0);
  assert.equal(transcriptionCostUsd(Number.NaN), 0);
  assert.equal(transcriptionCostUsd(60), TRANSCRIBE_USD_PER_MINUTE);
  assert.equal(transcriptionCostUsd(30), TRANSCRIBE_USD_PER_MINUTE / 2);
});

test("the voice length cap is bounded — a podcast is not an instruction", () => {
  // Pinned: raising this raises the per-note bill and the HTTP-timeout risk;
  // argue it here, not in a drive-by.
  assert.equal(MAX_VOICE_SECONDS, 180);
  // Worst-case one-note cost stays under a cent.
  assert.ok(transcriptionCostUsd(MAX_VOICE_SECONDS) < 0.01);
});
