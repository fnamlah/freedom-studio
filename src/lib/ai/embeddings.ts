/**
 * Embedding query + reindex pipeline (docs/11 §6.3).
 *
 * SERVER-ONLY. `embedQuery` scrubs and embeds a single query string (used by the
 * `semantic_search` tool). `reindexEmbeddings` is the SA-triggered indexing job:
 * it builds ALLOWLISTED content per source, scrubs it (docs/11 §5 mechanism 3),
 * embeds via the configured embedding provider, and upserts into `embeddings`
 * keyed on `content_hash` so an unchanged hash skips the re-embed.
 *
 * `embeddings` is service-role-write only (docs/04), so the reindex job takes a
 * SERVICE-CAPABLE client — supplied by the SA route via `guardedAdminClient()` —
 * and never constructs one itself. Every embedded source is chosen to survive
 * the aggregates-only policy BEFORE it is embedded (docs/11 §6.1): note bodies
 * are scrubbed, documents contribute metadata only — never file contents,
 * `storage_path`, or `file_name`.
 */

import { createHash } from "node:crypto";

import type { TablesInsert } from "@/lib/database.types";

import {
  getEmbeddingAdapter,
  getEmbeddingModel,
} from "./provider";
import { scrubText } from "./redactor";
import type { AiSupabaseClient, EmbeddingSource } from "./types";

const ALL_SOURCES: EmbeddingSource[] = [
  "model_note",
  "operator_note",
  "platform",
  "document_meta",
];

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

function contentHash(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

/**
 * Scrub + embed a single query string (docs/11 §6.3, query path). Embedding
 * inputs transit the provider like any prompt, so the query is scrubbed first.
 * @throws {NotConfiguredError} when the embedding provider has no key.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const adapter = await getEmbeddingAdapter();
  const model = await getEmbeddingModel();
  const [vec] = await adapter.embed([scrubText(text)], model);
  return vec ?? [];
}

interface PendingItem {
  source_type: EmbeddingSource;
  source_id: string;
  model_id: string | null;
  operator_id: string | null;
  content: string;
}

export interface ReindexOptions {
  /** SERVICE-CAPABLE client (from `guardedAdminClient(['super_admin'])`). */
  admin: AiSupabaseClient;
  /** Which sources to rebuild; defaults to all four. */
  sources?: EmbeddingSource[];
  /** Embedding batch size; defaults to 32. */
  batchSize?: number;
}

export interface ReindexSourceResult {
  embedded: number;
  skipped: number;
}

export interface ReindexResult {
  embedded: number;
  skipped: number;
  bySource: Record<EmbeddingSource, ReindexSourceResult>;
}

/**
 * Rebuild the embedding index (docs/11 §6.3). Incremental by content hash: an
 * unchanged hash for the same `(source_type, source_id, embedding_model)` skips
 * the re-embed. Callers should audit the run as `ai.reindex` (docs/11 §6.2).
 * @throws {NotConfiguredError} when the embedding provider has no key.
 */
export async function reindexEmbeddings(opts: ReindexOptions): Promise<ReindexResult> {
  const { admin } = opts;
  const model = await getEmbeddingModel(); // throws NotConfiguredError if unusable
  const adapter = await getEmbeddingAdapter();
  const sources = opts.sources ?? ALL_SOURCES;
  const batchSize = opts.batchSize ?? 32;

  const result: ReindexResult = {
    embedded: 0,
    skipped: 0,
    bySource: {
      model_note: { embedded: 0, skipped: 0 },
      operator_note: { embedded: 0, skipped: 0 },
      platform: { embedded: 0, skipped: 0 },
      document_meta: { embedded: 0, skipped: 0 },
    },
  };

  for (const source of sources) {
    const items = await buildItems(admin, source);

    for (const chunk of chunked(items, batchSize)) {
      const toEmbed: PendingItem[] = [];

      for (const item of chunk) {
        const hash = contentHash(item.content);
        const { data: existing } = await admin
          .from("embeddings")
          .select("content_hash")
          .eq("source_type", item.source_type)
          .eq("source_id", item.source_id)
          .eq("embedding_model", model)
          .maybeSingle();

        if (existing && existing.content_hash === hash) {
          result.skipped++;
          result.bySource[source].skipped++;
          continue;
        }
        toEmbed.push(item);
      }

      if (toEmbed.length === 0) continue;

      const vectors = await adapter.embed(
        toEmbed.map((i) => i.content),
        model,
      );

      const rows: TablesInsert<"embeddings">[] = toEmbed.map((item, i) => ({
        source_type: item.source_type,
        source_id: item.source_id,
        model_id: item.model_id,
        operator_id: item.operator_id,
        content: item.content,
        content_hash: contentHash(item.content),
        embedding: toVectorLiteral(vectors[i] ?? []),
        embedding_model: model,
      }));

      const { error } = await admin
        .from("embeddings")
        .upsert(rows, { onConflict: "source_type,source_id,embedding_model" });
      if (error) {
        throw new Error(`embeddings upsert failed: ${error.message}`);
      }

      result.embedded += rows.length;
      result.bySource[source].embedded += rows.length;
    }
  }

  return result;
}

/**
 * Per-source content builders — each selects ONLY allowlisted columns and scrubs
 * free text (docs/11 §6.1). The `model_id`/`operator_id` columns are set so the
 * `embeddings` RLS mirrors source-row visibility for `fn_semantic_search`.
 */
async function buildItems(
  admin: AiSupabaseClient,
  source: EmbeddingSource,
): Promise<PendingItem[]> {
  if (source === "model_note") {
    const { data } = await admin
      .from("models")
      .select("id, stage_name, notes")
      .not("notes", "is", null);
    return (data ?? [])
      .filter((m) => (m.notes ?? "").trim().length > 0)
      .map((m) => ({
        source_type: "model_note" as const,
        source_id: m.id,
        model_id: m.id,
        operator_id: null,
        content: scrubText(`${m.stage_name}\n${m.notes ?? ""}`.trim()),
      }));
  }

  if (source === "operator_note") {
    const { data } = await admin
      .from("operators")
      .select("id, display_name, notes")
      .not("notes", "is", null);
    return (data ?? [])
      .filter((o) => (o.notes ?? "").trim().length > 0)
      .map((o) => ({
        source_type: "operator_note" as const,
        source_id: o.id,
        model_id: null,
        operator_id: o.id,
        content: scrubText(`${o.display_name}\n${o.notes ?? ""}`.trim()),
      }));
  }

  if (source === "platform") {
    const { data } = await admin
      .from("platforms")
      .select("id, name, website_url, is_active");
    return (data ?? []).map((p) => ({
      source_type: "platform" as const,
      source_id: p.id,
      model_id: null,
      operator_id: null,
      content: scrubText(
        `${p.name}\n${p.website_url ?? ""}\nstatus: ${p.is_active ? "active" : "inactive"}`.trim(),
      ),
    }));
  }

  // document_meta — METADATA ONLY (docs/11 §6.1): title, type, dates. NEVER file
  // contents, storage_path, or file_name.
  const { data } = await admin
    .from("documents")
    .select("id, title, doc_type, issued_date, expires_at, model_id")
    .eq("is_archived", false);
  return (data ?? []).map((d) => ({
    source_type: "document_meta" as const,
    source_id: d.id,
    model_id: d.model_id,
    operator_id: null,
    content: scrubText(
      [
        `Title: ${d.title}`,
        `Type: ${d.doc_type}`,
        d.issued_date ? `Issued: ${d.issued_date}` : "",
        d.expires_at ? `Expires: ${d.expires_at}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  }));
}
