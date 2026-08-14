import { readSetting } from "../lib/settings.js";
import { env } from "../config/env.js";

/**
 * Speech-to-text for Telegram voice notes, the worker's way.
 *
 * THE EGRESS DECISION, stated where the bytes cross: the audio goes to OpenAI
 * verbatim and pre-scrub — by nature, because there is no such thing as an
 * audio scrubber. The justification is that this is the SENDER'S OWN VOICE,
 * the spoken analogue of the message she would otherwise type, and her typed
 * words already cross to a provider on every turn. What comes back — the
 * transcript — then takes exactly the typed-text path: `scrubText` before the
 * chat provider ever sees it, scrubbed storage in `hermes_messages`. The raw
 * audio reaches OpenAI only, never the chat provider, and never touches disk.
 *
 * This is deliberately NOT a redactor change: `redactor.ts` governs tool
 * results flowing back to a model; this is inbound user content, the same
 * class as the text messages the bot has always accepted.
 *
 * gpt-4o-mini-transcribe over whisper-1: half the price (~$0.003/min), better
 * multilingual accuracy including Russian, same endpoint. Overridable via the
 * `hermes.transcribe_model` app setting.
 */

export class TranscriptionNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionNotConfiguredError";
  }
}

export {
  MAX_VOICE_SECONDS,
  TRANSCRIBE_USD_PER_MINUTE,
  transcriptionCostUsd,
} from "./transcribe-cost.js";

export async function transcribeVoice(
  bytes: Uint8Array,
  opts: { mimeType: string; language?: "ru" | "en" },
): Promise<string> {
  if (!env.OPENAI_API_KEY) {
    throw new TranscriptionNotConfiguredError(
      "voice transcription needs the OPENAI_API_KEY, which is not set on this worker",
    );
  }
  const model = (await readSetting("hermes.transcribe_model")) ?? "gpt-4o-mini-transcribe";

  // The first non-JSON provider call in the worker: /audio/transcriptions is
  // multipart. Node 22's undici sets the boundary from the FormData itself.
  const form = new FormData();
  form.append("model", model);
  // A fresh copy pinned to a plain ArrayBuffer — Blob's typing rejects views
  // over SharedArrayBuffer, and this also detaches us from the download buffer.
  const copy = new Uint8Array(bytes);
  form.append("file", new Blob([copy.buffer as ArrayBuffer], { type: opts.mimeType }), "voice.ogg");
  if (opts.language) form.append("language", opts.language);
  form.append("response_format", "json");

  const res = await fetch(`${env.OPENAI_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`transcription failed: ${res.status}`);
  }
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}
