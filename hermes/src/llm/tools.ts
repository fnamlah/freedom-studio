import { enqueueApproval, recordCardMessage } from "../governance/approvals.js";
import { resolvePolicy, roleSatisfies } from "../governance/policy.js";
import { todaysCost } from "../lib/cost.js";
import { hermesDict, type Locale } from "../lib/i18n.js";
import { getPolicyValue } from "../lib/policy-kv.js";
import { getAdminClient } from "../lib/supabase.js";
import { consumeAttachment } from "../telegram/attachments.js";
import { editMessageText, escapeHtml, sendApprovalCard } from "../telegram/api.js";
import { PROPOSE_ACTION, TOOL_COMMAND, projectionFor, supersedeKeyFor } from "./tool-catalog.js";
import { redactToolResult, scrubText } from "./redact.js";
import {
  explain,
  resolveAccount,
  resolveDocument,
  resolveModel,
  resolveOperator,
  resolvePlatform,
} from "./resolve.js";
import { embedQuery, EmbeddingNotConfiguredError } from "./embed.js";
import { readSetting } from "../lib/settings.js";
import {
  isAllowedMime,
  sanitizeFilename,
  TELEGRAM_MAX_FILE_BYTES,
} from "../../../src/lib/fields/documents.js";
import {
  accountProposal,
  assignmentProposal,
  modelProposal,
  documentUploadProposal,
  monthsAheadProposal,
  operatorProposal,
  payoutProposal,
  periodProposal,
  platformProposal,
  rateCardProposal,
  schemeProposal,
  validate,
} from "./validate.js";

/**
 * Executing a conversational tool.
 *
 * Split from `tool-catalog.ts` on purpose: the catalog is pure data so the
 * governance suite can assert its properties without booting env or a database
 * — the same reason `telegram/access.ts` is pure. This half needs both, so it
 * stays out of that import graph.
 */

function ageMinutes(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.round((Date.now() - t) / 60_000);
}

/**
 * Raise on a failed read instead of returning nothing.
 *
 * PostgREST resolves `{ data: null, error }` rather than rejecting, so a
 * dropped `error` turns a failed query into an empty array — and the model,
 * told to answer only from tools and never invent, states that emptiness as
 * fact: "nobody is owed anything right now" when the balances query actually
 * failed. A false negative about money owed to a performer is indistinguishable
 * from a true one.
 *
 * The slash commands this surface mirrors branch on `error` and say so
 * (commands.ts `balancesError`/`approvalsError`); throwing here is how the
 * conversational path keeps that promise — `converse()` turns a thrown tool
 * error into an `{error}` payload the model can report honestly.
 */
function orThrow<T>(
  tool: string,
  result: { data: T[] | null; error: { message: string } | null },
): T[] {
  if (result.error) throw new Error(`${tool} read failed: ${result.error.message}`);
  return result.data ?? [];
}

/**
 * Run one tool and return its REDACTED rows.
 *
 * `role` is re-checked here even though `specsForRole` already filtered the
 * offer: a model can hallucinate a tool name it was never given, and the
 * offer is a suggestion while this is the gate.
 */
export async function runTool(
  name: string,
  role: string,
  commandAllowed: (role: string, command: string) => boolean,
  ctx?: ToolContext,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>[]> {
  const command = TOOL_COMMAND[name];
  if (!command) throw new Error(`unknown tool: ${name}`);

  // A proposal is gated by whether this person could DECIDE it — the same
  // check `decide_approval` makes in the database. Re-checked here because
  // `specsForRole` only chose what to OFFER, and a model can name a tool it
  // was never given.
  const action = PROPOSE_ACTION[name];
  if (action) {
    const policy = resolvePolicy(action);
    if (policy.tier !== "approval" || !roleSatisfies(role, policy.requiredRole ?? "super_admin")) {
      throw new Error(`tool ${name} not permitted for ${role}`);
    }
    if (!ctx) throw new Error(`${name} needs a chat context`);
  } else if (!commandAllowed(role, command)) {
    throw new Error(`tool ${name} not permitted for ${role}`);
  }

  const db = getAdminClient();

  switch (name) {
    case "hermes_balances": {
      const rows = orThrow(
        name,
        await db
          .from("v_payee_balances")
          .select("payee_type, display_name, balance, currency")
          .gt("balance", 0)
          .order("balance", { ascending: false })
          .limit(15),
      );
      return redactToolResult("payee_balances", rows);
    }

    case "hermes_approvals": {
      const data = orThrow(
        name,
        await db
          .from("hermes_approvals")
          .select("action_type, required_role, preview, created_at, expires_at")
          .eq("state", "pending")
          .order("created_at", { ascending: true })
          .limit(10),
      );
      // Only what this person could actually decide — the same filter the
      // /approvals command applies before rendering a card.
      const decidable = data.filter((r) =>
        roleSatisfies(role, String(r.required_role)),
      );
      // `preview` is free-form JSON written by the worker. Flatten only its
      // summary to a scalar: the projection would drop the object anyway, and
      // an un-summarised proposal is better described than dumped.
      const rows = decidable.map((r) => {
        const preview = (r.preview ?? {}) as Record<string, unknown>;
        const summary =
          typeof preview.summary_en === "string"
            ? preview.summary_en
            : typeof preview.summary === "string"
              ? preview.summary
              : null;
        return {
          action_type: r.action_type,
          required_role: r.required_role,
          summary,
          created_at: r.created_at,
          expires_at: r.expires_at,
        };
      });
      return redactToolResult("hermes_approvals", rows);
    }

    case "hermes_compliance": {
      return redactToolResult("hermes_compliance", orThrow(name, await db.rpc("fn_compliance_counts")));
    }

    case "hermes_cost": {
      // Independent reads — issued together rather than one after the other.
      const [spent, capRaw] = await Promise.all([
        todaysCost(),
        getPolicyValue<number>("daily_cost_cap_usd"),
      ]);
      const cap = capRaw ?? 0;
      return redactToolResult("hermes_cost", [
        { spent_usd: Number(spent.toFixed(4)), cap_usd: cap, currency: "USD" },
      ]);
    }

    case "hermes_status": {
      // Three independent reads. Serially these were the most expensive tool
      // in the set; together they cost one round trip.
      const [beatsRes, jobsRes, enabled] = await Promise.all([
        db.from("hermes_policy").select("key, updated_at").like("key", "heartbeat:%"),
        db
          .from("hermes_job_runs")
          .select("job_name, status, outcome, started_at")
          .order("started_at", { ascending: false })
          .limit(5),
        getPolicyValue<boolean>("enabled"),
      ]);
      const beats = orThrow(name, beatsRes);
      const jobs = orThrow(name, jobsRes);

      const rows = [
        ...beats.map((b) => ({
          kind: "loop",
          name: String(b.key).replace("heartbeat:", ""),
          minutes_ago: ageMinutes(b.updated_at),
          state: enabled === false ? "paused" : "running",
        })),
        ...jobs.map((j) => ({
          kind: "job",
          name: j.job_name,
          state: j.status,
          outcome: j.outcome,
        })),
      ];
      return redactToolResult("hermes_status", rows);
    }

    case "hermes_model_earnings":
      return readModelEarnings(args);
    case "hermes_model_terms":
      return readModelTerms(args);
    case "hermes_documents":
      return readDocuments(args);

    case "hermes_propose_earning":
      return proposeEarning(ctx!, args);
    case "hermes_propose_session":
      return proposeSession(ctx!, args);
    case "hermes_propose_expense":
      return proposeExpense(ctx!, args);
    case "hermes_propose_model":
      return proposeModel(ctx!, args);
    case "hermes_propose_document_update":
      return proposeDocumentUpdate(ctx!, args);
    case "hermes_propose_delete":
      return proposeDelete(ctx!, args);
    case "hermes_propose_read_document":
      return proposeReadDocument(ctx!, args);

    case "hermes_team":
      return readTeam(args);
    case "hermes_platforms":
      return readPlatforms(args);
    case "hermes_propose_operator":
      return proposeOperator(ctx!, args);
    case "hermes_propose_platform":
      return proposePlatform(ctx!, args);
    case "hermes_propose_account":
      return proposeAccount(ctx!, args);
    case "hermes_propose_assignment":
      return proposeAssignment(ctx!, args);
    case "hermes_propose_archive":
      return proposeArchive(ctx!, args);
    case "hermes_propose_scheme":
      return proposeScheme(ctx!, args);
    case "hermes_propose_rate_card":
      return proposeRateCard(ctx!, args);
    case "hermes_propose_approve_payout":
      return proposeApprovePayout(ctx!, args);

    case "hermes_earnings":
      return readEarnings(args);
    case "hermes_sessions":
      return readSessions(args);
    case "hermes_expenses":
      return readExpenses(args);
    case "hermes_payout_history":
      return readPayoutHistory(args);
    case "hermes_ledger":
      return readLedger(args);
    case "hermes_forecast":
      return readForecast();
    case "hermes_schemes":
      return readSchemes();
    case "hermes_person_details":
      return readPersonDetails(ctx!, args);
    case "hermes_propose_payout":
      return proposePayout(ctx!, args);
    case "hermes_propose_mark_paid":
      return proposeMarkPaid(ctx!, args);
    case "hermes_propose_cancel_payout":
      return proposeCancelPayout(ctx!, args);
    case "hermes_propose_delete_document":
      return proposeDeleteDocument(ctx!, args);
    case "hermes_propose_delete_entity":
      return proposeDeleteEntity(ctx!, args);
    case "hermes_propose_close_period":
      return proposeClosePeriod(ctx!, args);
    case "hermes_propose_snapshot_forecast":
      return proposeSnapshotForecast(ctx!, args);
    case "hermes_propose_upload_document":
      return proposeUploadDocument(ctx!, args);
    case "hermes_search":
      return searchEverything(args);

    default:
      throw new Error(`unhandled tool: ${name}`);
  }
}

/* ======================================================================== *
 * The widened surface (029/030).
 *
 * Reads answer directly. `propose_*` tools NEVER write: they resolve names to
 * ids, queue an approval whose `required_role` comes from the policy table
 * (never from the model's arguments), send the card, and return a sentence
 * saying so. The write happens later, after a human tap, under that human's
 * own row-level security.
 * ======================================================================== */

export interface ToolContext {
  role: string;
  profileId: string;
  chatId: number | string;
  locale: Locale;
  /** The file sent to this chat, when the turn carries one (upload flow). */
  attachment?: {
    fileId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    receivedAt?: number;
  };
}

/** Month bucket helper for the per-model views. */
function sinceMonths(n: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - Math.max(1, Math.min(24, n)));
  return d.toISOString().slice(0, 10);
}

