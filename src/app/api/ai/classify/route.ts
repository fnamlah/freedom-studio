/**
 * POST /api/ai/classify — the client-driven batch classifier (docs/12 §4.4).
 *
 * SERVER-ONLY route handler. `/api/*` is never redirected by the middleware, so
 * this route guards itself: Super Admin + Manager, AAL2, active — enforced by
 * `guardedAdminClient()` (which also hands back the service-role client the
 * metering + budget windows need) plus the caller's own RLS-scoped client used
 * for every read/write against `library_files` and the `library` bucket.
 *
 * Body contract (spoken by `@/components/library/library-meta` → `runClassify`):
 *   - `{}`            → take the next batch of up to `ai.classify.batch_size`
 *                       pending, non-exempt files.
 *   - `{ file_id }`   → classify that one pending file.
 *
 * Per file it calls `classifyFile` (the ONLY path a file's contents may cross a
 * provider, docs/12 §6) and maps the result onto `library_files`:
 *   - `suggested` → ai_status='suggested' + ai_suggested_category_id +
 *                   ai_confidence + ai_rationale + classified_at +
 *                   classified_provider; one `ai.classify` audit + one
 *                   `ai_usage(request_kind='classify')` metering row.
 *   - `failed`    → ai_status='failed'; when a provider crossing occurred
 *                   (a `provider` is present on the result) it too is audited
 *                   and metered — a crossing is a crossing (docs/12 §6 clauses 4-5).
 *   - `skipped`   → ai_status='skipped'; nothing crossed, so nothing is metered.
 *
 * Returns `{ done, remaining }` (remaining = pending non-exempt files left after
 * this call). When the active provider has no key the whole surface degrades to
 * `200 { configured:false }` rather than erroring or marking files failed.
 */

import { z } from "zod";

import { classifyFile, type ClassifySuggestion } from "@/lib/ai/classify";
import { checkBudget, recordUsage } from "@/lib/ai/budget";
import { getActiveProviderId, getChatModel, isAiConfigured } from "@/lib/ai/provider";
import { writeAudit } from "@/lib/audit";
import { guardedAdminClient, isAuthzError } from "@/lib/supabase/admin";
import { createRouteSupabase } from "@/lib/supabase/server";
import { getSetting } from "@/lib/settings";
import type { AiSupabaseClient } from "@/lib/ai/types";
import type { LibraryFileRow, TablesUpdate } from "@/lib/database.types";

// `unpdf` + `node:Buffer` in the extract path require the Node.js runtime, and
// the caller's session must be read fresh on every request.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_MAX_FILE_MB = 10;

const bodySchema = z
  .object({ file_id: z.string().uuid().optional() })
  .strict()
  .partial();

/** What `applyResult` reports back to the batch loop. */
type ApplyOutcome = "written" | "not_configured";

