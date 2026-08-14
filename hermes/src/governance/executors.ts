import { createHash } from "node:crypto";

import { MAX_FILE_BYTES, sanitizeFilename } from "../../../src/lib/fields/documents.js";
import { downloadFile, getFile } from "../telegram/api.js";
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

/* ======================================================================== *
 * Setting the studio up (031).
 *
 * Each of these is the same three moves as the executors above: map the
 * payload onto the wrapper's parameters, save an idempotency marker BEFORE the
 * call, then record the resulting id. Only supplied keys are forwarded, which
 * is what makes the wrappers' `coalesce` semantics work — an absent key means
 * "leave it alone", never "set it to null".
 * ======================================================================== */

/** Forward only the keys present, under the wrapper's parameter names. */
function mapArgs(
  payload: Record<string, unknown>,
  approver: string,
  map: Record<string, string>,
): Record<string, unknown> {
  const args: Record<string, unknown> = { p_approver: approver };
  for (const [from, to] of Object.entries(map)) {
    if (payload[from] !== undefined) args[to] = payload[from];
  }
  return args;
}

/**
 * One shape for the five upserts. `idKey` is both the marker this executor
 * replays on and the name the resulting id is stored under, so a retry after a
 * network failure returns the first result rather than creating a twin.
 */
type RpcName = Parameters<ReturnType<typeof getAdminClient>["rpc"]>[0];

function upsertExecutor(
  // Derived from the client rather than widened to `string`: a typo in a
  // function name is then a compile error, and a name the database does not
  // have yet fails HERE rather than at the first Approve tap.
  rpc: RpcName,
  map: Record<string, string>,
  idKey: string,
  existingKey: string,
  message: (h: ReturnType<typeof hermesDict>, updating: boolean) => string,
) {
  return async (
    payload: Record<string, unknown>,
    approver: string,
    prior: Record<string, unknown>,
    saveStep: SaveStep,
    locale: Reader,
  ): Promise<ExecutorResult> => {
    const h = hermesDict(locale);
    if (typeof prior[idKey] === "string") {
      return { message: h.execAlreadyRecorded, result: prior };
    }

    await saveStep({ attempted: true });

    const { data, error } = await getAdminClient().rpc(rpc, mapArgs(payload, approver, map) as never);
    if (error) throw new Error(error.message);

    const result = await saveStep({ [idKey]: data });
    return { message: message(h, payload[existingKey] !== undefined), result };
  };
}

const upsertOperator = upsertExecutor(
  "fn_agent_upsert_operator",
  {
    operator_id: "p_operator_id",
    display_name: "p_display_name",
    legal_name: "p_legal_name",
    staff_role: "p_staff_role",
    email: "p_email",
    phone: "p_phone",
    country: "p_country",
    start_date: "p_start_date",
    notes: "p_notes",
  },
  "operator_id",
  "operator_id",
  (h, updating) => (updating ? h.execTeamUpdated : h.execTeamCreated),
);

const upsertPlatform = upsertExecutor(
  "fn_agent_upsert_platform",
  {
    platform_id: "p_platform_id",
    name: "p_name",
    website_url: "p_website_url",
    is_active: "p_is_active",
  },
  "platform_id",
  "platform_id",
  (h, updating) => (updating ? h.execPlatformUpdated : h.execPlatformCreated),
);

const upsertAccount = upsertExecutor(
  "fn_agent_upsert_account",
  {
    account_id: "p_account_id",
    model_id: "p_model_id",
    platform_id: "p_platform_id",
    username: "p_username",
    platform_fee_percent: "p_fee_percent",
  },
  "account_id",
  "account_id",
  (h, updating) => (updating ? h.execAccountUpdated : h.execAccountCreated),
);

const upsertAssignment = upsertExecutor(
  "fn_agent_upsert_assignment",
  {
    assignment_id: "p_assignment_id",
    operator_id: "p_operator_id",
    model_id: "p_model_id",
    pool_share_percent: "p_pool_share",
    assigned_from: "p_from",
    assigned_to: "p_to",
    clear_end: "p_clear_end",
  },
  "assignment_id",
  "assignment_id",
  (h, updating) => (updating ? h.execAssignmentUpdated : h.execAssignmentCreated),
);

const upsertScheme = upsertExecutor(
  "fn_agent_upsert_scheme",
  {
    scheme_id: "p_scheme_id",
    model_id: "p_model_id",
    platform_account_id: "p_account_id",
    model_percent: "p_model_pct",
    operator_percent: "p_operator_pct",
    studio_percent: "p_studio_pct",
    effective_from: "p_from",
    effective_to: "p_to",
    notes: "p_notes",
  },
  "scheme_id",
  "scheme_id",
  (h, updating) => (updating ? h.execSchemeUpdated : h.execSchemeCreated),
);

async function setStatus(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (prior.changed !== undefined) return { message: h.execAlreadyRecorded, result: prior };

  const { data, error } = await getAdminClient().rpc("fn_agent_set_status", {
    p_approver: approver,
    p_kind: str(payload, "kind"),
    p_id: str(payload, "record_id"),
    p_status: str(payload, "status"),
  });
  if (error) throw new Error(error.message);

  const result = await saveStep({ changed: data === true });
  return { message: data === true ? h.execArchived : h.execAlreadyGone, result };
}