async function readModelEarnings(args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const name_ = "hermes_model_earnings";
  const db = getAdminClient();
  const model = await resolveModel(String(args.model ?? ""));
  if (!model.ok) throw new Error(explain(model, "models"));

  const since = sinceMonths(typeof args.months === "number" ? args.months : 3);
  const [earnRes, hoursRes, platformsRes] = await Promise.all([
    db
      .from("v_earnings_monthly")
      .select("month, platform_id, gross_amount, net_amount")
      .eq("model_id", model.value.id)
      .gte("month", since)
      .order("month", { ascending: false }),
    db
      .from("v_sessions_hours_monthly")
      .select("month, hours, session_count")
      .eq("model_id", model.value.id)
      .gte("month", since),
    db.from("platforms").select("id, name"),
  ]);

  // A failed read must not become "she earned nothing" — the same reasoning
  // `orThrow` carries for the original tools.
  const earn = orThrow(name_, earnRes);
  const hours = orThrow(name_, hoursRes);
  const platforms = orThrow(name_, platformsRes);

  const pname = new Map(platforms.map((p) => [p.id, p.name]));
  const hoursByMonth = new Map(hours.map((h) => [String(h.month), h] as const));

  const rows = earn.map((e) => {
    const h = hoursByMonth.get(String(e.month));
    return {
      stage_name: model.value.label,
      platform: (e.platform_id ? pname.get(e.platform_id) : null) ?? "—",
      period_start: e.month,
      period_end: e.month,
      gross_amount: e.gross_amount,
      net_amount: e.net_amount,
      hours: h?.hours ?? null,
      session_count: h?.session_count ?? null,
    };
  });
  return redactToolResult("hermes_model_earnings", rows);
}

async function readModelTerms(args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const db = getAdminClient();
  const model = await resolveModel(String(args.model ?? ""));
  if (!model.ok) throw new Error(explain(model, "models"));

  // Which scheme applies to her: her own, else the studio default. The
  // account-scoped case is deliberately not chased here — the answer to
  // "what percentage does she get" is the scheme and its rate card.
  const [schemes, assignments] = await Promise.all([
    db
      .from("commission_schemes")
      .select("id, model_id, platform_account_id, model_percent, operator_percent, studio_percent, effective_from, effective_to")
      .or(`model_id.eq.${model.value.id},and(model_id.is.null,platform_account_id.is.null)`),
    db
      .from("operator_assignments")
      .select("pool_share_percent, assigned_from, assigned_to, operators(display_name, staff_role)")
      .eq("model_id", model.value.id),
  ]);

  const schemeRows = orThrow("hermes_model_terms", schemes);
  const assignmentRows = orThrow("hermes_model_terms", assignments);

  const scheme =
    schemeRows.find((s) => s.model_id === model.value.id) ??
    schemeRows.find((s) => s.model_id === null);

  const rows: Record<string, unknown>[] = [];

  if (scheme) {
    const rates = orThrow(
      "hermes_model_terms",
      await db
        .from("commission_rates")
        .select("party, min_amount, percent")
        .eq("scheme_id", scheme.id)
        .order("party")
        .order("min_amount"),
    );

    if (rates.length) {
      for (const r of rates) {
        rows.push({
          stage_name: model.value.label,
          scope: scheme.model_id ? "this model" : "studio default",
          party: r.party,
          min_amount: r.min_amount,
          percent: r.percent,
          effective_from: scheme.effective_from,
          effective_to: scheme.effective_to,
        });
      }
    } else {
      // No rate card: the scheme's own three-way split still applies (009).
      rows.push({
        stage_name: model.value.label,
        scope: scheme.model_id ? "this model" : "studio default",
        party: "model / team pool / studio",
        percent: `${scheme.model_percent} / ${scheme.operator_percent} / ${scheme.studio_percent}`,
        effective_from: scheme.effective_from,
        effective_to: scheme.effective_to,
      });
    }
  }

  for (const a of assignmentRows) {
    const op = a.operators as unknown as { display_name?: string; staff_role?: string } | null;
    rows.push({
      stage_name: model.value.label,
      team_member: op?.display_name ?? "—",
      staff_role: op?.staff_role ?? "—",
      pool_share_percent: a.pool_share_percent,
      effective_from: a.assigned_from,
      effective_to: a.assigned_to,
    });
  }

  return redactToolResult("hermes_model_terms", rows);
}

async function readDocuments(args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const db = getAdminClient();
  let modelId: string | null = null;
  let modelLabel = "";
  if (typeof args.model === "string" && args.model.trim()) {
    const m = await resolveModel(args.model);
    if (!m.ok) throw new Error(explain(m, "models"));
    modelId = m.value.id;
    modelLabel = m.value.label;
  }

  let docQuery = db
    .from("documents")
    .select(
      "id, title, doc_type, issued_date, expires_at, ai_summary, ai_key_figures, ai_analysis_opt_in, model_id",
    )
    .order("expires_at", { ascending: true, nullsFirst: false })
    .limit(25);
  if (modelId) docQuery = docQuery.eq("model_id", modelId);
  if (typeof args.search === "string" && args.search.trim()) {
    docQuery = docQuery.ilike("title", `%${args.search.trim()}%`);
  }

  let libQuery = db
    .from("library_files")
    // The embed MUST name its foreign key. `library_files` has TWO paths to
    // `doc_categories` — `category_id` and `ai_suggested_category_id` (005) —
    // so an unqualified `doc_categories(name)` is ambiguous and PostgREST
    // refuses the whole query with "more than one relationship was found".
    // That made this tool throw on every call: asking the bot about documents
    // has never worked. Qualified to the CONFIRMED category, not the AI's
    // suggestion, which is what the portal displays.
    .select(
      "id, name, folder_path, ai_summary, ai_key_figures, created_at, doc_categories!library_files_category_id_fkey(name)",
    )
    .order("created_at", { ascending: false })
    .limit(25);
  if (typeof args.search === "string" && args.search.trim()) {
    libQuery = libQuery.ilike("name", `%${args.search.trim()}%`);
  }

  const [docs, lib, models] = await Promise.all([
    docQuery,
    // A model filter is about compliance documents; the Library is studio-wide.
    modelId ? Promise.resolve({ data: [], error: null }) : libQuery,
    db.from("models").select("id, stage_name"),
  ]);

  const docRows = orThrow("hermes_documents", docs);
  const libRows = orThrow("hermes_documents", lib);
  const mname = new Map(orThrow("hermes_documents", models).map((m) => [m.id, m.stage_name]));
  const today = new Date().toISOString().slice(0, 10);
  const expiringOnly = args.expiring === true;

  const rows: Record<string, unknown>[] = [];

  for (const d of docRows) {
    const compliance = !d.expires_at
      ? "valid"
      : d.expires_at < today
        ? "expired"
        : d.expires_at <= new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
          ? "expiring"
          : "valid";
    if (expiringOnly && compliance === "valid") continue;
    rows.push({
      kind: "compliance document",
      title: d.title,
      stage_name: mname.get(d.model_id) ?? (modelLabel || "—"),
      doc_type: d.doc_type,
      issued_date: d.issued_date,
      expires_at: d.expires_at,
      compliance,
      summary: d.ai_summary,
      key_figures: d.ai_key_figures,
      // Whether its CONTENTS have been consented for reading (014). False means
      // propose_read_document is the way in.
      readable: d.ai_analysis_opt_in === true,
    });
  }

  if (!expiringOnly) {
    for (const f of libRows) {
      const cat = f.doc_categories as unknown as { name?: string } | null;
      rows.push({
        kind: "library file",
        title: f.name,
        category: cat?.name ?? null,
        folder: f.folder_path,
        summary: f.ai_summary,
        key_figures: f.ai_key_figures,
        uploaded_on: f.created_at,
        readable: true,
      });
    }
  }

  return redactToolResult("hermes_documents", rows);
}

/* ------------------------------------------------------------- proposals --- */

/** "status: terminated, country: PL" — what the card actually promises to do. */
function describeChanges(payload: Record<string, unknown>, omit: string[]): string {
  return Object.entries(payload)
    .filter(([k, v]) => !omit.includes(k) && v !== undefined)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(", ");
}

/** Build the bilingual preview a human reads on the card before tapping. */
function preview(en: string, ru: string, risk?: string): Record<string, unknown> {
  return { summary_en: en, summary_ru: ru, ...(risk ? { risk_en: risk } : {}) };
}

