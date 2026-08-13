import { z } from "zod";

import type { SqlStateMessages } from "@/lib/forms";
import type { Dictionary } from "@/lib/i18n";

/**
 * The work-sessions validation vocabulary, shared by BOTH entry paths — the
 * manual form's action and the inbox's apply action (021). Same reasoning as
 * `earnings/earning-fields.ts`: a `"use server"` file may only export async
 * functions, and the whole point of the inbox is that an AI-proposed row passes
 * exactly the validation a hand-typed one does.
 */

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

/** `datetime-local` inputs produce `YYYY-MM-DDThh:mm` (seconds optional). */
export const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const datetimeLocal = (d: Dictionary) =>
  z.string().regex(DATETIME_LOCAL, d.studio.sessions.errDatetime);

/**
 * Converts a `datetime-local` value to a UTC ISO string. The whole app displays
 * dates in UTC (see `@/lib/format`), so we interpret the wall-clock value the user
 * typed as UTC too — that round-trips exactly with the formatters. Returns null on
 * an impossible calendar datetime (e.g. Feb 30), which the caller turns into a
 * friendly error.
 */
export function localToIsoUtc(value: string): string | null {
  const m = DATETIME_LOCAL.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = m[6] ? Number(m[6]) : 0;
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d ||
    dt.getUTCHours() !== h ||
    dt.getUTCMinutes() !== mi
  ) {
    return null;
  }
  return dt.toISOString();
}

/** Shared time normalization + ordering guard. */
export function normalizeTimes(
  startedLocal: string,
  endedLocal: string | null | undefined,
  d: Dictionary,
): { ok: true; startedAt: string; endedAt: string | null } | { ok: false; error: string } {
  const startedAt = localToIsoUtc(startedLocal);
  if (!startedAt) {
    return { ok: false, error: d.studio.sessions.errStartInvalid };
  }
  let endedAt: string | null = null;
  if (endedLocal) {
    endedAt = localToIsoUtc(endedLocal);
    if (!endedAt) {
      return { ok: false, error: d.studio.sessions.errEndInvalid };
    }
    if (new Date(endedAt).getTime() <= new Date(startedAt).getTime()) {
      return { ok: false, error: d.studio.sessions.errEndAfterStart };
    }
  }
  return { ok: true, startedAt, endedAt };
}

const grossEarnings = (d: Dictionary) =>
  z.coerce
    .number({ invalid_type_error: d.studio.sessions.errGrossType })
    .min(0, d.studio.sessions.errGrossMin)
    .max(9_999_999_999.99, d.studio.sessions.errAmountTooLarge);

const currency = (d: Dictionary) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : "USD"),
    z.string().regex(/^[A-Z]{3}$/, d.studio.sessions.errCurrency),
  );

const optionalNotes = (d: Dictionary) =>
  z
    .preprocess(
      emptyToNull,
      z.string().trim().max(4000, d.studio.sessions.errNotesLong).nullable(),
    )
    .optional();

export const sessionFields = (d: Dictionary) => ({
  platform_account_id: z.string().uuid(d.studio.sessions.errAccountRequired),
  started_at: datetimeLocal(d),
  ended_at: z.preprocess(emptyToNull, datetimeLocal(d).nullable()).optional(),
  gross_earnings: grossEarnings(d),
  currency: currency(d),
  notes: optionalNotes(d),
});

/** SQLSTATEs this area turns into prose; anything else gets the generic fallback. */
export function sessionDbMessages(d: Dictionary): SqlStateMessages {
  return { "23514": d.studio.sessions.errDbCheck, "23503": d.studio.sessions.errAccountFk };
}