export async function POST(request: Request): Promise<Response> {
  // 1. Guard + acquire clients. `guardedAdminClient` is the sanctioned path to
  //    the service client (metering + the GLOBAL budget window need it) and
  //    doubles as the SA/MGR role gate; the caller's RLS client does the reads.
  let admin: AiSupabaseClient;
  let userId: string;
  try {
    const ctx = await guardedAdminClient(["super_admin", "manager"]);
    admin = ctx.admin;
    userId = ctx.user.id;
  } catch (e) {
    if (isAuthzError(e)) {
      return Response.json(e.toResponseBody(), { status: e.status });
    }
    throw e;
  }
  const supabase = await createRouteSupabase();

  // 2. Parse the body. `{}` = next batch; `{ file_id }` = one file.
  let raw: unknown = {};
  try {
    const text = await request.text();
    raw = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const fileId = parsed.data.file_id;

  // 3. Graceful not-configured: no key → no crossing, no failed rows. The client
  //    reads `configured:false` and shows the not-configured state (docs/11 §1).
  if (!(await isAiConfigured())) {
    return Response.json({ configured: false }, { status: 200 });
  }

  // 4. Select the working set through the caller's RLS (the partial pending index
  //    of docs/12 §2.2 is exactly this query). Exempt files were marked `skipped`
  //    at upload and are excluded both here and from the `remaining` count.
  const batchSize = clampInt(await getSetting("ai.classify.batch_size", DEFAULT_BATCH_SIZE), 1, 50);
  const files = await selectPending(supabase, fileId, batchSize);

  // Nothing to do — report the queue depth so the client can stop looping.
  if (files.length === 0) {
    return Response.json({ done: 0, remaining: await countRemaining(supabase) }, { status: 200 });
  }

  // 5. Budgets are enforced BEFORE any provider call (docs/11 §8). A refusal is
  //    itself metered so abuse patterns stay visible, then declined.
  const budget = await checkBudget(userId, admin);
  if (!budget.ok) {
    await meterRefusal(userId, admin, budget.status === "rate_limited" ? "rate_limited" : "budget_exceeded");
    return Response.json(
      { error: budget.reason ?? "AI budget reached. Try again later." },
      { status: 429 },
    );
  }

  // 6. Classify each file, persist its outcome, and audit + meter every crossing.
  const maxFileMb = clampInt(await getSetting("ai.classify.max_file_mb", DEFAULT_MAX_FILE_MB), 1, 500);
  const settings: Record<string, unknown> = { "ai.classify.max_file_mb": maxFileMb };

  let done = 0;
  let hitNotConfigured = false;
  for (const file of files) {
    const suggestion = await classifyFile({ file, supabase, settings });
    const outcome = await applyResult(file, suggestion, supabase, admin, userId);
    if (outcome === "not_configured") {
      // A race: the key vanished mid-batch. Leave the file pending and stop.
      hitNotConfigured = true;
      break;
    }
    done += 1;
  }

  // If the very first crossing found no key, present the graceful state.
  if (hitNotConfigured && done === 0) {
    return Response.json({ configured: false }, { status: 200 });
  }

  return Response.json({ done, remaining: await countRemaining(supabase) }, { status: 200 });
}

/* ------------------------------------------------------------------ helpers */

/** Load the full row(s) to classify: one pending file by id, or the next batch. */
async function selectPending(
  supabase: AiSupabaseClient,
  fileId: string | undefined,
  batchSize: number,
): Promise<LibraryFileRow[]> {
  if (fileId) {
    const { data } = await supabase
      .from("library_files")
      .select("*")
      .eq("id", fileId)
      .maybeSingle();
    // Only pending, non-exempt files are eligible — anything else is a no-op.
    if (!data || data.ai_status !== "pending" || data.ai_exempt) return [];
    return [data];
  }

  const { data } = await supabase
    .from("library_files")
    .select("*")
    .eq("ai_status", "pending")
    .eq("ai_exempt", false)
    .order("created_at", { ascending: true })
    .limit(batchSize);
  return data ?? [];
}

/** Count of pending, non-exempt files still queued after this call. */
async function countRemaining(supabase: AiSupabaseClient): Promise<number> {
  const { count } = await supabase
    .from("library_files")
    .select("id", { count: "exact", head: true })
    .eq("ai_status", "pending")
    .eq("ai_exempt", false);
  return count ?? 0;
}

/**
 * Persist one classification outcome and — for every provider crossing only —
 * write the `ai.classify` audit and the `ai_usage` metering row (docs/12 §6).
 * A crossing is identified structurally: `suggested` always crossed, and a
 * `failed` result carries a `provider` iff the request reached the provider.
 * `skipped` and `not_configured` never crossed.
 */
async function applyResult(
  file: LibraryFileRow,
  suggestion: ClassifySuggestion,
  supabase: AiSupabaseClient,
  admin: AiSupabaseClient,
  userId: string,
): Promise<ApplyOutcome> {
  const now = new Date().toISOString();

  if (suggestion.status === "suggested") {
    const update: TablesUpdate<"library_files"> = {
      ai_status: "suggested",
      ai_suggested_category_id: suggestion.categoryId,
      ai_confidence: suggestion.confidence,
      ai_rationale: suggestion.rationale,
      classified_at: now,
      classified_provider: suggestion.provider,
    };
    await supabase.from("library_files").update(update).eq("id", file.id);

    await writeAudit({
      action: "ai.classify",
      entityType: "library_file",
      entityId: file.id,
      metadata: {
        outcome: "suggested",
        provider: suggestion.provider,
        model: suggestion.model,
        mime_type: file.mime_type,
        size_bytes: file.size_bytes,
        category_slug: suggestion.categorySlug,
        confidence: suggestion.confidence,
      },
    });
    await recordUsage(
      {
        userId,
        requestKind: "classify",
        provider: suggestion.provider,
        model: suggestion.model,
        promptTokens: suggestion.usage.promptTokens,
        completionTokens: suggestion.usage.completionTokens,
        status: "ok",
      },
      admin,
    );
    return "written";
  }

  if (suggestion.status === "skipped") {
    // Nothing crossed — just record the terminal state (docs/12 §4.3). The
    // `library.categorize` trigger notes the ai_status change on its own.
    const update: TablesUpdate<"library_files"> = { ai_status: "skipped", classified_at: now };
    await supabase.from("library_files").update(update).eq("id", file.id);
    return "written";
  }

  // status === "failed"
  if (suggestion.reason === "not_configured") {
    // The provider key is absent — degrade gracefully; do not burn the file.
    return "not_configured";
  }

  const update: TablesUpdate<"library_files"> = {
    ai_status: "failed",
    classified_at: now,
    classified_provider: suggestion.provider ?? null,
  };
  await supabase.from("library_files").update(update).eq("id", file.id);

  // A crossing occurred iff the provider was actually reached (docs/12 §6).
  // download_failed / extract_failed never left the system → no audit, no meter.
  if (suggestion.provider) {
    await writeAudit({
      action: "ai.classify",
      entityType: "library_file",
      entityId: file.id,
      metadata: {
        outcome: "failed",
        reason: suggestion.reason,
        provider: suggestion.provider,
        model: suggestion.model,
        mime_type: file.mime_type,
        size_bytes: file.size_bytes,
      },
    });
    await recordUsage(
      {
        userId,
        requestKind: "classify",
        provider: suggestion.provider,
        model: suggestion.model ?? "unknown",
        promptTokens: suggestion.usage?.promptTokens ?? 0,
        completionTokens: suggestion.usage?.completionTokens ?? 0,
        status: "error",
      },
      admin,
    );
  }
  return "written";
}

/** Meter a budget refusal (docs/11 §8) — refusals are visible spend telemetry. */
async function meterRefusal(
  userId: string,
  admin: AiSupabaseClient,
  status: "rate_limited" | "budget_exceeded",
): Promise<void> {
  try {
    const provider = await getActiveProviderId();
    // Safe here: we only reach this after `isAiConfigured()` returned true.
    const model = await getChatModel();
    await recordUsage(
      { userId, requestKind: "classify", provider, model, promptTokens: 0, completionTokens: 0, status },
      admin,
    );
  } catch {
    /* metering is best-effort; never fail the refusal on a metering hiccup */
  }
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : min;
  return Math.max(min, Math.min(max, n));
}