/**
 * Queue an approval and put the card in front of the person who asked.
 *
 * `enqueueApproval` reads `required_role` from ACTION_POLICIES, never from
 * here — the defence against a proposal nominating itself an easier approver.
 * `supersedeKeyFor` (tool-catalog) decides whether this proposal retires an
 * older pending card for the SAME entity; creates never supersede.
 */
async function propose(
  ctx: ToolContext,
  actionType: string,
  payload: Record<string, unknown>,
  cardEn: string,
  cardRu: string,
  risk?: string,
): Promise<Record<string, unknown>[]> {
  const { id, deduped, superseded } = await enqueueApproval({
    actionType,
    payload,
    preview: preview(cardEn, cardRu, risk),
    sourceChatId: String(ctx.chatId),
    supersedeKey: supersedeKeyFor(actionType, payload),
  });

  // Neutralise the buttons on any card this one supersedes — a live Approve
  // under a newer, different request was half of the S8 double-write.
  const h = hermesDict(ctx.locale);
  for (const old of superseded) {
    if (old.cardMessageId) {
      await editMessageText(ctx.chatId, Number(old.cardMessageId), h.cardSuperseded).catch(
        () => undefined,
      );
    }
  }

  // An identical proposal is already pending: point at it instead of sending
  // a second card for the same approval id — two live button rows for one
  // decision read as two decisions.
  if (deduped) {
    return redactToolResult("hermes_proposal", [
      { status: "already_waiting", action: actionType },
    ]);
  }

  const text = ctx.locale === "ru" ? cardRu : cardEn;
  const sent = (await sendApprovalCard(
    ctx.chatId,
    id,
    [escapeHtml(text), risk ? `<i>${escapeHtml(risk)}</i>` : ""].filter(Boolean).join("\n"),
    ctx.locale,
  ).catch(() => null)) as { message_id?: number } | null;
  if (sent?.message_id) await recordCardMessage(id, String(sent.message_id));

  // Projected like any other tool result — "nothing reaches a provider
  // unprojected" holds with no exceptions. It says "waiting" so the model
  // reports a pending decision rather than claiming the record exists.
  return redactToolResult("hermes_proposal", [
    { status: "awaiting_approval", action: actionType },
  ]);
}

/**
 * A money value, or a refusal.
 *
 * `Number(null)` is 0 and `Number([])` is 0, so an omitted or malformed amount
 * used to become a silent zero on an approval card; NaN and Infinity survived
 * to the executor and died there, long after the human had read a sentence
 * that looked fine. `earnings.net_amount` carries no non-negative constraint,
 * so nothing downstream would have caught it either.
 */
function money2(v: unknown, field: string): number {
  if (v === null || v === undefined || v === "" || typeof v === "boolean" || Array.isArray(v)) {
    throw new Error(`${field} is missing — say the amount and I will prepare it.`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`${field} is not a number I can use — say it as a plain number.`);
  }
  return n;
}

async function proposeEarning(ctx: ToolContext, a: Record<string, unknown>) {
  const acct = await resolveAccount(
    String(a.model ?? ""),
    typeof a.platform === "string" ? a.platform : undefined,
  );
  if (!acct.ok) throw new Error(explain(acct, "accounts"));

  const net = money2(a.net_amount, "net amount");
  const payload = {
    platform_account_id: acct.value.id,
    period_start: String(a.period_start),
    period_end: String(a.period_end),
    gross_amount: money2(a.gross_amount, "gross amount"),
    fee_amount: a.fee_amount === undefined ? 0 : money2(a.fee_amount, "fee"),
    net_amount: net,
  };
  return propose(
    ctx,
    "record_earning",
    payload,
    `Record earning for ${a.model} (${acct.value.label}): ${net} net, ${a.period_start} to ${a.period_end}?`,
    `Записать доход для ${a.model} (${acct.value.label}): ${net} нетто, ${a.period_start} — ${a.period_end}?`,
  );
}

async function proposeSession(ctx: ToolContext, a: Record<string, unknown>) {
  const acct = await resolveAccount(
    String(a.model ?? ""),
    typeof a.platform === "string" ? a.platform : undefined,
  );
  if (!acct.ok) throw new Error(explain(acct, "accounts"));

  const payload = {
    platform_account_id: acct.value.id,
    started_at: String(a.started_at),
    ...(typeof a.ended_at === "string" ? { ended_at: a.ended_at } : {}),
    ...(a.gross_earnings === undefined ? {} : { gross_earnings: money2(a.gross_earnings, "gross earnings") }),
    ...(typeof a.notes === "string" ? { notes: a.notes } : {}),
  };
  return propose(
    ctx,
    "record_session",
    payload,
    `Record a session for ${a.model} starting ${a.started_at}${a.ended_at ? ` until ${a.ended_at}` : " (still open)"}?`,
    `Записать смену для ${a.model} с ${a.started_at}${a.ended_at ? ` до ${a.ended_at}` : " (ещё идёт)"}?`,
  );
}

async function proposeExpense(ctx: ToolContext, a: Record<string, unknown>) {
  const amount = money2(a.amount, "amount");
  const payload = {
    incurred_on: String(a.incurred_on),
    vendor: String(a.vendor),
    amount,
    ...(typeof a.description === "string" ? { description: a.description } : {}),
    ...(typeof a.category === "string" ? { category: a.category } : {}),
  };
  return propose(
    ctx,
    "record_expense",
    payload,
    `Record expense: ${amount} to ${a.vendor} on ${a.incurred_on}?`,
    `Записать расход: ${amount} — ${a.vendor}, ${a.incurred_on}?`,
  );
}

async function proposeModel(ctx: ToolContext, a: Record<string, unknown>) {
  let modelId: string | undefined;
  let existing = "";
  if (typeof a.model === "string" && a.model.trim()) {
    const m = await resolveModel(a.model);
    if (!m.ok) throw new Error(explain(m, "models"));
    modelId = m.value.id;
    existing = m.value.label;
  }

  // The one propose path that used to skip `validate.ts` — the 18+ gate, the
  // country format and the commission bounds now hold here like everywhere.
  const fields = validate(modelProposal, present(a));
  if (!modelId && (!fields.stage_name || !fields.legal_name || !fields.date_of_birth)) {
    throw new Error("A new model needs a stage name, a legal name and a date of birth.");
  }
  const payload = {
    ...(modelId ? { model_id: modelId } : {}),
    ...present(fields),
  };

  // Name the values, not just the fields. "change status" is not something a
  // person can meaningfully approve; "status: active → terminated" is.
  const changed = describeChanges(payload, ["model_id"]);
  return modelId
    ? propose(
        ctx,
        "upsert_model",
        payload,
        `Update ${existing} — change ${changed}?`,
        `Изменить ${existing} — ${changed}?`,
      )
    : propose(
        ctx,
        "upsert_model",
        payload,
        `Add a new model: ${fields.stage_name}?`,
        `Добавить новую модель: ${fields.stage_name}?`,
      );
}

async function proposeDocumentUpdate(ctx: ToolContext, a: Record<string, unknown>) {
  const doc = await resolveDocument(
    String(a.document ?? ""),
    typeof a.model === "string" ? a.model : undefined,
  );
  if (!doc.ok) throw new Error(explain(doc, "documents"));

  const payload = {
    document_id: doc.value.id,
    ...(typeof a.title === "string" ? { title: a.title } : {}),
    ...(typeof a.doc_type === "string" ? { doc_type: a.doc_type } : {}),
    ...(typeof a.issued_date === "string" ? { issued_date: a.issued_date } : {}),
    ...(typeof a.expires_at === "string" ? { expires_at: a.expires_at } : {}),
  };
  const changed = describeChanges(payload, ["document_id"]);
  return propose(
    ctx,
    "update_document",
    payload,
    `Update "${doc.value.label}" — change ${changed}?`,
    `Обновить «${doc.value.label}» — ${changed}?`,
  );
}

