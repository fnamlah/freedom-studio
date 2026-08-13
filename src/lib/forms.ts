import type { z } from "zod";

/**
 * Shared server-action form helpers.
 *
 * These existed as 42 near-identical private copies across 13 `actions.ts`
 * files — a by-product of writing each area in parallel. Two of them had
 * drifted into INCOMPATIBLE argument orders (`firstIssue(d, error)` in three
 * files, `firstIssue(error, d)` in nine), which is exactly the kind of split
 * that turns into a silent bug the first time someone copies the wrong one.
 *
 * The messages stay per-area — an earnings duplicate and a document duplicate
 * do not read the same — so each helper takes the area's strings as data rather
 * than hard-coding them here.
 */

/** The first zod issue's message, or the area's generic fallback. */
export function firstIssue(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

/**
 * Postgres SQLSTATEs that reach a user as prose. Anything outside this set is
 * an unexpected condition and gets the caller's generic fallback.
 *
 * 23505 unique_violation · 23503 foreign_key_violation · 23514 check_violation
 * 23502 not_null_violation · 22023 invalid_parameter_value · 42501 insufficient_privilege
 */
export type SqlStateMessages = Partial<
  Record<"23505" | "23503" | "23514" | "23502" | "22023" | "42501", string>
>;

/**
 * Map a Postgres error code to an area's message.
 *
 * ```ts
 * describeDbError(error.code, {
 *   "23505": d.studio.earnings.errDuplicate,
 *   "23503": d.studio.earnings.errAccountFk,
 * }, d.studio.earnings.errSaveFailed)
 * ```
 */
export function describeDbError(
  code: string | undefined,
  messages: SqlStateMessages,
  fallback: string,
): string {
  if (!code) return fallback;
  return messages[code as keyof SqlStateMessages] ?? fallback;
}

/**
 * True for a real calendar date in `YYYY-MM-DD`. Rejects `2026-02-31`, which
 * `new Date()` would silently roll into March.
 */
export function isValidYmd(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const asDate = new Date(Date.UTC(y, m - 1, d));
  return (
    asDate.getUTCFullYear() === y && asDate.getUTCMonth() === m - 1 && asDate.getUTCDate() === d
  );
}

/** Blank-ish form values become NULL, so an empty input clears a column. */
export function emptyToNull(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? null : value;
}
