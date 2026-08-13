import { enqueueApproval } from "../governance/approvals.js";
import { resolvePolicy, roleSatisfies } from "../governance/policy.js";
import { todaysCost } from "../lib/cost.js";
import { type Locale } from "../lib/i18n.js";
import { getPolicyValue } from "../lib/policy-kv.js";
import { getAdminClient } from "../lib/supabase.js";
import { escapeHtml, sendApprovalCard } from "../telegram/api.js";
import { PROPOSE_ACTION, TOOL_COMMAND } from "./tool-catalog.js";
import { redactToolResult } from "./redact.js";
import { explain, resolveAccount, resolveDocument, resolveModel } from "./resolve.js";

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
}

/** Month bucket helper for the per-model views. */
function sinceMonths(n: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - Math.max(1, Math.min(24, n)));
  return d.toISOString().slice(0, 10);
}

async function readModelEarnings(args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const db = getAdminClient();
  const model = await resolveModel(String(args.model ?? ""));
  if (!model.ok) throw new Error(explain(model, "models"));

  const since = sinceMonths(typeof args.months === "number" ? args.months : 3);
  const [earn, hours, platforms] = await Promise.all([
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

  const pname = new Map((platforms.data ?? []).map((p) => [p.id, p.name]));
  const hoursByMonth = new Map(
    (hours.data ?? []).map((h) => [String(h.month), h] as const),
  );

  const rows = (earn.data ?? []).map((e) => {
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

  const scheme =
    (schemes.data ?? []).find((s) => s.model_id === model.value.id) ??
    (schemes.data ?? []).find((s) => s.model_id === null);

  const rows: Record<string, unknown>[] = [];

  if (scheme) {
    const { data: rates } = await db
      .from("commission_rates")
      .select("party, min_amount, percent")
      .eq("scheme_id", scheme.id)
      .order("party")
      .order("min_amount");

    if (rates?.length) {
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

  for (const a of assignments.data ?? []) {
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
    .select("id, name, folder_path, ai_summary, ai_key_figures, created_at, doc_categories(name)")
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

  const mname = new Map((models.data ?? []).map((m) => [m.id, m.stage_name]));
  const today = new Date().toISOString().slice(0, 10);
  const expiringOnly = args.expiring === true;

  const rows: Record<string, unknown>[] = [];

  for (const d of docs.data ?? []) {
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
    for (const f of lib.data ?? []) {
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

/** Build the bilingual preview a human reads on the card before tapping. */
function preview(en: string, ru: string, risk?: string): Record<string, unknown> {
  return { summary_en: en, summary_ru: ru, ...(risk ? { risk_en: risk } : {}) };
}

/**
 * Queue an approval and put the card in front of the person who asked.
 *
 * `enqueueApproval` reads `required_role` from ACTION_POLICIES, never from
 * here — the defence against a proposal nominating itself an easier approver.
 */
async function propose(
  ctx: ToolContext,
  actionType: string,
  payload: Record<string, unknown>,
  cardEn: string,
  cardRu: string,
  risk?: string,
): Promise<Record<string, unknown>[]> {
  const id = await enqueueApproval({
    actionType,
    payload,
    preview: preview(cardEn, cardRu, risk),
  });
  const text = ctx.locale === "ru" ? cardRu : cardEn;
  await sendApprovalCard(
    ctx.chatId,
    id,
    [escapeHtml(text), risk ? `<i>${escapeHtml(risk)}</i>` : ""].filter(Boolean).join("\n"),
    ctx.locale,
  ).catch(() => undefined);

  // Projected like any other tool result — "nothing reaches a provider
  // unprojected" holds with no exceptions. It says "waiting" so the model
  // reports a pending decision rather than claiming the record exists.
  return redactToolResult("hermes_proposal", [
    { status: "awaiting_approval", action: actionType },
  ]);
}

const money2 = (v: unknown): number => Math.round(Number(v) * 100) / 100;

async function proposeEarning(ctx: ToolContext, a: Record<string, unknown>) {
  const acct = await resolveAccount(
    String(a.model ?? ""),
    typeof a.platform === "string" ? a.platform : undefined,
  );
  if (!acct.ok) throw new Error(explain(acct, "accounts"));

  const net = money2(a.net_amount);
  const payload = {
    platform_account_id: acct.value.id,
    period_start: String(a.period_start),
    period_end: String(a.period_end),
    gross_amount: money2(a.gross_amount),
    fee_amount: a.fee_amount === undefined ? 0 : money2(a.fee_amount),
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
    ...(a.gross_earnings === undefined ? {} : { gross_earnings: money2(a.gross_earnings) }),
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
  const amount = money2(a.amount);
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

  const payload = {
    ...(modelId ? { model_id: modelId } : {}),
    ...(typeof a.stage_name === "string" ? { stage_name: a.stage_name } : {}),
    ...(typeof a.legal_name === "string" ? { legal_name: a.legal_name } : {}),
    ...(typeof a.date_of_birth === "string" ? { date_of_birth: a.date_of_birth } : {}),
    ...(a.commission_percent === undefined
      ? {}
      : { commission_percent: Number(a.commission_percent) }),
    ...(typeof a.status === "string" ? { status: a.status } : {}),
    ...(typeof a.country === "string" ? { country: a.country } : {}),
  };

  const changed = Object.keys(payload)
    .filter((k) => k !== "model_id")
    .join(", ");
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
        `Add a new model: ${a.stage_name}?`,
        `Добавить новую модель: ${a.stage_name}?`,
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
  const changed = Object.keys(payload).filter((k) => k !== "document_id").join(", ");
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
      const { data } = await q.limit(5);
      if (!data?.length) throw new Error("No earning matches that.");
      if (data.length > 1) throw new Error("Several earnings match — name the exact period.");
      recordId = data[0]!.id;
      what = `${m.value.label} — ${data[0]!.net_amount} net, ${data[0]!.period_start} to ${data[0]!.period_end}`;
    } else {
      const { data } = await db
        .from("work_sessions")
        .select("id, started_at")
        .eq("model_id", m.value.id)
        .order("started_at", { ascending: false })
        .limit(5);
      if (!data?.length) throw new Error("No session matches that.");
      recordId = data[0]!.id;
      what = `${m.value.label} — session starting ${data[0]!.started_at}`;
    }
  } else if (kind === "expense") {
    let q = db.from("expenses").select("id, vendor, amount, incurred_on");
    if (typeof a.vendor === "string") q = q.ilike("vendor", `%${a.vendor}%`);
    if (typeof a.incurred_on === "string") q = q.eq("incurred_on", a.incurred_on);
    const { data } = await q.limit(5);
    if (!data?.length) throw new Error("No expense matches that.");
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
    `Send "${doc.value.label}" to the AI provider so it can be read?`,
    `Отправить «${doc.value.label}» ИИ-провайдеру, чтобы он смог его прочитать?`,
    "This is a compliance document — it may contain a person's identity data. Approving records consent, is audited, and can be revoked in the portal.",
  );
}