async function proposeDelete(ctx: ToolContext, a: Record<string, unknown>) {
  const db = getAdminClient();
  const kind = String(a.kind ?? "");
  let recordId: string | null = null;
  let what = "";

  if (kind === "earning" || kind === "work_session") {
    const m = await resolveModel(String(a.model ?? ""));
    if (!m.ok) throw new Error(explain(m, "models"));

    if (kind === "earning") {
      let q = db
        .from("earnings")
        .select("id, period_start, period_end, net_amount")
        .eq("model_id", m.value.id);
      if (typeof a.period_start === "string") q = q.eq("period_start", a.period_start);
      const data = orThrow("hermes_propose_delete", await q.limit(5));
      if (!data.length) throw new Error("No earning matches that.");
      if (data.length > 1) throw new Error("Several earnings match — name the exact period.");
      recordId = data[0]!.id;
      what = `${m.value.label} — ${data[0]!.net_amount} net, ${data[0]!.period_start} to ${data[0]!.period_end}`;
    } else {
      // Deleting is irreversible, so this refuses ambiguity exactly as the
      // earning branch does. Taking the most recent session because it was
      // first in the list would delete a row nobody named.
      let q = db
        .from("work_sessions")
        .select("id, started_at")
        .eq("model_id", m.value.id);
      if (typeof a.started_on === "string") {
        q = q
          .gte("started_at", `${a.started_on}T00:00:00Z`)
          .lt("started_at", `${a.started_on}T23:59:59Z`);
      }
      const data = orThrow("hermes_propose_delete", await q.limit(5));
      if (!data.length) throw new Error("No session matches that.");
      if (data.length > 1) {
        throw new Error(
          `Several sessions match — which day? ${data
            .map((r) => String(r.started_at).slice(0, 10))
            .join(", ")}`,
        );
      }
      recordId = data[0]!.id;
      what = `${m.value.label} — session starting ${data[0]!.started_at}`;
    }
  } else if (kind === "expense") {
    let q = db.from("expenses").select("id, vendor, amount, incurred_on");
    if (typeof a.vendor === "string") q = q.ilike("vendor", `%${a.vendor}%`);
    if (typeof a.incurred_on === "string") q = q.eq("incurred_on", a.incurred_on);
    const data = orThrow("hermes_propose_delete", await q.limit(5));
    if (!data.length) throw new Error("No expense matches that.");
    if (data.length > 1) throw new Error("Several expenses match — name the vendor and date.");
    recordId = data[0]!.id;
    what = `${data[0]!.amount} to ${data[0]!.vendor} on ${data[0]!.incurred_on}`;
  } else {
    // The whitelist is enforced again in `fn_agent_delete_record`; failing
    // here just means a clearer sentence.
    throw new Error(`"${kind}" cannot be deleted by the bot.`);
  }

  return propose(
    ctx,
    "delete_record",
    { kind, record_id: recordId },
    `DELETE this ${kind}: ${what}. This cannot be undone.`,
    `УДАЛИТЬ ${kind}: ${what}. Это необратимо.`,
    "Deletion is permanent. Ledger entries produced by this record are NOT removed — they must be reversed with an adjustment.",
  );
}

async function proposeReadDocument(ctx: ToolContext, a: Record<string, unknown>) {
  const doc = await resolveDocument(
    String(a.document ?? ""),
    typeof a.model === "string" ? a.model : undefined,
  );
  if (!doc.ok) throw new Error(explain(doc, "documents"));

  return propose(
    ctx,
    "read_compliance_document",
    { document_id: doc.value.id },
    `Send ${doc.value.owner}'s "${doc.value.label}" to the AI provider so it can be read?`,
    `Отправить документ «${doc.value.label}» (${doc.value.owner}) ИИ-провайдеру для прочтения?`,
    `This is ${doc.value.owner}'s compliance document and may contain her identity data — name, date of birth, document number. Approving records consent, is audited, and can be revoked in the portal.`,
  );
}

/* ======================================================================== *
 * Setting the studio up (031).
 *
 * Same two rules as the surface above — names never ids, nothing here writes
 * — plus a third that is new: EVERY proposal is validated with the app's own
 * field rules before a card is queued. `validate.ts` imports the same schema
 * objects `src/app/(app)/*_/actions.ts` use, so a value the web form would
 * refuse is refused here too, in conversation, naming the reason — rather than
 * surfacing as a SQLSTATE after someone has already tapped Approve.
 * ======================================================================== */

async function readTeam(args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const db = getAdminClient();
  let modelId: string | null = null;
  if (typeof args.model === "string" && args.model.trim()) {
    const m = await resolveModel(args.model);
    if (!m.ok) throw new Error(explain(m, "models"));
    modelId = m.value.id;
  }

  let q = db
    .from("operator_assignments")
    .select("pool_share_percent, assigned_from, assigned_to, operator_id, model_id");
  if (modelId) q = q.eq("model_id", modelId);

  const [assignments, operators, models] = await Promise.all([
    q.order("assigned_from", { ascending: false }).limit(200),
    db.from("operators").select("id, display_name, staff_role, status"),
    db.from("models").select("id, stage_name"),
  ]);

  const rows = orThrow("hermes_team", assignments);
  const staff = new Map(
    orThrow("hermes_team", operators).map((o) => [o.id, o]),
  );
  const names = new Map(orThrow("hermes_team", models).map((m) => [m.id, m.stage_name]));

  const attached = rows.map((r) => ({
    team_member: staff.get(r.operator_id)?.display_name ?? "?",
    staff_role: staff.get(r.operator_id)?.staff_role ?? "operator",
    status: staff.get(r.operator_id)?.status ?? "?",
    stage_name: names.get(r.model_id) ?? "?",
    pool_share_percent: r.pool_share_percent,
    assigned_from: r.assigned_from,
    assigned_to: r.assigned_to,
  }));

  // Someone with no assignment yet is still on the team, and is exactly who
  // Alina is about to attach to a model. Omitting them would make "who do we
  // have?" answer with only the already-placed half.
  if (!modelId) {
    const placed = new Set(rows.map((r) => r.operator_id));
    for (const o of staff.values()) {
      if (!placed.has(o.id)) {
        attached.push({
          team_member: o.display_name,
          staff_role: o.staff_role ?? "operator",
          status: o.status,
          stage_name: "—",
          pool_share_percent: null as never,
          assigned_from: null as never,
          assigned_to: null as never,
        });
      }
    }
  }
  return redactToolResult("hermes_team", attached);
}

async function readPlatforms(args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const db = getAdminClient();
  let modelId: string | null = null;
  if (typeof args.model === "string" && args.model.trim()) {
    const m = await resolveModel(args.model);
    if (!m.ok) throw new Error(explain(m, "models"));
    modelId = m.value.id;
  }

  let accountQuery = db
    .from("platform_accounts")
    .select("id, username, status, platform_fee_percent, model_id, platform_id");
  if (modelId) accountQuery = accountQuery.eq("model_id", modelId);

  const [platformsRes, accountsRes, modelsRes] = await Promise.all([
    db.from("platforms").select("id, name, is_active, website_url").order("name"),
    accountQuery.limit(300),
    db.from("models").select("id, stage_name"),
  ]);

  const platforms = orThrow("hermes_platforms", platformsRes);
  const accounts = orThrow("hermes_platforms", accountsRes);
  const names = new Map(orThrow("hermes_platforms", modelsRes).map((m) => [m.id, m.stage_name]));
  const byId = new Map(platforms.map((p) => [p.id, p]));

  const rows: Record<string, unknown>[] = platforms.map((p) => ({
    platform: p.name,
    is_active: p.is_active,
    website_url: p.website_url,
    stage_name: "—",
    username: null,
    status: null,
    platform_fee_percent: null,
  }));
  for (const a of accounts) {
    rows.push({
      platform: byId.get(a.platform_id)?.name ?? "?",
      is_active: byId.get(a.platform_id)?.is_active ?? null,
      website_url: null,
      stage_name: names.get(a.model_id) ?? "?",
      username: a.username,
      status: a.status,
      platform_fee_percent: a.platform_fee_percent,
    });
  }
  return redactToolResult("hermes_platforms", rows);
}

/** Drop the keys a proposal did not name, so `coalesce` means "unchanged". */
function present(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
}

async function proposeOperator(ctx: ToolContext, a: Record<string, unknown>) {
  let operatorId: string | undefined;
  let existing = "";
  if (typeof a.person === "string" && a.person.trim()) {
    const found = await resolveOperator(a.person);
    if (!found.ok) throw new Error(explain(found, "team members"));
    operatorId = found.value.id;
    existing = `${found.value.staffRole.replace("_", " ")} ${found.value.label}`;
  }

  const fields = validate(operatorProposal, present(a));
  if (!operatorId && (!fields.display_name || !fields.legal_name)) {
    throw new Error("A new team member needs a display name and a legal name.");
  }

  const payload = { ...present(fields), ...(operatorId ? { operator_id: operatorId } : {}) };
  const changed = describeChanges(payload, ["operator_id"]);
  return operatorId
    ? propose(
        ctx,
        "upsert_operator",
        payload,
        `Update ${existing} — change ${changed}?`,
        `Изменить ${existing} — ${changed}?`,
      )
    : propose(
        ctx,
        "upsert_operator",
        payload,
        `Add ${fields.staff_role ?? "operator"} ${fields.display_name} to the team?`,
        `Добавить в команду (${fields.staff_role ?? "operator"}): ${fields.display_name}?`,
      );
}

async function proposePlatform(ctx: ToolContext, a: Record<string, unknown>) {
  let platformId: string | undefined;
  let existing = "";
  if (typeof a.platform === "string" && a.platform.trim()) {
    const found = await resolvePlatform(a.platform);
    if (!found.ok) throw new Error(explain(found, "platforms"));
    platformId = found.value.id;
    existing = found.value.label;
  }

  const fields = validate(platformProposal, present(a));
  if (!platformId && !fields.name) throw new Error("A new platform needs a name.");

  const payload = { ...present(fields), ...(platformId ? { platform_id: platformId } : {}) };
  const changed = describeChanges(payload, ["platform_id"]);
  return platformId
    ? propose(
        ctx,
        "upsert_platform",
        payload,
        `Update platform ${existing} — change ${changed}?`,
        `Изменить площадку ${existing} — ${changed}?`,
      )
    : propose(
        ctx,
        "upsert_platform",
        payload,
        `Add platform ${fields.name}?`,
        `Добавить площадку ${fields.name}?`,
      );
}