/**
 * Replace a scheme's rate card. `fn_agent_set_rate_card` delegates to 025's
 * `fn_set_commission_rates`, which deletes and re-inserts in one statement, so
 * a retry that lands twice produces the same card rather than a doubled one —
 * the marker is belt-and-braces here rather than the only protection.
 */
async function setRateCard(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (typeof prior.rows === "number") return { message: h.execAlreadyRecorded, result: prior };

  const rates = payload.rates;
  if (!Array.isArray(rates) || rates.length === 0) throw new Error("payload.rates missing");

  const { data, error } = await getAdminClient().rpc("fn_agent_set_rate_card", {
    p_approver: approver,
    p_scheme_id: str(payload, "scheme_id"),
    p_rates: rates as never,
  });
  if (error) throw new Error(error.message);

  const result = await saveStep({ rows: Number(data) });
  return { message: h.execRateCardSet(Number(data)), result };
}

/**
 * Move a payout pending → approved.
 *
 * See `policy.ts` for why this exists at all — it relaxes the origination /
 * authorization split by owner decision. The wrapper refuses anything that is
 * not currently `pending`, so a replayed approval cannot advance a payout that
 * has since been paid or cancelled.
 */
async function approvePayout(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (typeof prior.payout_id === "string") {
    return { message: h.execAlreadyRecorded, result: prior };
  }

  await saveStep({ attempted: true });

  const { data, error } = await getAdminClient().rpc("fn_agent_approve_payout", {
    p_approver: approver,
    p_payout_id: str(payload, "payout_id"),
  });
  if (error) throw new Error(error.message);

  const result = await saveStep({ payout_id: data });
  return { message: h.execPayoutApproved, result };
}

/* ======================================================================== *
 * Full access (032): settlement, cancellation, document + entity deletion.
 * ======================================================================== */

async function markPayoutPaid(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (typeof prior.payout_id === "string") {
    return { message: h.execAlreadyRecorded, result: prior };
  }

  await saveStep({ attempted: true });

  // Status flip only — `payout_paid_settlement` (007) posts the one settlement
  // ledger entry under the approver's claims, and its unique index makes a
  // replayed execution a no-op rather than a double credit.
  const { data, error } = await getAdminClient().rpc("fn_agent_mark_payout_paid", {
    p_approver: approver,
    p_payout_id: str(payload, "payout_id"),
    p_reference: typeof payload.reference === "string" ? payload.reference : undefined,
    p_method: typeof payload.payment_method === "string" ? payload.payment_method : undefined,
  });
  if (error) throw new Error(error.message);

  const result = await saveStep({ payout_id: data });
  return { message: h.execPayoutPaid, result };
}

async function cancelPayout(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (typeof prior.payout_id === "string") {
    return { message: h.execAlreadyRecorded, result: prior };
  }

  const { data, error } = await getAdminClient().rpc("fn_agent_cancel_payout", {
    p_approver: approver,
    p_payout_id: str(payload, "payout_id"),
  });
  if (error) throw new Error(error.message);

  const result = await saveStep({ payout_id: data });
  return { message: h.execPayoutCancelled, result };
}

/**
 * Delete a document: DB row first, storage object second.
 *
 * That order is deliberate. A row without an object is a broken document the
 * portal still shows; an object without a row is invisible garbage a retry
 * can clean. The wrapper returns the storage path (null = already gone), and
 * the two saveStep markers mean a crash between the steps re-runs ONLY the
 * storage removal — the row is not deleted twice, the file is not orphaned.
 */
