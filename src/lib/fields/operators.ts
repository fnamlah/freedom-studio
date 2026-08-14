import { z } from "zod";

import { emptyToNull, isValidYmd } from "../forms.js";

/**
 * The operator / coach / team-leader validation rules, shared by BOTH writers.
 *
 * Why this module exists: the Telegram bot's write path did not reuse the
 * manual form's schema at all. It checked "is a string" and "is a number" and
 * sent everything else straight to Postgres — no date validation, no country
 * format, no length caps. `operators` carries ZERO check constraints, so for
 * that table nothing downstream caught it either. Widening the bot to cover
 * the whole studio without fixing that would have multiplied the exposure.
 *
 * TWO CONSTRAINTS SHAPE THE SHAPE OF THIS FILE:
 *
 *   1. It must be importable by the worker, which emits Node ESM. That means
 *      relative specifiers WITH `.js` extensions, and it rules out importing
 *      the app dictionary — `i18n/index.ts` uses extensionless imports
 *      throughout, which Node rejects at runtime.
 *   2. Messages are therefore a PARAMETER, not a dictionary lookup. The app
 *      passes its localized strings; the worker passes English. The RULES —
 *      the security-relevant half — are identical by construction, which is
 *      the point. `forms.ts` is safe to import: its only import is
 *      `import type { z }`, which erases.
 */

export interface OperatorMessages {
  displayNameRequired: string;
  legalNameRequired: string;
  email: string;
  phoneLong: string;
  country: string;
  dateInvalid: string;
  notesLong: string;
  telegramUsername: string;
}

/** English defaults, used by the worker and as the fallback anywhere else. */
export const OPERATOR_MESSAGES_EN: OperatorMessages = {
  displayNameRequired: "Enter a display name.",
  legalNameRequired: "Enter the legal name.",
  email: "That doesn't look like an email address.",
  phoneLong: "Keep the phone number under 40 characters.",
  country: "Use a 2-letter country code, e.g. PL.",
  dateInvalid: "Enter a real date as YYYY-MM-DD.",
  notesLong: "Keep notes under 4000 characters.",
  telegramUsername: "A Telegram username is 5–32 letters, digits or underscores.",
};

/**
 * Telegram handle: a pasted @ is stripped, then Telegram's own rules apply.
 * Stored bare so «найди @hahaub» and «найди hahaub» resolve identically.
 */
export const optionalTelegramUsername = (message: string) =>
  z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() ? v.trim().replace(/^@+/, "") : null),
      z.string().regex(/^[A-Za-z0-9_]{5,32}$/, message).nullable(),
    )
    .optional();

export const STAFF_ROLES = ["operator", "coach", "team_leader"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const OPERATOR_STATUSES = ["active", "inactive", "on_leave", "terminated"] as const;

const optionalEmail = (m: OperatorMessages) =>
  z.preprocess(emptyToNull, z.string().trim().email(m.email).nullable()).optional();

const optionalPhone = (m: OperatorMessages) =>
  z.preprocess(emptyToNull, z.string().trim().max(40, m.phoneLong).nullable()).optional();

const optionalCountry = (m: OperatorMessages) =>
  z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null),
      z.string().regex(/^[A-Z]{2}$/, m.country).nullable(),
    )
    .optional();

const optionalStartDate = (m: OperatorMessages) =>
  z.preprocess(emptyToNull, z.string().refine(isValidYmd, m.dateInvalid).nullable()).optional();

const optionalNotes = (m: OperatorMessages) =>
  z.preprocess(emptyToNull, z.string().trim().max(4000, m.notesLong).nullable()).optional();

/** Everything except lifecycle status, which moves only through its own path. */
export const operatorProfileFields = (m: OperatorMessages) => ({
  display_name: z.string().trim().min(1, m.displayNameRequired).max(160),
  // Which kind of team member. Payment is identical for all three (they share
  // the scheme's team pool); this only records who someone is (022).
  staff_role: z.enum(STAFF_ROLES).default("operator"),
  legal_name: z.string().trim().min(1, m.legalNameRequired).max(200),
  email: optionalEmail(m),
  phone: optionalPhone(m),
  country: optionalCountry(m),
  start_date: optionalStartDate(m),
  notes: optionalNotes(m),
  telegram_username: optionalTelegramUsername(m.telegramUsername),
});

/* ------------------------------------------------------------ assignments --- */

export interface AssignmentMessages {
  poolShareType: string;
  poolShareMin: string;
  poolShareMax: string;
  modelRequired: string;
  startDateInvalid: string;
  endDateInvalid: string;
  endAfterStart: string;
  notesLong: string;
}

export const ASSIGNMENT_MESSAGES_EN: AssignmentMessages = {
  poolShareType: "Enter the share as a number.",
  poolShareMin: "A share cannot be negative.",
  poolShareMax: "A share cannot exceed 100%.",
  modelRequired: "Choose which model this person works with.",
  startDateInvalid: "Enter a real start date as YYYY-MM-DD.",
  endDateInvalid: "Enter a real end date as YYYY-MM-DD.",
  endAfterStart: "The end date must be after the start date.",
  notesLong: "Keep notes under 4000 characters.",
};

export const assignmentFields = (m: AssignmentMessages) => ({
  pool_share_percent: z.coerce
    .number({ invalid_type_error: m.poolShareType })
    .min(0, m.poolShareMin)
    .max(100, m.poolShareMax),
  assigned_from: z.string().refine(isValidYmd, m.startDateInvalid),
  assigned_to: z
    .preprocess(emptyToNull, z.string().refine(isValidYmd, m.endDateInvalid).nullable())
    .optional(),
  notes: z
    .preprocess(emptyToNull, z.string().trim().max(4000, m.notesLong).nullable())
    .optional(),
});

/** Mirrors the DB CHECK `assigned_to > assigned_from` with a friendly message. */
export const endAfterStart = (data: { assigned_from: string; assigned_to?: string | null }) =>
  !data.assigned_to || data.assigned_to > data.assigned_from;

export const endAfterStartMessage = (m: AssignmentMessages) => ({
  message: m.endAfterStart,
  path: ["assigned_to"] as (string | number)[],
});
