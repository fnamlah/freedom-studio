/**
 * The whitelisted tool registry (docs/11 §4) — "runs the db" safely.
 *
 * SERVER-ONLY. Thirteen read-only tools, each a thin 1:1 binding onto a SECURITY
 * INVOKER view/RPC of docs/07. Invariants:
 *   - Caller-context execution: every tool runs against the client passed in,
 *     which MUST be the caller's RLS-scoped client (never service role). Results
 *     are scoped to the asking user by construction (docs/11 §4, [D7]).
 *   - Business names, never UUIDs: parameters take stage/display/platform names;
 *     this module resolves them to ids via the directory views and resolves ids
 *     BACK to names on output, so the model never sees or supplies a UUID.
 *   - Server-side validation: a tool call naming anything outside this registry
 *     is rejected before execution; arguments are zod-parsed.
 *
 * The per-tool allowlist projection that governs what actually crosses to a
 * provider lives in the redactor (`PROJECTIONS`), applied by the agent loop
 * AFTER `execute` returns. This module returns name-resolved rows; it does not
 * itself serialize anything toward a provider.
 */

import { z } from "zod";

import { embedQuery } from "./embeddings";
import type { AiSupabaseClient, EmbeddingSource, Tool } from "./types";

export type ToolName =
  | "earnings_summary"
  | "earnings_monthly"
  | "hours_summary"
  | "payout_summary"
  | "payout_history"
  | "payee_balances"
  | "payee_statement"
  | "split_distribution"
  | "forecast"
  | "forecast_accuracy"
  | "compliance_summary"
  | "semantic_search"
  | "library_search";

type ToolRow = Record<string, unknown>;

export interface AiToolDef {
  name: ToolName;
  description: string;
  /** JSON Schema for the OpenAI `tools` parameters object. */
  jsonSchema: Record<string, unknown>;
  /** Validate + run. Returns name-resolved rows for the redactor to project. */
  execute(rawArgs: unknown, supabase: AiSupabaseClient): Promise<ToolRow[]>;
}

/* --------------------------------------------------------------- helpers */

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD date");
const MONTH = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "expected a YYYY-MM month");

function monthStart(m: string): string {
  return `${m}-01`;
}

/** JSON-schema string helper for a date parameter. */
function dateProp(description: string) {
  return { type: "string", description: `${description} (YYYY-MM-DD)` };
}
function monthProp(description: string) {
  return { type: "string", description: `${description} (YYYY-MM)` };
}

/* --------------------------------------------------- name ⇄ id resolution */

async function resolveModelId(
  sb: AiSupabaseClient,
  stageName: string,
): Promise<string | null> {
  const { data } = await sb
    .from("v_model_directory")
    .select("id, stage_name")
    .ilike("stage_name", stageName)
    .limit(1);
  return data?.[0]?.id ?? null;
}

async function resolveOperatorId(
  sb: AiSupabaseClient,
  displayName: string,
): Promise<string | null> {
  const { data } = await sb
    .from("v_operator_directory")
    .select("id, display_name")
    .ilike("display_name", displayName)
    .limit(1);
  return data?.[0]?.id ?? null;
}

async function resolvePlatformId(
  sb: AiSupabaseClient,
  name: string,
): Promise<string | null> {
  const { data } = await sb
    .from("platforms")
    .select("id, name")
    .ilike("name", name)
    .limit(1);
  return data?.[0]?.id ?? null;
}

/**
 * Escape `%` and `_` so LLM-supplied search terms match literally inside an
 * ilike pattern instead of acting as wildcards. `\` first, or the escapes
 * would themselves be escaped.
 */
