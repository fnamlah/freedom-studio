/**
 * POST /api/ai/analyse-document — AI analysis of a COMPLIANCE document
 * (migration 014; owner-approved extension of the egress carve-out).
 *
 * SERVER-ONLY. The compliance counterpart of `/api/ai/classify`. Guards itself
 * (Super Admin + Manager, AAL2, active) via `guardedAdminClient()`, which also
 * yields the service-role client the metering + global-budget windows need; the
 * caller's own RLS client reads/writes `documents` and the `model-documents`
 * bucket.
 *
 * Body: `{ document_id }`. The document must have `ai_analysis_opt_in = true`,
 * or `analyseDocument` refuses the crossing (`skipped:not_opted_in`) and nothing
 * leaves the system. Each provider crossing writes one `ai.analyse` audit and
 * one `ai_usage(request_kind='analyse')` metering row (docs/12 §6 clauses 4-5).
 *
 * Degrades to `200 { configured:false }` when the active provider has no key.
 */

import { z } from "zod";

import { analyseDocument, type AnalyseResult } from "@/lib/ai/analyse-document";
import { persistProposal, type DocumentMetaPayload } from "@/lib/extractions";
import { checkBudget, recordUsage } from "@/lib/ai/budget";
import { getActiveProviderId, getChatModel, isAiConfigured } from "@/lib/ai/provider";
import { writeAudit } from "@/lib/audit";
import { guardedAdminClient, isAuthzError } from "@/lib/supabase/admin";
import { createRouteSupabase } from "@/lib/supabase/server";
import { getDict } from "@/lib/i18n/server";
import { getSetting } from "@/lib/settings";
import type { AiSupabaseClient } from "@/lib/ai/types";
import type { DocumentRow, TablesUpdate } from "@/lib/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MAX_FILE_MB = 10;

const bodySchema = z.object({ document_id: z.string().uuid() });

export async function POST(request: Request): Promise<Response> {
  const d = await getDict();
  let admin: AiSupabaseClient;
  let userId: string;
  try {
    const ctx = await guardedAdminClient(["super_admin", "manager"]);
    admin = ctx.admin;
    userId = ctx.user.id;
  } catch (e) {
    if (isAuthzError(e)) return Response.json(e.toResponseBody(), { status: e.status });
    throw e;
  }
  const supabase = await createRouteSupabase();

  let raw: unknown;
  try {
    raw = JSON.parse(await request.text());
  } catch {
    return Response.json({ error: d.aiRuntime.invalidJson }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "document_id is required." }, { status: 400 });

  if (!(await isAiConfigured())) {
    return Response.json({ configured: false }, { status: 200 });
  }

  // Load through the caller's RLS. SA/MGR only — models/finance/operators have
  // no policy on `documents` at all, so this returns nothing for them.
  const { data: document } = await supabase
    .from("documents")
    .select("*")
    .eq("id", parsed.data.document_id)
    .maybeSingle();
  if (!document) return Response.json({ error: d.aiRuntime.documentNotFound }, { status: 404 });

  // The consent gate is also enforced deeper in analyseDocument; failing fast
  // here avoids a needless budget check and a clearer message.
  if (!document.ai_analysis_opt_in) {
    return Response.json(
      { error: d.aiRuntime.notOptedIn },
      { status: 409 },
    );
  }

  const budget = await checkBudget(userId, admin);
  if (!budget.ok) {
    await meterRefusal(userId, admin, budget.status === "rate_limited" ? "rate_limited" : "budget_exceeded");
    return Response.json(
      { error: budget.reason ?? d.aiRuntime.budgetReached },
      { status: 429 },
    );
  }

  const maxFileMb = clampInt(await getSetting("ai.classify.max_file_mb", DEFAULT_MAX_FILE_MB), 1, 500);
  const result = await analyseDocument({ document, supabase, maxFileMb });
  const outcome = await applyResult(document, result, supabase, admin, userId);

  if (outcome === "not_configured") {
    return Response.json({ configured: false }, { status: 200 });
  }
  return Response.json(
    { status: result.status, reason: "reason" in result ? result.reason : undefined },
    { status: 200 },
  );
}

/* ------------------------------------------------------------------ helpers */

type ApplyOutcome = "written" | "not_configured";

