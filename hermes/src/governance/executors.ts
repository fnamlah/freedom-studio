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
    default:
      throw new Error(`no executor for ${actionType}`);
  }
}