async function deleteDocument(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (prior.storage_deleted === true) return { message: h.execAlreadyRecorded, result: prior };

  const db = getAdminClient();
  let path = typeof prior.storage_path === "string" ? prior.storage_path : null;

  if (prior.row_deleted !== true) {
    const { data, error } = await db.rpc("fn_agent_delete_document", {
      p_approver: approver,
      p_document_id: str(payload, "document_id"),
    });
    if (error) throw new Error(error.message);
    path = typeof data === "string" ? data : null;
    await saveStep({ row_deleted: true, storage_path: path });
  }

  if (path) {
    // `storage_path` carries the bucket prefix (docs/06 §2.1); the SDK wants
    // the key relative to the bucket — same strip the portal does.
    const key = path.replace(/^\/+/, "").replace(/^model-documents\//, "");
    const { error: storageError } = await db.storage.from("model-documents").remove([key]);
    if (storageError) throw new Error(`document row deleted, storage removal failed: ${storageError.message}`);
  }

  const result = await saveStep({ storage_deleted: true });
  return { message: h.execDocumentDeleted, result };
}

/**
 * Entity deletion (032) reuses the same wrapper as day-to-day deletes — the
 * per-kind role gate and the pre-checks live in the database function, where
 * neither this process nor a confused model can skip them. The separate
 * ACTION exists so policy.ts can hold entity deletion to super_admin without
 * widening the manager's record-delete surface.
 */
async function deleteEntity(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  return deleteRecord(payload, approver, prior, saveStep, locale);
}

/**
 * Store a Telegram-attached file as a compliance document (033).
 *
 * Three steps, in an order where every crash leaves a recoverable state:
 *   1. download from Telegram (file_id from the payload — stable for the
 *      bot's lifetime, so an approval tapped hours later still resolves);
 *   2. upload into the private bucket under the portal's own key shape;
 *   3. write the row via the wrapper (idempotent on storage_path).
 * A crash after 2 leaves an invisible object a retry reclaims via the same
 * deterministic key; a crash after 3 re-runs into the wrapper's
 * already-exists branch. The bytes never touch this process's disk and are
 * never sent anywhere but the bucket.
 */
async function uploadDocument(
  payload: Record<string, unknown>,
  approver: string,
  prior: Record<string, unknown>,
  saveStep: SaveStep,
  locale: Reader,
): Promise<ExecutorResult> {
  const h = hermesDict(locale);
  if (typeof prior.document_id === "string") {
    return { message: h.execAlreadyRecorded, result: prior };
  }

  const db = getAdminClient();
  const modelId = str(payload, "model_id");
  const mime = str(payload, "mime_type");
  const rawName = str(payload, "file_name");

  // The key is DERIVED from the approval id, so a retry computes the same key
  // instead of minting a second object for the same approval.
  const approvalId = str(payload, "approval_id");
  const safeName = sanitizeFilename(rawName);
  const key = `${modelId}/${approvalId}/${safeName}`;
  const storagePath = `model-documents/${key}`;

  if (prior.stored !== true) {
    const { file_path, file_size } = await getFile(str(payload, "file_id"));
    if (!file_path) throw new Error("Telegram no longer has that file — ask for it to be re-sent");
    // Telegram's OWN size answer, checked before a byte moves — the declared
    // size on the proposal was the sender's claim, this one is the server's.
    if (typeof file_size === "number" && file_size > MAX_FILE_BYTES) {
      throw new Error(`that file is ${(file_size / 1_048_576).toFixed(1)} MB — over the ${MAX_FILE_BYTES / 1_048_576} MB limit`);
    }
    const bytes = await downloadFile(file_path);

    // The size the PROPOSAL checked was Telegram's declaration; this is the
    // truth. Telegram's own 20 MB getFile cap makes a giant body unlikely,
    // but the portal's limit is the studio's rule and it binds actual bytes.
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error(`downloaded file is ${bytes.byteLength} bytes — outside the accepted range`);
    }

    const { error: uploadError } = await db.storage
      .from("model-documents")
      .upload(key, bytes, { contentType: mime, upsert: true });
    if (uploadError) throw new Error(`storage upload failed: ${uploadError.message}`);

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await saveStep({ stored: true, sha256, byte_length: bytes.byteLength });
    prior = { ...prior, stored: true, sha256, byte_length: bytes.byteLength };
  }

  const { data, error } = await db.rpc("fn_agent_create_document", {
    p_approver: approver,
    p_model_id: modelId,
    p_doc_type: str(payload, "doc_type") as never,
    p_title: str(payload, "title"),
    p_storage_path: storagePath,
    p_file_name: safeName,
    p_mime_type: mime,
    p_size_bytes: typeof prior.byte_length === "number" ? prior.byte_length : num(payload, "size_bytes"),
    p_sha256: typeof prior.sha256 === "string" ? prior.sha256 : undefined,
    p_issued_date: typeof payload.issued_date === "string" ? payload.issued_date : undefined,
    p_expires_at: typeof payload.expires_at === "string" ? payload.expires_at : undefined,
  });
  if (error) throw new Error(error.message);

  const result = await saveStep({ document_id: data });
  return { message: h.execDocumentUploaded, result };
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
    case "upsert_operator":
      return upsertOperator(payload, approver, prior, saveStep, locale);
    case "upsert_platform":
      return upsertPlatform(payload, approver, prior, saveStep, locale);
    case "upsert_account":
      return upsertAccount(payload, approver, prior, saveStep, locale);
    case "upsert_assignment":
      return upsertAssignment(payload, approver, prior, saveStep, locale);
    case "set_status":
      return setStatus(payload, approver, prior, saveStep, locale);
    case "upsert_scheme":
      return upsertScheme(payload, approver, prior, saveStep, locale);
    case "set_rate_card":
      return setRateCard(payload, approver, prior, saveStep, locale);
    case "approve_payout":
      return approvePayout(payload, approver, prior, saveStep, locale);
    case "mark_payout_paid":
      return markPayoutPaid(payload, approver, prior, saveStep, locale);
    case "cancel_payout":
      return cancelPayout(payload, approver, prior, saveStep, locale);
    case "delete_document":
      return deleteDocument(payload, approver, prior, saveStep, locale);
    case "delete_entity":
      return deleteEntity(payload, approver, prior, saveStep, locale);
    case "upload_document":
      return uploadDocument(payload, approver, prior, saveStep, locale);
    default:
      throw new Error(`no executor for ${actionType}`);
  }
}