function escapeLike(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

async function modelNameMap(sb: AiSupabaseClient): Promise<Map<string, string>> {
  const { data } = await sb.from("v_model_directory").select("id, stage_name");
  const map = new Map<string, string>();
  for (const r of data ?? []) if (r.id) map.set(r.id, r.stage_name ?? "(model)");
  return map;
}

async function platformNameMap(sb: AiSupabaseClient): Promise<Map<string, string>> {
  const { data } = await sb.from("platforms").select("id, name");
  const map = new Map<string, string>();
  for (const r of data ?? []) if (r.id) map.set(r.id, r.name);
  return map;
}

/* ------------------------------------------------------------ the 12 tools */

const earningsSummarySchema = z.object({
  from: DATE,
  to: DATE,
  group_by: z.enum(["model", "platform", "week", "month"]).default("month"),
});

const earningsMonthlySchema = z.object({
  from_month: MONTH,
  to_month: MONTH,
  stage_name: z.string().min(1).optional(),
  platform_name: z.string().min(1).optional(),
});

const hoursSummarySchema = z.object({ from: DATE, to: DATE });

const payoutSummarySchema = z.object({ from: DATE, to: DATE });

const payoutHistorySchema = z.object({
  from: DATE,
  to: DATE,
  status: z.enum(["pending", "approved", "paid", "cancelled"]).optional(),
});

const payeeBalancesSchema = z.object({});

const payeeStatementSchema = z.object({
  payee_type: z.enum(["model", "operator"]),
  display_name: z.string().min(1),
  from: DATE,
  to: DATE,
});

const splitDistributionSchema = z.object({ from_month: MONTH, to_month: MONTH });

const forecastSchema = z.object({
  months_ahead: z.number().int().min(1).max(12).default(3),
});

const forecastAccuracySchema = z.object({});

const complianceSummarySchema = z.object({});

const librarySearchSchema = z.object({
  query: z.string().min(1).max(200).optional(),
  category: z.string().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(12),
});

const semanticSearchSchema = z.object({
  query: z.string().min(1),
  top_k: z.number().int().min(1).max(10).default(5),
  source_types: z
    .array(z.enum(["model_note", "operator_note", "platform", "document_meta"]))
    .optional(),
});

export const TOOLS: Record<ToolName, AiToolDef> = {
  earnings_summary: {
    name: "earnings_summary",
    description:
      "Gross and net earnings totals over a date range, grouped by model, platform, week, or month.",
    jsonSchema: {
      type: "object",
      properties: {
        from: dateProp("Range start"),
        to: dateProp("Range end"),
        group_by: {
          type: "string",
          enum: ["model", "platform", "week", "month"],
          description: "How to group the totals (default month).",
        },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
    execute: async (raw, sb) => {
      const a = earningsSummarySchema.parse(raw);
      const { data, error } = await sb.rpc("fn_earnings_summary", {
        p_from: a.from,
        p_to: a.to,
        p_group_by: a.group_by,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as ToolRow[];
    },
  },

  earnings_monthly: {
    name: "earnings_monthly",
    description:
      "Monthly gross/net earnings series, optionally filtered to one model (stage name) and/or one platform.",
    jsonSchema: {
      type: "object",
      properties: {
        from_month: monthProp("First month"),
        to_month: monthProp("Last month"),
        stage_name: { type: "string", description: "Filter to this model's stage name." },
        platform_name: { type: "string", description: "Filter to this platform." },
      },
      required: ["from_month", "to_month"],
      additionalProperties: false,
    },
    execute: async (raw, sb) => {
      const a = earningsMonthlySchema.parse(raw);
      const modelId = a.stage_name ? await resolveModelId(sb, a.stage_name) : null;
      const platformId = a.platform_name
        ? await resolvePlatformId(sb, a.platform_name)
        : null;

      let query = sb
        .from("v_earnings_monthly")
        .select("model_id, platform_id, month, gross_amount, net_amount")
        .gte("month", monthStart(a.from_month))
        .lte("month", monthStart(a.to_month));
      if (modelId) query = query.eq("model_id", modelId);
      if (platformId) query = query.eq("platform_id", platformId);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      const [models, platforms] = await Promise.all([
        modelNameMap(sb),
        platformNameMap(sb),
      ]);
      return (data ?? []).map((r) => ({
        month: r.month,
        stage_name: r.model_id ? models.get(r.model_id) ?? "(model)" : null,
        platform: r.platform_id ? platforms.get(r.platform_id) ?? "(platform)" : null,
        gross_amount: r.gross_amount,
        net_amount: r.net_amount,
      }));
    },
  },

  hours_summary: {
    name: "hours_summary",
    description: "Worked hours and session counts per model over a date range.",
    jsonSchema: {
      type: "object",
      properties: { from: dateProp("Range start"), to: dateProp("Range end") },
      required: ["from", "to"],
      additionalProperties: false,
    },
    execute: async (raw, sb) => {
      const a = hoursSummarySchema.parse(raw);
      const { data, error } = await sb.rpc("fn_hours_summary", {
        p_from: a.from,
        p_to: a.to,
      });
      if (error) throw new Error(error.message);
      const models = await modelNameMap(sb);
      return (data ?? []).map((r) => ({
        stage_name: models.get(r.model_id) ?? "(model)",
        hours: r.hours,
        session_count: r.session_count,
      }));
    },
  },

  payout_summary: {
    name: "payout_summary",
    description: "Payout counts and net totals grouped by status over a date range.",
    jsonSchema: {
      type: "object",
      properties: { from: dateProp("Range start"), to: dateProp("Range end") },
      required: ["from", "to"],
      additionalProperties: false,
    },
    execute: async (raw, sb) => {
      const a = payoutSummarySchema.parse(raw);
      const { data, error } = await sb.rpc("fn_payout_summary", {
        p_from: a.from,
        p_to: a.to,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as ToolRow[];
    },
  },

  payout_history: {
    name: "payout_history",
    description: "Individual payouts over a date range, optionally filtered by status.",
    jsonSchema: {
      type: "object",
      properties: {
        from: dateProp("Range start"),
        to: dateProp("Range end"),
        status: {
          type: "string",
          enum: ["pending", "approved", "paid", "cancelled"],
          description: "Optional payout status filter.",
        },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
    execute: async (raw, sb) => {
      const a = payoutHistorySchema.parse(raw);
      let query = sb
        .from("v_payout_history")
        .select("payee_name, period_start, period_end, net_amount, currency, status, paid_at")
        .gte("period_end", a.from)
        .lte("period_end", a.to);
      if (a.status) query = query.eq("status", a.status);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as ToolRow[];
    },
  },

  payee_balances: {
    name: "payee_balances",
    description: "Current ledger balance for every payee (models and operators).",
    jsonSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: async (raw, sb) => {
      payeeBalancesSchema.parse(raw ?? {});
      const { data, error } = await sb
        .from("v_payee_balances")
        .select("payee_type, display_name, currency, balance");
      if (error) throw new Error(error.message);
      return (data ?? []) as ToolRow[];
    },
  },

  payee_statement: {
    name: "payee_statement",
    description:
      "Ledger statement for one payee (by type and display name) over a date range: opening balance, entries with running balance, closing balance.",
    jsonSchema: {
      type: "object",
      properties: {
        payee_type: {
          type: "string",
          enum: ["model", "operator"],
          description: "Whether the payee is a model or an operator.",
        },
        display_name: {
          type: "string",
          description: "The payee's stage name (model) or display name (operator).",
        },
        from: dateProp("Range start"),
        to: dateProp("Range end"),
      },
      required: ["payee_type", "display_name", "from", "to"],
      additionalProperties: false,
    },
    execute: async (raw, sb) => {
      const a = payeeStatementSchema.parse(raw);
      const payeeId =
        a.payee_type === "model"
          ? await resolveModelId(sb, a.display_name)
          : await resolveOperatorId(sb, a.display_name);
      if (!payeeId) return [];
      const { data, error } = await sb.rpc("fn_payee_statement", {
        p_payee_type: a.payee_type,
        p_payee_id: payeeId,
        p_from: a.from,
        p_to: a.to,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as ToolRow[];
    },
  },

  split_distribution: {
    name: "split_distribution",
    description:
      "Monthly split of net earnings across the model, operator, and studio buckets, with each bucket's share percentage.",
    jsonSchema: {
      type: "object",
      properties: {
        from_month: monthProp("First month"),
        to_month: monthProp("Last month"),
      },
      required: ["from_month", "to_month"],
      additionalProperties: false,
    },
    execute: async (raw, sb) => {
      const a = splitDistributionSchema.parse(raw);
      const { data, error } = await sb
        .from("v_split_distribution")
        .select("month, bucket, amount, share_percent")
        .gte("month", monthStart(a.from_month))
        .lte("month", monthStart(a.to_month));
      if (error) throw new Error(error.message);
      return (data ?? []) as ToolRow[];
    },
  },

  forecast: {
    name: "forecast",
    description:
      "Projected net earnings for the next N months per model and platform (live projection).",
    jsonSchema: {
      type: "object",
      properties: {
        months_ahead: {
          type: "integer",
          minimum: 1,
          maximum: 12,
          description: "How many months ahead to project (default 3).",
        },
      },
      additionalProperties: false,
    },
    execute: async (raw, sb) => {
      const a = forecastSchema.parse(raw ?? {});
      const { data, error } = await sb.rpc("fn_forecast", {
        p_months_ahead: a.months_ahead,
      });
      if (error) throw new Error(error.message);
      const [models, platforms] = await Promise.all([
        modelNameMap(sb),
        platformNameMap(sb),
      ]);
      return (data ?? []).map((r) => ({
        target_month: r.target_month,
        stage_name: r.model_id ? models.get(r.model_id) ?? "(model)" : null,
        platform: r.platform_id ? platforms.get(r.platform_id) ?? "(platform)" : null,
        predicted_net: r.predicted_net,
      }));
    },
  },

  forecast_accuracy: {
    name: "forecast_accuracy",
    description:
      "Forecast accuracy per month and model: predicted vs actual net, error percentage, and rolling MAPE.",
    jsonSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: async (raw, sb) => {
      forecastAccuracySchema.parse(raw ?? {});
      const { data, error } = await sb
        .from("v_forecast_accuracy")
        .select(
          "target_month, model_id, predicted_net, actual_net, error_percent, rolling_mape",
        );
      if (error) throw new Error(error.message);
      const models = await modelNameMap(sb);
      return (data ?? []).map((r) => ({
        target_month: r.target_month,
        stage_name: r.model_id ? models.get(r.model_id) ?? "(model)" : "studio total",
        predicted_net: r.predicted_net,
        actual_net: r.actual_net,
        error_percent: r.error_percent,
        rolling_mape: r.rolling_mape,
      }));
    },
  },

  compliance_summary: {
    name: "compliance_summary",
    description:
      "Per-model document-compliance counts: valid, expiring, and expired documents.",
    jsonSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: async (raw, sb) => {
      complianceSummarySchema.parse(raw ?? {});
      const { data, error } = await sb
        .from("v_model_compliance_summary")
        .select("stage_name, valid_count, expiring_count, expired_count");
      if (error) throw new Error(error.message);
      return (data ?? []) as ToolRow[];
    },
  },

  semantic_search: {
    name: "semantic_search",
    description:
      "Semantic search over scrubbed internal notes and document metadata. Returns the closest matches with a similarity score.",
    jsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query." },
        top_k: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          description: "Number of matches to return (default 5).",
        },
        source_types: {
          type: "array",
          items: {
            type: "string",
            enum: ["model_note", "operator_note", "platform", "document_meta"],
          },
          description: "Optional filter on which sources to search.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async (raw, sb) => {
      const a = semanticSearchSchema.parse(raw);
      const vector = await embedQuery(a.query);
      const { data, error } = await sb.rpc("fn_semantic_search", {
        p_embedding: `[${vector.join(",")}]`,
        p_top_k: a.top_k,
        p_source_types: (a.source_types as EmbeddingSource[] | undefined) ?? undefined,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as ToolRow[];
    },
  },

  library_search: {
    name: "library_search",
    description:
      "Search the studio's file Library (training material, platform guides, scripts, business records) by name or by the AI-generated summary. Returns file metadata, category and the stored summary/key figures — never the file contents themselves.",
    jsonSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search term matched against file names and AI summaries. Omit to list the most recent files.",
        },
        category: {
          type: "string",
          description: "Optional category filter, by slug or name (e.g. 'training').",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: "Maximum files to return (default 12).",
        },
      },
      additionalProperties: false,
    },
    execute: async (raw, sb) => {
      const a = librarySearchSchema.parse(raw);

      // Category vocabulary, resolved both ways so the model neither sees nor
      // supplies a UUID (registry invariant).
      const { data: cats } = await sb.from("doc_categories").select("id, slug, name");
      const catName = new Map((cats ?? []).map((c) => [c.id, c.name] as const));
      const wanted = a.category?.trim().toLowerCase();
      const categoryId = wanted
        ? ((cats ?? []).find(
            (c) => c.slug.toLowerCase() === wanted || c.name.toLowerCase() === wanted,
          )?.id ?? null)
        : null;
      if (wanted && !categoryId) return [];

      const SELECT =
        "id, name, folder_path, category_id, ai_suggested_category_id, ai_status, ai_summary, ai_key_figures, created_at";
      const base = () => {
        let q = sb
          .from("library_files")
          .select(SELECT)
          .order("created_at", { ascending: false })
          .limit(a.limit);
        if (categoryId) q = q.eq("category_id", categoryId);
        return q;
      };

      // Two separate ilike queries instead of PostgREST `.or(...)` — the or()
      // filter string has its own comma/paren grammar that a search term could
      // break out of; two plain filters have no such parser to confuse.
      let rows: Array<Record<string, unknown>>;
      if (a.query) {
        const pattern = `%${escapeLike(a.query.trim())}%`;
        const [byName, bySummary] = await Promise.all([
          base().ilike("name", pattern),
          base().ilike("ai_summary", pattern),
        ]);
        if (byName.error) throw new Error(byName.error.message);
        if (bySummary.error) throw new Error(bySummary.error.message);
        const seen = new Set<string>();
        rows = [...(byName.data ?? []), ...(bySummary.data ?? [])]
          .filter((r) => (seen.has(r.id as string) ? false : (seen.add(r.id as string), true)))
          .slice(0, a.limit);
      } else {
        const { data, error } = await base();
        if (error) throw new Error(error.message);
        rows = data ?? [];
      }

      // Note the output key `name`: this is the Library DISPLAY name — a
      // business artifact in a senior-staff-only subsystem whose full content
      // already crosses via classificationChannel. The blocked key `file_name`
      // guards compliance-document filenames, which can carry identity; that
      // boundary is untouched.
      return rows.map((r) => ({
        name: r.name,
        folder: r.folder_path,
        category: r.category_id ? (catName.get(r.category_id as string) ?? null) : null,
        suggested_category: r.ai_suggested_category_id
          ? (catName.get(r.ai_suggested_category_id as string) ?? null)
          : null,
        status: r.ai_status,
        summary: r.ai_summary,
        key_figures: r.ai_key_figures,
        uploaded_on: typeof r.created_at === "string" ? r.created_at.slice(0, 10) : null,
      }));
    },
  },
};

export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

/** The tool definitions in OpenAI `tools` shape, for the chat request. */
export function getToolDefinitions(): Tool[] {
  return TOOL_NAMES.map((name) => ({
    type: "function",
    function: {
      name,
      description: TOOLS[name].description,
      parameters: TOOLS[name].jsonSchema,
    },
  }));
}

export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOLS, name);
}

/**
 * Validate the tool name against the fixed registry, then run it under the
 * caller's client. A name outside the registry is rejected before execution
 * (docs/11 §4). Returns name-resolved rows; the caller must pass them through
 * `redactToolResult` before any of it crosses to a provider.
 */
export async function executeTool(
  name: string,
  rawArgs: unknown,
  supabase: AiSupabaseClient,
): Promise<ToolRow[]> {
  if (!isToolName(name)) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return TOOLS[name].execute(rawArgs, supabase);
}