async function applyResult(
  document: DocumentRow,
  result: AnalyseResult,
  supabase: AiSupabaseClient,
  admin: AiSupabaseClient,
  userId: string,
): Promise<ApplyOutcome> {
  const now = new Date().toISOString();

  if (result.status === "analysed") {
    const update: TablesUpdate<"documents"> = {
      ai_status: "confirmed",
      ai_summary: result.summary || null,
      ai_key_figures: result.keyFigures.length ? result.keyFigures : null,
      analysed_at: now,
      analysed_provider: result.provider,
    };
    await supabase.from("documents").update(update).eq("id", document.id);

    // Stage what the document says ABOUT ITSELF when it differs from the row —
    // the dates that drive the compliance dashboard, the type, the title. A
    // proposal for `/documents/inbox` (021), applied only by a human; the
    // summary/key-figures write above stays exactly as it was.
    const metaDiff = proposeMetaDiff(document, result);
    if (metaDiff) {
      try {
        await persistProposal(supabase, {
          sourceKind: "document",
          sourceId: document.id,
          kind: "document_meta",
          payload: metaDiff,
          confidence: null,
          provider: result.provider,
          model: result.model,
          userId,
        });
      } catch {
        /* the analysis result stands regardless */
      }
    }

    await writeAudit({
      action: "ai.analyse",
      entityType: "document",
      entityId: document.id,
      metadata: {
        outcome: "analysed",
        provider: result.provider,
        model: result.model,
        key_figure_count: result.keyFigures.length,
        model_id: document.model_id,
        ...(metaDiff ? { meta_fields_proposed: Object.keys(metaDiff.fields) } : {}),
      },
    });
    await recordUsage(
      {
        userId,
        requestKind: "analyse",
        provider: result.provider,
        model: result.model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        status: "ok",
      },
      admin,
    );
    return "written";
  }

  if (result.status === "failed") {
    await supabase.from("documents").update({ ai_status: "failed" }).eq("id", document.id);
    // A `failed` result that reached the provider still crossed — audit + meter it.
    if (result.provider) {
      await writeAudit({
        action: "ai.analyse",
        entityType: "document",
        entityId: document.id,
        metadata: { outcome: "failed", reason: result.reason, provider: result.provider },
      });
      await recordUsage(
        {
          userId,
          requestKind: "analyse",
          provider: result.provider,
          model: result.model ?? (await getChatModel()),
          promptTokens: result.usage?.promptTokens ?? 0,
          completionTokens: result.usage?.completionTokens ?? 0,
          status: "error",
        },
        admin,
      );
    }
    return result.reason === "not_configured" ? "not_configured" : "written";
  }

  // skipped — nothing crossed, nothing metered.
  await supabase.from("documents").update({ ai_status: "skipped" }).eq("id", document.id);
  return "written";
}

/**
 * What the document says about itself, minus what the row already says. Only
 * fields the analyser actually READ (it is told to omit rather than guess) and
 * only where they differ — a proposal that changes nothing is noise. Returns
 * null when there is nothing to propose.
 */
function proposeMetaDiff(
  document: DocumentRow,
  result: Extract<AnalyseResult, { status: "analysed" }>,
): DocumentMetaPayload | null {
  const meta = result.documentMeta;
  const fields: DocumentMetaPayload["fields"] = {};
  if (meta.docType && meta.docType !== document.doc_type) fields.doc_type = meta.docType;
  if (meta.title && meta.title !== document.title) fields.title = meta.title;
  if (meta.issuedDate && meta.issuedDate !== document.issued_date) {
    fields.issued_date = meta.issuedDate;
  }
  if (meta.expiresAt && meta.expiresAt !== document.expires_at) {
    fields.expires_at = meta.expiresAt;
  }
  if (Object.keys(fields).length === 0) return null;
  return {
    fields,
    current: {
      doc_type: document.doc_type,
      title: document.title,
      issued_date: document.issued_date,
      expires_at: document.expires_at,
    },
  };
}

async function meterRefusal(
  userId: string,
  admin: AiSupabaseClient,
  status: "rate_limited" | "budget_exceeded",
): Promise<void> {
  await recordUsage(
    {
      userId,
      requestKind: "analyse",
      provider: await getActiveProviderId(),
      model: await getChatModel(),
      promptTokens: 0,
      completionTokens: 0,
      status,
    },
    admin,
  );
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? Math.round(value) : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
