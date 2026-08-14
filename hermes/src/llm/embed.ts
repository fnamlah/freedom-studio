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
  const provider = (await readSetting("ai.embedding.provider")) ?? "openai";
  const model = (await readSetting("ai.embedding.model")) ?? "text-embedding-3-large";

  const key =
    provider === "openai"
      ? env.OPENAI_API_KEY
      : provider === "zhipu"
        ? env.ZHIPU_API_KEY
        : env.MOONSHOT_API_KEY;
  const baseUrl =
    provider === "openai"
      ? env.OPENAI_BASE_URL
      : provider === "zhipu"
        ? env.ZHIPU_BASE_URL
        : env.MOONSHOT_BASE_URL;
  if (!key) {
    throw new EmbeddingNotConfiguredError(
      `semantic search needs the ${provider.toUpperCase()}_API_KEY, which is not set on this worker`,
    );
  }

  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      input: [scrubbedText.slice(0, 2000)],
      // The studio's column is vector(2048); OpenAI's text-embedding-3-*
      // models shorten to order. The APP's reindex pins the same number
      // (openai adapter, embedDimensions) — the two sides must always embed
      // into the same space or search returns geometry noise.
      ...(provider === "openai" ? { dimensions: 2048 } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // z.ai's international platform sells NO embeddings product at all as of
    // 2026-08 (their docs list zero embedding models; "Unknown Model" 1211 is
    // what the configured default hits). That is a CONFIGURATION state, not a
    // transient failure — say so, or the person hears a bare 400 and files a
    // bug against a service that is working exactly as (not) sold.
    const body = await res.text().catch(() => "");
    if (res.status === 400 && /1211|Unknown Model/i.test(body)) {
      throw new EmbeddingNotConfiguredError(
        `the ${provider} platform does not offer the "${model}" embedding model — semantic search needs an embeddings vendor set up`,
      );
    }
    throw new Error(`embedding request failed: ${res.status}`);
  }
  const json = (await res.json()) as { data?: { embedding?: number[] }[] };
  const vec = json.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error("embedding response carried no vector");
  }
  return vec;
}

/**
 * Embed ONE document's metadata right after a Telegram upload, so the new
 * document is searchable without waiting for a portal reindex that (today)
 * has no button anywhere.
 *
 * The content string is BYTE-IDENTICAL to the app's reindex builder
 * (src/lib/ai/embeddings.ts, document_meta branch: Title/Type/Issued/Expires,
 * scrubbed) and the upsert key is the app's own
 * (source_type,source_id,embedding_model) — so if the strings ever drift, a
 * later reindex simply re-embeds on hash mismatch into the same row. Metadata
 * ONLY, per docs/11 §6.1: never file contents, storage_path, or file_name.
 *
 * Callers treat failure as a shrug: the document is saved either way; the
 * index is a bonus.
 */
export async function embedDocumentMeta(doc: {
  id: string;
  title: string;
  doc_type: string;
  issued_date?: string | null;
  expires_at?: string | null;
  model_id: string;
}): Promise<void> {
  const { scrubText } = await import("./redact.js");
  const { createHash } = await import("node:crypto");
  const { getAdminClient } = await import("../lib/supabase.js");

  const content = scrubText(
    [
      `Title: ${doc.title}`,
      `Type: ${doc.doc_type}`,
      doc.issued_date ? `Issued: ${doc.issued_date}` : "",
      doc.expires_at ? `Expires: ${doc.expires_at}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const vector = await embedQuery(content);
  const model = (await readSetting("ai.embedding.model")) ?? "text-embedding-3-large";

  const { error } = await getAdminClient()
    .from("embeddings")
    .upsert(
      {
        source_type: "document_meta",
        source_id: doc.id,
        model_id: doc.model_id,
        operator_id: null,
        content,
        content_hash: createHash("sha256").update(content).digest("hex"),
        embedding: `[${vector.join(",")}]`,
        embedding_model: model,
      },
      { onConflict: "source_type,source_id,embedding_model" },
    );
  if (error) throw new Error(`embed upsert failed: ${error.message}`);
}
