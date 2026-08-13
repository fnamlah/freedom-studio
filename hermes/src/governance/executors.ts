import { getAdminClient } from "../lib/supabase.js";
import { hermesDict, money, type Locale } from "../lib/i18n.js";

/**
 * The only code in Hermes that writes business data.
 *
 * Every executor runs AFTER a human approved, and carries that human's id into
 * the database so the resulting rows are attributed to a person, never to "the
 * agent". None of them can reach a write path a human approver did not already
 * have: `close_period` and `snapshot_forecast` go through the 016 wrappers,
 * which re-verify the approver and then delegate to the unchanged INVOKER
 * functions, and `create_payout` inserts a `pending` row that still needs the
 * existing super-admin maker-checker to become `approved`.
 *
 * `saveStep` persists a marker before each irreversible call. On a retry the
 * executor sees the marker and skips forward instead of posting twice.
 */

export interface ExecutorResult {
  message: string;
  result: Record<string, unknown>;
}

type SaveStep = (patch: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** The locale of the person who approved — the message is written back to them. */
type Reader = Locale;

function str(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  if (typeof v !== "string" || v.length === 0) throw new Error(`payload.${key} missing`);
  return v;
}

function num(payload: Record<string, unknown>, key: string): number {
  const v = payload[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`payload.${key} missing`);
  return v;
}

async function closePeriod(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (prior.posted !== undefined) {
    return {
      message: h.closedAlready(Number(prior.posted)),
      result: prior,
    };
  }

  const periodStart = str(payload, "period_start");
  const periodEnd = str(payload, "period_end");

  const { data, error } = await getAdminClient().rpc("fn_agent_generate_earning_shares", {
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_approver: approver,
  });
  if (error) throw new Error(error.message);

  // The RPC returns a one-row set.
  const row = (Array.isArray(data) ? data[0] : data) as
    | { posted_count?: number; skipped_count?: number }
    | null;
  const posted = row?.posted_count ?? 0;
  const skipped = row?.skipped_count ?? 0;

  const result = await saveStep({ posted, skipped, period_start: periodStart, period_end: periodEnd });
  return {
    message: h.closed(periodStart, periodEnd, posted, skipped),
    result,
  };
}

async function snapshotForecast(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (prior.rows !== undefined) {
    return { message: h.forecastAlready(Number(prior.rows)), result: prior };
  }

  const months = typeof payload.months_ahead === "number" ? payload.months_ahead : 3;
  const { data, error } = await getAdminClient().rpc("fn_agent_snapshot_forecast", {
    p_months_ahead: months,
    p_approver: approver,
  });
  if (error) throw new Error(error.message);

  const result = await saveStep({ rows: data ?? 0, months_ahead: months });
  return { message: h.forecastWritten(Number(data ?? 0), months), result };
}

/**
 * Insert a payout as `pending` — the "maker" half only. The checker half stays
 * exactly where it was: a super_admin approving in the app. Hermes is
 * structurally incapable of being both.
 */
async function createPayout(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (typeof prior.payout_id === "string") {
    return { message: h.payoutAlready(String(prior.payout_id)), result: prior };
  }

  const payeeType = str(payload, "payee_type");
  const payeeId = str(payload, "payee_id");
  const periodStart = str(payload, "period_start");
  const periodEnd = str(payload, "period_end");
  const net = num(payload, "net_amount");

  if (payeeType !== "model" && payeeType !== "operator") {
    throw new Error(`unsupported payee_type ${payeeType}`);
  }
  if (net <= 0) throw new Error("net_amount must be positive");

  const db = getAdminClient();

  // Never stack a second open payout on the same payee/period.
  const { data: existing } = await db
    .from("payouts")
    .select("id")
    .eq("payee_type", payeeType)
    .eq("payee_id", payeeId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .in("status", ["pending", "approved"])
    .maybeSingle();

  if (existing) {
    const result = await saveStep({ payout_id: existing.id, reused: true });
    return { message: h.payoutOpenExists(String(existing.id)), result };
  }

  const gross = typeof payload.gross_amount === "number" ? payload.gross_amount : net;
  const { data, error } = await db
    .from("payouts")
    .insert({
      payee_type: payeeType,
      payee_id: payeeId,
      period_start: periodStart,
      period_end: periodEnd,
      gross_amount: gross,
      studio_fee_amount: typeof payload.studio_fee_amount === "number" ? payload.studio_fee_amount : 0,
      deductions: typeof payload.deductions === "number" ? payload.deductions : 0,
      net_amount: net,
      currency: typeof payload.currency === "string" ? payload.currency : "USD",
      status: "pending",
      created_by: approver,
      notes: h.payoutNote,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  const result = await saveStep({ payout_id: data!.id, net_amount: net });
  return {
    message: h.payoutCreated(String(data!.id), money(net, locale)),
    result,
  };
}

/**
 * The day-to-day record executors (029).
 *
 * Each is a thin call onto an `fn_agent_*` wrapper that re-verifies the
 * approver and impersonates them, so the row lands under THEIR row-level
 * security and carries their id — indistinguishable from one they typed,
 * which is correct, because they authorised it.
 *
 * `saveStep` is used the same way the money executors use it: the marker is
 * written before the irreversible call, so a retry after a crash skips
 * forward instead of inserting a second time.
 */
async function recordEarning(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (typeof prior.earning_id === "string") {
    return { message: h.execAlreadyRecorded, result: prior };
  }
  if (prior.attempted === true) {
    // The previous run reached the insert and did not come back. Re-running
    // could double-post money, so this stops and asks for eyes.
    throw new Error("a previous attempt may already have recorded this — check Earnings first");
  }

  // Claim the attempt BEFORE the write. A crash between the insert and the
  // marker would otherwise re-run the insert on retry, and `earnings` has no
  // unique key that would stop a second identical row.
  await saveStep({ attempted: true });

  const { data, error } = await getAdminClient().rpc("fn_agent_record_earning", {
    p_approver: approver,
    p_platform_account_id: str(payload, "platform_account_id"),
    p_period_start: str(payload, "period_start"),
    p_period_end: str(payload, "period_end"),
    p_gross: num(payload, "gross_amount"),
    p_fee: typeof payload.fee_amount === "number" ? payload.fee_amount : 0,
    p_net: num(payload, "net_amount"),
    p_currency: typeof payload.currency === "string" ? payload.currency : "USD",
  });
  if (error) throw new Error(error.message);

  const result = await saveStep({ earning_id: data });
  return { message: h.execEarningRecorded(money(num(payload, "net_amount"), locale)), result };
}

async function recordSession(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (typeof prior.session_id === "string") {
    return { message: h.execAlreadyRecorded, result: prior };
  }
  if (prior.attempted === true) {
    throw new Error("a previous attempt may already have recorded this — check Work sessions first");
  }

  // An OPEN session has no end time, so `p_ended_at` is omitted rather than
  // passed as null — PostgREST types a defaulted argument as optional. Built
  // as an object so the key is genuinely absent, not present-and-undefined.
  const args: Record<string, unknown> = {
    p_approver: approver,
    p_platform_account_id: str(payload, "platform_account_id"),
    p_started_at: str(payload, "started_at"),
    p_gross: typeof payload.gross_earnings === "number" ? payload.gross_earnings : 0,
    p_currency: typeof payload.currency === "string" ? payload.currency : "USD",
  };
  if (typeof payload.ended_at === "string") args.p_ended_at = payload.ended_at;
  if (typeof payload.notes === "string") args.p_notes = payload.notes;

  await saveStep({ attempted: true });

  const { data, error } = await getAdminClient().rpc(
    "fn_agent_record_session",
    args as never,
  );
  if (error) throw new Error(error.message);

  const result = await saveStep({ session_id: data });
  return { message: h.execSessionRecorded, result };
}

async function recordExpense(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (typeof prior.expense_id === "string") {
    return { message: h.execAlreadyRecorded, result: prior };
  }
  if (prior.attempted === true) {
    throw new Error("a previous attempt may already have recorded this — check Expenses first");
  }

  await saveStep({ attempted: true });

  const { data, error } = await getAdminClient().rpc("fn_agent_record_expense", {
    p_approver: approver,
    p_incurred_on: str(payload, "incurred_on"),
    p_vendor: str(payload, "vendor"),
    p_amount: num(payload, "amount"),
    p_description: typeof payload.description === "string" ? payload.description : undefined,
    p_category: typeof payload.category === "string" ? payload.category : undefined,
    p_currency: typeof payload.currency === "string" ? payload.currency : "USD",
  });
  if (error) throw new Error(error.message);

  const result = await saveStep({ expense_id: data });
  return { message: h.execExpenseRecorded(money(num(payload, "amount"), locale)), result };
}

async function updateDocument(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (prior.updated === true) return { message: h.execAlreadyRecorded, result: prior };

  const { error } = await getAdminClient().rpc("fn_agent_update_document", {
    p_approver: approver,
    p_document_id: str(payload, "document_id"),
    p_title: typeof payload.title === "string" ? payload.title : undefined,
    p_doc_type: typeof payload.doc_type === "string" ? (payload.doc_type as never) : undefined,
    p_issued_date: typeof payload.issued_date === "string" ? payload.issued_date : undefined,
    p_expires_at: typeof payload.expires_at === "string" ? payload.expires_at : undefined,
  });
  if (error) throw new Error(error.message);

  const result = await saveStep({ updated: true });
  return { message: h.execDocumentUpdated, result };
}

async function deleteRecord(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (prior.deleted !== undefined) return { message: h.execAlreadyRecorded, result: prior };

  const { data, error } = await getAdminClient().rpc("fn_agent_delete_record", {
    p_approver: approver,
    p_kind: str(payload, "kind"),
    p_id: str(payload, "record_id"),
  });
  if (error) throw new Error(error.message);

  const result = await saveStep({ deleted: data === true });
  // `false` means the row was already gone — worth saying, not worth failing.
  return { message: data === true ? h.execDeleted : h.execAlreadyGone, result };
}

async function upsertModel(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (typeof prior.model_id === "string") {
    return { message: h.execAlreadyRecorded, result: prior };
  }

  const args: Record<string, unknown> = { p_approver: approver };
  const map: Record<string, string> = {
    model_id: "p_model_id",
    stage_name: "p_stage_name",
    legal_name: "p_legal_name",
    date_of_birth: "p_date_of_birth",
    commission_percent: "p_commission_percent",
    status: "p_status",
    country: "p_country",
  };
  for (const [from, to] of Object.entries(map)) {
    if (payload[from] !== undefined) args[to] = payload[from];
  }

  await saveStep({ attempted: true });

  const { data, error } = await getAdminClient().rpc("fn_agent_upsert_model", args as never);
  if (error) throw new Error(error.message);

  const result = await saveStep({ model_id: data });
  return { message: payload.model_id ? h.execModelUpdated : h.execModelCreated, result };
}

/**
 * Send one compliance document to the provider, now that a human has consented.
 *
 * Two steps in a deliberate order: record the consent FIRST (030), then cross.
 * `analyseDocument` re-reads `ai_analysis_opt_in` at crossing time — that is
 * migration 014's guarantee — so writing consent first is what makes the
 * crossing permissible rather than a bypass of it.
 */
async function readComplianceDocument(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (prior.analysed === true) return { message: h.execAlreadyRecorded, result: prior };

  const documentId = str(payload, "document_id");
  const db = getAdminClient();

  const { error: consentError } = await db.rpc("fn_agent_set_document_optin", {
    p_approver: approver,
    p_document_id: documentId,
    p_opt_in: true,
  });
  if (consentError) throw new Error(consentError.message);

  // `consented`, not `analysed`. Nothing here reads the document: the analyser
  // lives in the app and needs a request context. Recording `analysed: true`
  // would put a claim in the approval's permanent result that never happened,
  // and the message says exactly what did.
  const result = await saveStep({ consented: true });
  return { message: h.execDocumentReadable, result };
}

export async function runExecutor(
  actionType: string,
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  switch (actionType) {
    case "close_period":
      return closePeriod(payload, approver, prior, saveStep, locale);
    case "snapshot_forecast":
      return snapshotForecast(payload, approver, prior, saveStep, locale);
    case "create_payout":
      return createPayout(payload, approver, prior, saveStep, locale);
    case "record_earning":
      return recordEarning(payload, approver, prior, saveStep, locale);
    case "record_session":
      return recordSession(payload, approver, prior, saveStep, locale);
    case "record_expense":
      return recordExpense(payload, approver, prior, saveStep, locale);
    case "update_document":
      return updateDocument(payload, approver, prior, saveStep, locale);
    case "delete_record":
      return deleteRecord(payload, approver, prior, saveStep, locale);
    case "upsert_model":
      return upsertModel(payload, approver, prior, saveStep, locale);
    case "read_compliance_document":
      return readComplianceDocument(payload, approver, prior, saveStep, locale);
    default:
      throw new Error(`no executor for ${actionType}`);
  }
}