async function proposeAccount(ctx: ToolContext, a: Record<string, unknown>) {
  const model = await resolveModel(String(a.model ?? ""));
  if (!model.ok) throw new Error(explain(model, "models"));
  const platform = await resolvePlatform(String(a.platform ?? ""));
  if (!platform.ok) throw new Error(explain(platform, "platforms"));

  const fields = validate(accountProposal, present(a));

  // Changing an existing account is opt-in and names WHICH one. Anything else
  // creates; the wrapper's uniqueness check then refuses a duplicate rather
  // than this path silently editing a row nobody pointed at.
  if (typeof a.existing_username === "string" && a.existing_username.trim()) {
    const acct = await resolveAccount(model.value.label, platform.value.label);
    if (!acct.ok) throw new Error(explain(acct, "accounts"));
    const payload = { account_id: acct.value.id, ...present(fields) };
    const changed = describeChanges(payload, ["account_id"]);
    return propose(
      ctx,
      "upsert_account",
      payload,
      `Update ${model.value.label}'s ${platform.value.label} account — change ${changed}?`,
      `Изменить аккаунт ${model.value.label} на ${platform.value.label} — ${changed}?`,
    );
  }

  if (!fields.username) throw new Error("A new account needs a username.");
  const payload = {
    model_id: model.value.id,
    platform_id: platform.value.id,
    ...present(fields),
  };
  return propose(
    ctx,
    "upsert_account",
    payload,
    `Add ${platform.value.label} account @${fields.username} for ${model.value.label}${
      fields.platform_fee_percent != null ? `, ${fields.platform_fee_percent}% platform fee` : ""
    }?`,
    `Добавить аккаунт @${fields.username} на ${platform.value.label} для ${model.value.label}?`,
  );
}

async function proposeAssignment(ctx: ToolContext, a: Record<string, unknown>) {
  const person = await resolveOperator(String(a.person ?? ""));
  if (!person.ok) throw new Error(explain(person, "team members"));
  const model = await resolveModel(String(a.model ?? ""));
  if (!model.ok) throw new Error(explain(model, "models"));

  const fields = validate(assignmentProposal, present(a));

  if (a.change_existing === true) {
    const rows = orThrow(
      "hermes_propose_assignment",
      await getAdminClient()
        .from("operator_assignments")
        .select("id, assigned_from")
        .eq("operator_id", person.value.id)
        .eq("model_id", model.value.id)
        .order("assigned_from", { ascending: false })
        .limit(5),
    );
    if (!rows.length) throw new Error(`${person.value.label} is not attached to ${model.value.label}.`);
    if (rows.length > 1) {
      throw new Error(
        `${person.value.label} has several attachments to ${model.value.label} — which start date? ${rows
          .map((r) => String(r.assigned_from))
          .join(", ")}`,
      );
    }
    const payload = { assignment_id: rows[0]!.id, ...present(fields) };
    const changed = describeChanges(payload, ["assignment_id"]);
    return propose(
      ctx,
      "upsert_assignment",
      payload,
      `Change ${person.value.label}'s work with ${model.value.label} — ${changed}?`,
      `Изменить работу ${person.value.label} с ${model.value.label} — ${changed}?`,
    );
  }

  if (!fields.assigned_from) throw new Error("A new assignment needs a start date.");
  const share = fields.pool_share_percent ?? 100;
  const payload = {
    operator_id: person.value.id,
    model_id: model.value.id,
    pool_share_percent: share,
    assigned_from: fields.assigned_from,
    ...(fields.assigned_to ? { assigned_to: fields.assigned_to } : {}),
  };
  return propose(
    ctx,
    "upsert_assignment",
    payload,
    `Put ${person.value.staffRole.replace("_", " ")} ${person.value.label} on ${
      model.value.label
    } at ${share}% of her team pool, from ${fields.assigned_from}?`,
    `Назначить ${person.value.label} на ${model.value.label} — ${share}% командного пула, с ${fields.assigned_from}?`,
  );
}

/** The retirement path. There is no delete here, deliberately. */
async function proposeArchive(ctx: ToolContext, a: Record<string, unknown>) {
  const kind = String(a.kind ?? "");
  const name = String(a.name ?? "");
  let recordId = "";
  let what = "";
  let status = typeof a.status === "string" ? a.status : "";

  if (kind === "model") {
    const m = await resolveModel(name);
    if (!m.ok) throw new Error(explain(m, "models"));
    recordId = m.value.id;
    what = `model ${m.value.label}`;
    status = status || "terminated";
  } else if (kind === "operator") {
    const o = await resolveOperator(name);
    if (!o.ok) throw new Error(explain(o, "team members"));
    recordId = o.value.id;
    what = `${o.value.staffRole.replace("_", " ")} ${o.value.label}`;
    status = status || "terminated";
  } else if (kind === "platform") {
    const p = await resolvePlatform(name);
    if (!p.ok) throw new Error(explain(p, "platforms"));
    recordId = p.value.id;
    what = `platform ${p.value.label}`;
    status = status || "inactive";
  } else if (kind === "account") {
    const acct = await resolveAccount(name, typeof a.platform === "string" ? a.platform : undefined);
    if (!acct.ok) throw new Error(explain(acct, "accounts"));
    recordId = acct.value.id;
    what = `account ${acct.value.label}`;
    status = status || "closed";
  } else {
    throw new Error("I can retire a model, a team member, a platform or an account.");
  }

  return propose(
    ctx,
    "set_status",
    { kind, record_id: recordId, status },
    `Retire ${what} — set status to ${status}? Their history and past earnings stay.`,
    `Перевести в архив: ${what} — статус «${status}»? История и прошлые доходы сохраняются.`,
  );
}

async function proposeScheme(ctx: ToolContext, a: Record<string, unknown>) {
  const db = getAdminClient();
  let modelId: string | null = null;
  let accountId: string | null = null;
  let scope = "the studio default";

  if (typeof a.model === "string" && a.model.trim()) {
    const m = await resolveModel(a.model);
    if (!m.ok) throw new Error(explain(m, "models"));
    if (typeof a.platform === "string" && a.platform.trim()) {
      const acct = await resolveAccount(m.value.label, a.platform);
      if (!acct.ok) throw new Error(explain(acct, "accounts"));
      accountId = acct.value.id;
      scope = `${m.value.label} on ${acct.value.platform}`;
    } else {
      modelId = m.value.id;
      scope = m.value.label;
    }
  }

  const fields = validate(schemeProposal, present(a));

  if (a.change_existing === true) {
    let q = db.from("commission_schemes").select("id, effective_from");
    q = modelId ? q.eq("model_id", modelId) : q.is("model_id", null);
    q = accountId ? q.eq("platform_account_id", accountId) : q.is("platform_account_id", null);
    const rows = orThrow("hermes_propose_scheme", await q.order("effective_from", { ascending: false }).limit(5));
    if (!rows.length) throw new Error(`There is no scheme for ${scope} yet.`);
    if (rows.length > 1) {
      throw new Error(
        `Several schemes cover ${scope} — which start date? ${rows.map((r) => String(r.effective_from)).join(", ")}`,
      );
    }
    const payload = { scheme_id: rows[0]!.id, ...present(fields) };
    const changed = describeChanges(payload, ["scheme_id"]);
    return propose(
      ctx,
      "upsert_scheme",
      payload,
      `Change the commission scheme for ${scope} — ${changed}?`,
      `Изменить схему комиссии для ${scope} — ${changed}?`,
      "This changes how future earnings are divided. Shares already posted to the ledger are not recalculated.",
    );
  }

  if (
    fields.model_percent === undefined ||
    fields.operator_percent === undefined ||
    fields.studio_percent === undefined
  ) {
    throw new Error("A new scheme needs all three percentages: model, team and studio.");
  }
  const payload = {
    ...(modelId ? { model_id: modelId } : {}),
    ...(accountId ? { platform_account_id: accountId } : {}),
    model_percent: fields.model_percent,
    operator_percent: fields.operator_percent,
    studio_percent: fields.studio_percent,
    effective_from: fields.effective_from,
    ...(fields.effective_to ? { effective_to: fields.effective_to } : {}),
  };
  return propose(
    ctx,
    "upsert_scheme",
    payload,
    `New commission scheme for ${scope} from ${fields.effective_from}: model ${fields.model_percent}%, team ${fields.operator_percent}%, studio ${fields.studio_percent}%?`,
    `Новая схема комиссии для ${scope} с ${fields.effective_from}: модель ${fields.model_percent}%, команда ${fields.operator_percent}%, студия ${fields.studio_percent}%?`,
    "This decides how future earnings are divided.",
  );
}

async function proposeRateCard(ctx: ToolContext, a: Record<string, unknown>) {
  const db = getAdminClient();
  let modelId: string | null = null;
  let scope = "the studio default";
  if (typeof a.model === "string" && a.model.trim()) {
    const m = await resolveModel(a.model);
    if (!m.ok) throw new Error(explain(m, "models"));
    modelId = m.value.id;
    scope = m.value.label;
  }

  const rates = validate(rateCardProposal, a.rates);

  let q = db.from("commission_schemes").select("id, effective_from");
  q = modelId ? q.eq("model_id", modelId) : q.is("model_id", null).is("platform_account_id", null);
  const rows = orThrow("hermes_propose_rate_card", await q.order("effective_from", { ascending: false }).limit(5));
  if (!rows.length) throw new Error(`There is no commission scheme for ${scope} to attach rates to.`);
  if (rows.length > 1) {
    throw new Error(
      `Several schemes cover ${scope} — which start date? ${rows.map((r) => String(r.effective_from)).join(", ")}`,
    );
  }

  // Name the rates on the card. "Replace the rate card" is not something a
  // person can approve; the actual brackets are.
  const summary = rates
    .map((r) => `${r.party.replace(/_/g, " ")} from $${r.min_amount}: ${r.percent}%`)
    .join("; ");
  return propose(
    ctx,
    "set_rate_card",
    { scheme_id: rows[0]!.id, rates },
    `Replace the rate card for ${scope} with — ${summary}?`,
    `Заменить тарифную сетку для ${scope} на — ${summary}?`,
    "This REPLACES every rate on that scheme, not just the ones listed.",
  );
}

