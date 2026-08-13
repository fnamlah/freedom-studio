import { z } from "zod";

import { isValidYmd, type SqlStateMessages } from "@/lib/forms";
import type { Dictionary } from "@/lib/i18n";

/**
 * The earnings validation vocabulary, shared by BOTH entry paths.
 *
 * Lifted out of `actions.ts` (a `"use server"` file may only export async
 * functions) so the inbox's apply action can validate an AI-proposed row with
 * THE SAME schema the manual form uses — the rule that makes `/documents/inbox`
 * safe: an imported row cannot bypass anything a typed row obeys (021).
 *
 * Factories, not constants: a module-scope schema is built at import time,
 * before any locale exists, so its messages could only ever be English.
 */

const dateOnly = (d: Dictionary) =>
  z.string().refine(isValidYmd, d.studio.earnings.errDateInvalid);

const money2 = (d: Dictionary) =>
  z.coerce
    .number({ invalid_type_error: d.studio.earnings.errAmountType })
    .min(0, d.studio.earnings.errAmountMin)
    .max(9_999_999_999.99, d.studio.earnings.errAmountTooLarge);

/** Optional money field that defaults to 0 (matches `platform_fee_amount` default). */
const money2OrZero = (d: Dictionary) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? 0 : v), money2(d));

const currency = (d: Dictionary) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : "USD"),
    z.string().regex(/^[A-Z]{3}$/, d.studio.earnings.errCurrency),
  );

export const earningFields = (d: Dictionary) => ({
  platform_account_id: z.string().uuid(d.studio.earnings.errAccountRequired),
  period_start: dateOnly(d),
  period_end: dateOnly(d),
  gross_amount: money2(d),
  platform_fee_amount: money2OrZero(d),
  net_amount: money2(d),
  currency: currency(d),
});

export const periodOrdered = (data: { period_start: string; period_end: string }) =>
  data.period_end >= data.period_start;

export const periodOrderedMessage = (d: Dictionary) => ({
  message: d.studio.earnings.errPeriodOrder,
  path: ["period_end"],
});

/** SQLSTATEs this area turns into prose; anything else gets the generic fallback. */
export function earningDbMessages(d: Dictionary): SqlStateMessages {
  return {
    "23505": d.studio.earnings.errDuplicate,
    "23514": d.studio.earnings.errDbCheck,
    "23503": d.studio.earnings.errAccountFk,
  };
}
