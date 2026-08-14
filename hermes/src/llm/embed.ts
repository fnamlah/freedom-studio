import { readSetting } from "../lib/settings.js";
import { env } from "../config/env.js";

/**
 * Embed one query string, the worker's way.
 *
 * The app's `embedQuery` cannot be imported here — `embeddings.ts` reaches the
 * app dictionary and provider through extensionless specifiers Node ESM
 * rejects. This is a deliberate, minimal reimplementation of only the QUERY
 * path: same settings (`ai.embedding.provider` / `ai.embedding.model`), same
 * OpenAI-compatible /embeddings call, so a vector produced here is comparable
 * to the vectors the app's reindex stored.
 *
 * The caller scrubs the text BEFORE calling — a query is free text and transits
 * the provider like any prompt.
 */

export class EmbeddingNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingNotConfiguredError";
  }
}

export async function embedQuery(scrubbedText: string): Promise<number[]> {
  const provider = (await readSetting("ai.embedding.provider")) ?? "zhipu";
  const model = (await readSetting("ai.embedding.model")) ?? "embedding-3";

  const key = provider === "zhipu" ? env.ZHIPU_API_KEY : env.MOONSHOT_API_KEY;
  const baseUrl = provider === "zhipu" ? env.ZHIPU_BASE_URL : env.MOONSHOT_BASE_URL;
  if (!key) {
    throw new EmbeddingNotConfiguredError(
      `semantic search needs the ${provider.toUpperCase()}_API_KEY, which is not set on this worker`,
    );
  }

  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, input: [scrubbedText.slice(0, 2000)] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`embedding request failed: ${res.status}`);
  }
  const json = (await res.json()) as { data?: { embedding?: number[] }[] };
  const vec = json.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error("embedding response carried no vector");
  }
  return vec;
}