async function proposeApprovePayout(ctx: ToolContext, a: Record<string, unknown>) {
  const db = getAdminClient();
  const name = String(a.payee ?? "");

  // A payout names its payee by (payee_type, payee_id), so try both directories
  // rather than assuming a model. A team member is paid the same way.
  const model = await resolveModel(name);
  const person = model.ok ? null : await resolveOperator(name);
  if (!model.ok && !person?.ok) throw new Error(explain(model, "models or team members"));

  const payeeId = model.ok ? model.value.id : person!.ok ? person!.value.id : "";
  const label = model.ok ? model.value.label : person!.ok ? person!.value.label : name;

  let q = db
    .from("payouts")
    .select("id, period_start, period_end, net_amount, currency, created_by")
    .eq("payee_id", payeeId)
    .eq("status", "pending");
  if (typeof a.period_end === "string") q = q.eq("period_end", a.period_end);
  const rows = orThrow("hermes_propose_approve_payout", await q.limit(5));

  if (!rows.length) throw new Error(`${label} has no payout waiting for approval.`);
  if (rows.length > 1) {
    throw new Error(
      `${label} has several payouts waiting — which period? ${rows.map((r) => String(r.period_end)).join(", ")}`,
    );
  }
  const row = rows[0]!;

  // WHO CREATED IT belongs on the card. This action relaxes the split that
  // used to guarantee two different people were involved, so the one thing the
  // approver must be able to see is whether that is still true here.
  const creator = orThrow(
    "hermes_propose_approve_payout",
    await db.from("profiles").select("full_name").eq("id", row.created_by).limit(1),
  );
  const by = creator[0]?.full_name ?? "unknown";

  return propose(
    ctx,
    "approve_payout",
    { payout_id: row.id },
    `Approve the payout to ${label}: ${row.net_amount} ${row.currency}, ${row.period_start} to ${row.period_end}, created by ${by}?`,
    `Утвердить выплату ${label}: ${row.net_amount} ${row.currency}, ${row.period_start} — ${row.period_end}, создал(а) ${by}?`,
    "Approving authorises the payment. Releasing the money is still a separate step in the app.",
  );
}

/* ======================================================================== *
 * Full access (032): the rest of the system.
 *
 * Reads bind to the app's own views and reuse its projections where the rows
 * match (`TOOL_PROJECTION`), so the bot can never see a shape the app did not
 * already define. Proposes follow the one rule that has held since 029: this
 * file NEVER writes — it validates, resolves names, and queues a card.
 * ======================================================================== */

/** Months-ago cutoff as YYYY-MM-DD, clamped to something sane. */
function monthsAgo(n: unknown, fallback: number): string {
  const m = typeof n === "number" && Number.isFinite(n) ? Math.max(1, Math.min(24, n)) : fallback;
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - m);
  return d.toISOString().slice(0, 10);
}

async function nameMaps() {
  const db = getAdminClient();
  const [models, platforms] = await Promise.all([
    db.from("models").select("id, stage_name"),
    db.from("platforms").select("id, name"),
  ]);
  return {
    model: new Map(orThrow("hermes_names", models).map((m) => [m.id, m.stage_name])),
    platform: new Map(orThrow("hermes_names", platforms).map((p) => [p.id, p.name])),
  };
}

async function readEarnings(args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const db = getAdminClient();
  let q = db.from("v_earnings_monthly").select("model_id, platform_id, month, gross_amount, net_amount");
  if (typeof args.model === "string" && args.model.trim()) {
    const m = await resolveModel(args.model);
    if (!m.ok) throw new Error(explain(m, "models"));
    q = q.eq("model_id", m.value.id);
  }
  const [rows, names] = await Promise.all([
    q.gte("month", monthsAgo(args.months, 3)).order("month", { ascending: false }).limit(300),
    nameMaps(),
  ]);
  return redactToolResult(
    projectionFor("hermes_earnings"),
    orThrow("hermes_earnings", rows).map((r) => ({
      month: r.month,
      stage_name: names.model.get(r.model_id ?? "") ?? "?",
      platform: names.platform.get(r.platform_id ?? "") ?? "?",
      gross_amount: r.gross_amount,
      net_amount: r.net_amount,
    })),
  );
}

async function readSessions(args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const db = getAdminClient();
  let q = db.from("v_sessions_hours_monthly").select("model_id, month, hours, session_count");
  if (typeof args.model === "string" && args.model.trim()) {
    const m = await resolveModel(args.model);
    if (!m.ok) throw new Error(explain(m, "models"));
    q = q.eq("model_id", m.value.id);
  }
  const [rows, names] = await Promise.all([
    q.gte("month", monthsAgo(args.months, 3)).order("month", { ascending: false }).limit(300),
    nameMaps(),
  ]);
  return redactToolResult(
    projectionFor("hermes_sessions"),
    orThrow("hermes_sessions", rows).map((r) => ({
      month: r.month,
      stage_name: names.model.get(r.model_id ?? "") ?? "?",
      hours: r.hours,
      session_count: r.session_count,
    })),
  );
}

async function readExpenses(args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const rows = orThrow(
    "hermes_expenses",
    await getAdminClient()
      .from("expenses")
      .select("incurred_on, vendor, amount, currency, category")
      .gte("incurred_on", monthsAgo(args.months, 3))
      .order("incurred_on", { ascending: false })
      .limit(200),
  );
  return redactToolResult(projectionFor("hermes_expenses"), rows);
}

async function readPayoutHistory(args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const db = getAdminClient();
  let q = db
    .from("v_payout_history")
    .select("payee_name, payee_type, payee_id, period_start, period_end, net_amount, currency, status, paid_at");
  if (typeof args.payee === "string" && args.payee.trim()) {
    const model = await resolveModel(args.payee);
    const person = model.ok ? null : await resolveOperator(args.payee);
    if (!model.ok && !person?.ok) throw new Error(explain(model, "models or team members"));
    q = q.eq("payee_id", model.ok ? model.value.id : person!.ok ? person!.value.id : "");
  }
  if (typeof args.status === "string") {
    q = q.eq("status", args.status as "pending" | "approved" | "paid" | "cancelled");
  }
  const rows = orThrow(
    "hermes_payout_history",
    await q.order("period_end", { ascending: false }).limit(100),
  );
  return redactToolResult(projectionFor("hermes_payout_history"), rows);
}

async function readLedger(args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const db = getAdminClient();
  const name = String(args.payee ?? "");
  const model = await resolveModel(name);
  const person = model.ok ? null : await resolveOperator(name);
  if (!model.ok && !person?.ok) throw new Error(explain(model, "models or team members"));

  const { data, error } = await db.rpc("fn_payee_statement", {
    p_payee_type: model.ok ? "model" : "operator",
    p_payee_id: model.ok ? model.value.id : person!.ok ? person!.value.id : "",
    p_from: typeof args.from === "string" ? args.from : monthsAgo(undefined, 3),
    p_to: typeof args.to === "string" ? args.to : new Date().toISOString().slice(0, 10),
  });
  if (error) throw new Error(`statement lookup failed: ${error.message}`);
  return redactToolResult(projectionFor("hermes_ledger"), (data ?? []) as Record<string, unknown>[]);
}

async function readForecast(): Promise<Record<string, unknown>[]> {
  const db = getAdminClient();
  const [forecastRes, accuracyRes, names] = await Promise.all([
    db.from("v_earnings_forecast").select("target_month, model_id, platform_id, predicted_net").limit(120),
    db
      .from("v_forecast_accuracy")
      .select("target_month, model_id, predicted_net, actual_net, error_percent")
      .order("target_month", { ascending: false })
      .limit(60),
    nameMaps(),
  ]);
  // Two projections, both registered: predictions leave as `forecast`,
  // measured accuracy as `forecast_accuracy` — concatenated after redaction,
  // so each row set passes its own allowlist.
  const forecast = redactToolResult(
    projectionFor("hermes_forecast"),
    orThrow("hermes_forecast", forecastRes).map((r) => ({
      target_month: r.target_month,
      stage_name: r.model_id ? (names.model.get(r.model_id!) ?? "?") : "studio",
      platform: r.platform_id ? (names.platform.get(r.platform_id!) ?? "?") : "all",
      predicted_net: r.predicted_net,
    })),
  );
  const accuracy = redactToolResult(
    "forecast_accuracy",
    orThrow("hermes_forecast", accuracyRes).map((r) => ({
      target_month: r.target_month,
      stage_name: r.model_id ? (names.model.get(r.model_id!) ?? "?") : "studio",
      predicted_net: r.predicted_net,
      actual_net: r.actual_net,
      error_percent: r.error_percent,
    })),
  );
  return [...forecast, ...accuracy];
}

async function readSchemes(): Promise<Record<string, unknown>[]> {
  const db = getAdminClient();
  const [schemesRes, ratesRes, names, accounts] = await Promise.all([
    db
      .from("commission_schemes")
      .select(
        "id, model_id, platform_account_id, model_percent, operator_percent, studio_percent, effective_from, effective_to",
      )
      .order("effective_from", { ascending: false })
      .limit(100),
    db.from("commission_rates").select("scheme_id"),
    nameMaps(),
    db.from("platform_accounts").select("id, model_id, platform_id"),
  ]);
  const withCard = new Set(orThrow("hermes_schemes", ratesRes).map((r) => r.scheme_id));
  const accountLabel = new Map(
    orThrow("hermes_schemes", accounts).map((a) => [
      a.id,
      `${names.model.get(a.model_id) ?? "?"} on ${names.platform.get(a.platform_id) ?? "?"}`,
    ]),
  );
  return redactToolResult(
    projectionFor("hermes_schemes"),
    orThrow("hermes_schemes", schemesRes).map((s) => ({
      scope: s.model_id
        ? (names.model.get(s.model_id) ?? "?")
        : s.platform_account_id
          ? (accountLabel.get(s.platform_account_id) ?? "?")
          : "studio default",
      model_percent: s.model_percent,
      operator_percent: s.operator_percent,
      studio_percent: s.studio_percent,
      effective_from: s.effective_from,
      effective_to: s.effective_to,
      has_rate_card: withCard.has(s.id),
    })),
  );
}

/**
 * One person's identity and contact details — the deliberate exception.
 *
 * The redactor's `PROJECTION_UNBLOCK` lets exactly this tool carry the fields
 * `BLOCKED_KEYS` strips everywhere else, by owner decision: Alina asked for
 * full access, and "what is her phone number" is a real question the studio
 * answers daily. `payment_details` (bank data) rides only when the question
 * explicitly asked for it AND the asker is super_admin — a second explicit
 * ask, never part of a casual profile answer.
 */
async function readPersonDetails(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const db = getAdminClient();
  const name = String(args.person ?? "");
  const includeBank = args.include_payment_details === true && ctx.role === "super_admin";

  const model = await resolveModel(name);
  if (model.ok) {
    const rows = orThrow(
      "hermes_person_details",
      await db
        .from("models")
        .select(
          "stage_name, legal_name, date_of_birth, email, phone, country, start_date, status, commission_percent",
        )
        .eq("id", model.value.id)
        .limit(1),
    );
    return redactToolResult(
      projectionFor("hermes_person_details"),
      rows.map((r) => ({ ...r, kind: "model" })),
    );
  }

  const person = await resolveOperator(name);
  if (!person.ok) throw new Error(explain(person, "models or team members"));
  const rows = orThrow(
    "hermes_person_details",
    await db
      .from("operators")
      .select(
        "display_name, staff_role, legal_name, email, phone, country, start_date, status, payment_details",
      )
      .eq("id", person.value.id)
      .limit(1),
  );
  return redactToolResult(
    projectionFor("hermes_person_details"),
    rows.map((r) => ({
      ...r,
      kind: "team member",
      payment_details: includeBank ? r.payment_details : undefined,
    })),
  );
}

/** Resolve "who gets paid" to the polymorphic payee pair. */
async function resolvePayee(
  name: string,
): Promise<{ type: "model" | "operator"; id: string; label: string }> {
  const model = await resolveModel(name);
  if (model.ok) return { type: "model", id: model.value.id, label: model.value.label };
  const person = await resolveOperator(name);
  if (!person.ok) throw new Error(explain(person, "models or team members"));
  return { type: "operator", id: person.value.id, label: person.value.label };
}

async function proposePayout(ctx: ToolContext, a: Record<string, unknown>) {
  const payee = await resolvePayee(String(a.payee ?? ""));
  const fields = validate(payoutProposal, present(a));
  const payload = {
    payee_type: payee.type,
    payee_id: payee.id,
    period_start: fields.period_start,
    period_end: fields.period_end,
    net_amount: fields.net_amount,
    ...(fields.gross_amount !== undefined ? { gross_amount: fields.gross_amount } : {}),
    ...(fields.deductions !== undefined ? { deductions: fields.deductions } : {}),
    ...(fields.currency ? { currency: fields.currency } : {}),
  };
  return propose(
    ctx,
    "create_payout",
    payload,
    `Create a payout for ${payee.label}: ${fields.net_amount} ${fields.currency ?? "USD"} net, ${fields.period_start} to ${fields.period_end}? It lands as pending and still needs approval.`,
    `Создать выплату для ${payee.label}: ${fields.net_amount} ${fields.currency ?? "USD"} нетто, ${fields.period_start} — ${fields.period_end}? Она будет ожидать утверждения.`,
  );
}

/** Find one payout in a given status for a payee, refusing ambiguity. */
async function findPayout(
  payeeName: string,
  statuses: readonly string[],
  periodEnd: unknown,
): Promise<{ id: string; label: string; status: string; net: string; currency: string; period: string }> {
  const payee = await resolvePayee(payeeName);
  let q = getAdminClient()
    .from("payouts")
    .select("id, status, period_start, period_end, net_amount, currency")
    .eq("payee_type", payee.type)
    .eq("payee_id", payee.id)
    .in("status", statuses as ("pending" | "approved" | "paid" | "cancelled")[]);
  if (typeof periodEnd === "string") q = q.eq("period_end", periodEnd);
  const rows = orThrow("hermes_payouts", await q.limit(5));

  if (!rows.length) {
    throw new Error(`${payee.label} has no ${statuses.join("/")} payout${typeof periodEnd === "string" ? " for that period" : ""}.`);
  }
  if (rows.length > 1) {
    throw new Error(
      `${payee.label} has several — which period? ${rows.map((r) => String(r.period_end)).join(", ")}`,
    );
  }
  const row = rows[0]!;
  return {
    id: row.id,
    label: payee.label,
    status: String(row.status),
    net: String(row.net_amount),
    currency: String(row.currency),
    period: `${row.period_start} to ${row.period_end}`,
  };
}

async function proposeMarkPaid(ctx: ToolContext, a: Record<string, unknown>) {
  const p = await findPayout(String(a.payee ?? ""), ["approved"], a.period_end);
  const payload = {
    payout_id: p.id,
    ...(typeof a.reference === "string" ? { reference: a.reference } : {}),
    ...(typeof a.payment_method === "string" ? { payment_method: a.payment_method } : {}),
  };
  return propose(
    ctx,
    "mark_payout_paid",
    payload,
    `Mark ${p.label}'s payout as PAID: ${p.net} ${p.currency}, ${p.period}?`,
    `Отметить выплату ${p.label} как ВЫПЛАЧЕННУЮ: ${p.net} ${p.currency}, ${p.period}?`,
    "This records the money as RELEASED and posts a permanent settlement entry to the ledger. It cannot be undone — only adjusted.",
  );
}

async function proposeCancelPayout(ctx: ToolContext, a: Record<string, unknown>) {
  const p = await findPayout(String(a.payee ?? ""), ["pending", "approved"], a.period_end);
  return propose(
    ctx,
    "cancel_payout",
    { payout_id: p.id },
    `Cancel the ${p.status} payout to ${p.label}: ${p.net} ${p.currency}, ${p.period}?`,
    `Отменить выплату (${p.status}) для ${p.label}: ${p.net} ${p.currency}, ${p.period}?`,
  );
}

async function proposeDeleteDocument(ctx: ToolContext, a: Record<string, unknown>) {
  const doc = await resolveDocument(
    String(a.document ?? ""),
    typeof a.model === "string" ? a.model : undefined,
  );
  if (!doc.ok) throw new Error(explain(doc, "documents"));
  return propose(
    ctx,
    "delete_document",
    { document_id: doc.value.id },
    `PERMANENTLY delete ${doc.value.owner}'s document "${doc.value.label}" — the record and the stored file?`,
    `БЕЗВОЗВРАТНО удалить документ «${doc.value.label}» (${doc.value.owner}) — запись и сам файл?`,
    "The file is removed from storage. If it is her only copy of an identity document, it is gone.",
  );
}

/**
 * The hard-delete path. The DB wrapper re-checks everything post-tap; the
 * dry-run counts here surface the same refusals BEFORE a card is queued, so
 * Alina hears "she has 12 earnings and 3 documents" in conversation instead
 * of tapping Approve on something that cannot happen.
 */
async function proposeDeleteEntity(ctx: ToolContext, a: Record<string, unknown>) {
  const db = getAdminClient();
  const kind = String(a.kind ?? "");
  const name = String(a.name ?? a.model ?? "");
  let recordId = "";
  let what = "";
  let extra = "";

  if (kind === "model") {
    const m = await resolveModel(name);
    if (!m.ok) throw new Error(explain(m, "models"));
    recordId = m.value.id;
    what = `model ${m.value.label}`;
    const [led, docs, accts, sess] = await Promise.all([
      db.from("ledger_entries").select("id", { count: "exact", head: true }).eq("payee_type", "model").eq("payee_id", recordId),
      db.from("documents").select("id", { count: "exact", head: true }).eq("model_id", recordId),
      db.from("platform_accounts").select("id", { count: "exact", head: true }).eq("model_id", recordId),
      db.from("work_sessions").select("id", { count: "exact", head: true }).eq("model_id", recordId),
    ]);
    if ((led.count ?? 0) > 0 || (docs.count ?? 0) > 0) {
      throw new Error(
        `${m.value.label} has ${led.count ?? 0} ledger entries and ${docs.count ?? 0} documents — she cannot be deleted. Archive her instead, or resolve those first.`,
      );
    }
    extra = ` This also deletes her ${accts.count ?? 0} accounts and ${sess.count ?? 0} sessions.`;
  } else if (kind === "operator") {
    const o = await resolveOperator(name);
    if (!o.ok) throw new Error(explain(o, "team members"));
    recordId = o.value.id;
    what = `${o.value.staffRole.replace("_", " ")} ${o.value.label}`;
  } else if (kind === "platform") {
    const pf = await resolvePlatform(name);
    if (!pf.ok) throw new Error(explain(pf, "platforms"));
    recordId = pf.value.id;
    what = `platform ${pf.value.label}`;
  } else if (kind === "account") {
    const acct = await resolveAccount(name, typeof a.platform === "string" ? a.platform : undefined);
    if (!acct.ok) throw new Error(explain(acct, "accounts"));
    recordId = acct.value.id;
    what = `account ${acct.value.label}`;
  } else if (kind === "assignment") {
    const person = await resolveOperator(name);
    if (!person.ok) throw new Error(explain(person, "team members"));
    const model = await resolveModel(String(a.model ?? ""));
    if (!model.ok) throw new Error(explain(model, "models"));
    const rows = orThrow(
      "hermes_propose_delete_entity",
      await db
        .from("operator_assignments")
        .select("id, assigned_from")
        .eq("operator_id", person.value.id)
        .eq("model_id", model.value.id)
        .limit(5),
    );
    if (!rows.length) throw new Error(`${person.value.label} is not attached to ${model.value.label}.`);
    if (rows.length > 1) {
      throw new Error(
        `Several attachments — which start date? ${rows.map((r) => String(r.assigned_from)).join(", ")}`,
      );
    }
    recordId = rows[0]!.id;
    what = `${person.value.label}'s attachment to ${model.value.label}`;
    extra = " Re-running a past period's close after this may divide that period differently.";
  } else if (kind === "scheme" || kind === "rate_card") {
    let q = db.from("commission_schemes").select("id, effective_from");
    if (typeof a.model === "string" && a.model.trim()) {
      const m = await resolveModel(a.model);
      if (!m.ok) throw new Error(explain(m, "models"));
      q = q.eq("model_id", m.value.id);
      what = `${kind === "scheme" ? "the commission scheme" : "the rate card"} for ${m.value.label}`;
    } else {
      q = q.is("model_id", null).is("platform_account_id", null);
      what = kind === "scheme" ? "the studio default scheme" : "the studio default rate card";
    }
    const rows = orThrow("hermes_propose_delete_entity", await q.order("effective_from", { ascending: false }).limit(5));
    if (!rows.length) throw new Error("No scheme matches that.");
    if (rows.length > 1) {
      throw new Error(`Several schemes — which start date? ${rows.map((r) => String(r.effective_from)).join(", ")}`);
    }
    recordId = rows[0]!.id;
    if (kind === "scheme") {
      extra = " Its rate card is deleted with it — future earnings then divide by whichever scheme takes its place.";
    } else {
      extra = " Without brackets, the scheme's flat three-way split applies to future earnings.";
    }
  } else if (kind === "payout") {
    const p = await findPayout(name, ["pending", "cancelled"], a.period_end);
    recordId = p.id;
    what = `the ${p.status} payout to ${p.label} (${p.net} ${p.currency}, ${p.period})`;
  } else {
    throw new Error(
      "I can permanently delete: model, operator, platform, account, assignment, scheme, rate_card, payout. The ledger and audit history can never be deleted.",
    );
  }

  return propose(
    ctx,
    "delete_entity",
    { kind: kind === "rate_card" ? "rate_card" : kind, record_id: recordId },
    `PERMANENTLY delete ${what}?${extra} This cannot be undone.`,
    `БЕЗВОЗВРАТНО удалить: ${what}?${extra ? " " + extra : ""} Это действие необратимо.`,
    "Prefer archiving — it keeps history. Deletion is final and is itself recorded in the audit log.",
  );
}

async function proposeClosePeriod(ctx: ToolContext, a: Record<string, unknown>) {
  const fields = validate(periodProposal, present(a));
  return propose(
    ctx,
    "close_period",
    { period_start: fields.period_start, period_end: fields.period_end },
    `Close the period ${fields.period_start} to ${fields.period_end} — post every share of its earnings to the ledger?`,
    `Закрыть период ${fields.period_start} — ${fields.period_end} и провести все доли по журналу?`,
    "Posted shares are permanent ledger entries; corrections afterwards are adjustments.",
  );
}

async function proposeSnapshotForecast(ctx: ToolContext, a: Record<string, unknown>) {
  const months = a.months_ahead === undefined ? 3 : validate(monthsAheadProposal, a.months_ahead);
  return propose(
    ctx,
    "snapshot_forecast",
    { months_ahead: months },
    `Save a forecast snapshot ${months} months ahead?`,
    `Сохранить срез прогноза на ${months} мес. вперёд?`,
  );
}

/* ======================================================================== *
 * Documents by Telegram (033) + semantic search.
 * ======================================================================== */

/**
 * File the attachment sitting in this chat as a compliance document.
 *
 * The card carries the metadata; the payload carries Telegram's file_id. The
 * bytes move only AFTER the Approve tap — the executor downloads from
 * Telegram, stores into the private bucket, and only then writes the row. A
 * rejected card costs nothing and stores nothing.
 */
async function proposeUploadDocument(ctx: ToolContext, a: Record<string, unknown>) {
  const att = ctx.attachment;
  if (!att) {
    throw new Error(
      "There is no file waiting in this chat — send the document (photo or file) first, ideally with a caption saying whose it is.",
    );
  }
  if (!isAllowedMime(att.mimeType)) {
    throw new Error(
      `That file type (${att.mimeType}) isn't accepted — send a PDF, a photo/scan, or an office document.`,
    );
  }
  if (att.sizeBytes > TELEGRAM_MAX_FILE_BYTES) {
    throw new Error(
      "That file is over Telegram's 20 MB bot limit — upload it through the portal instead.",
    );
  }

  const model = await resolveModel(String(a.model ?? ""));
  if (!model.ok) throw new Error(explain(model, "models"));

  const meta = validate(documentUploadProposal, present(a));

  // The card names the FILE and its AGE, not just the metadata: the review's
  // sharpest finding was a stale attachment (sent minutes ago, never filed)
  // silently becoming "Vera's contract" when the file Alina meant never
  // arrived. The approver can catch that mismatch only if the card shows
  // which file, from when.
  const ageMin = att.receivedAt ? Math.round((Date.now() - att.receivedAt) / 60_000) : 0;
  const ageEn = ageMin >= 2 ? `, sent ${ageMin} min ago` : "";
  const ageRu = ageMin >= 2 ? `, отправлен ${ageMin} мин назад` : "";
  const fileLabel = sanitizeFilename(att.fileName);

  const result = await propose(
    ctx,
    "upload_document",
    {
      file_id: att.fileId,
      file_name: att.fileName,
      mime_type: att.mimeType,
      size_bytes: att.sizeBytes,
      model_id: model.value.id,
      title: meta.title,
      doc_type: meta.doc_type ?? "other",
      ...(meta.issued_date ? { issued_date: meta.issued_date } : {}),
      ...(meta.expires_at ? { expires_at: meta.expires_at } : {}),
    },
    `Save the attached file ${fileLabel} (${(att.sizeBytes / 1_048_576).toFixed(1)} MB${ageEn}) as ${model.value.label}'s ${meta.doc_type ?? "other"} document "${meta.title}"${meta.expires_at ? `, expires ${meta.expires_at}` : ""}?`,
    `Сохранить файл ${fileLabel} (${(att.sizeBytes / 1_048_576).toFixed(1)} МБ${ageRu}) как документ (${meta.doc_type ?? "other"}) «${meta.title}» для ${model.value.label}${meta.expires_at ? `, срок до ${meta.expires_at}` : ""}?`,
    "The file is stored in the studio's private document vault. Its contents are NOT sent to the AI provider unless you separately consent later.",
  );

  // Off the shelf: the attachment is spoken for. A later "save this as..."
  // must mean a NEW file, never this one again.
  consumeAttachment(ctx.chatId);
  return result;
}

/**
 * Semantic search over the embedding index — scrubbed notes, document
 * metadata, platform blurbs. The same `fn_semantic_search` the portal's
 * assistant uses, behind the same registered projection. The query itself is
 * scrubbed before it embeds, because embedding inputs transit the provider
 * like any prompt.
 */
async function searchEverything(args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error("Say what to search for.");

  let vector: number[];
  try {
    vector = await embedQuery(scrubText(query));
  } catch (e) {
    if (e instanceof EmbeddingNotConfiguredError) {
      throw new Error(
        "Semantic search isn't switched on yet — the embedding provider key is missing on the worker.",
      );
    }
    throw e;
  }

  const { data, error } = await getAdminClient().rpc("fn_semantic_search", {
    p_embedding: `[${vector.join(",")}]`,
    p_top_k: typeof args.top_k === "number" ? Math.max(1, Math.min(10, args.top_k)) : 5,
  });
  if (error) throw new Error(`search failed: ${error.message}`);

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) {
    // An empty index reads identically to a miss; say which it is — but only
    // when the probe itself succeeded, and only counting rows the SEARCH can
    // actually see: fn_semantic_search filters by the configured embedding
    // model, so an index built under an old model is "stranded", not "empty",
    // and the difference is exactly what the person needs to hear.
    const activeModel = (await readSetting("ai.embedding.model")) ?? "embedding-3";
    const { count, error: probeError } = await getAdminClient()
      .from("embeddings")
      .select("id", { count: "exact", head: true })
      .eq("embedding_model", activeModel);
    if (!probeError && (count ?? 0) === 0) {
      throw new Error(
        "Nothing is indexed for the current embedding model — run the reindex from the portal's AI page, then search again.",
      );
    }
  }
  return redactToolResult(projectionFor("hermes_search"), rows);
}
