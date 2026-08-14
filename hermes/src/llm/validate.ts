import { z } from "zod";

import {
  ASSIGNMENT_MESSAGES_EN,
  OPERATOR_MESSAGES_EN,
  assignmentFields,
  endAfterStart,
  endAfterStartMessage,
  operatorProfileFields,
} from "../../../src/lib/fields/operators.js";
import { MODEL_MESSAGES_EN, modelPatchFields } from "../../../src/lib/fields/models.js";
import {
  PLATFORM_MESSAGES_EN,
  accountEditableFields,
  platformFields,
} from "../../../src/lib/fields/platforms.js";

/**
 * The app's own field rules, applied to a proposal BEFORE a card is queued.
 *
 * Until now the bot's write path validated almost nothing: `str()` (is a
 * string) and `num()` (is a number), and everything else went to Postgres. So
 * a date of birth in the future, a three-letter country code or a 900%
 * platform fee reached the approver's card looking perfectly ordinary and
 * failed — if it failed at all — as a raw SQLSTATE after they had already
 * tapped Approve. `operators` carries no CHECK constraints whatsoever, so for
 * team members nothing downstream caught it either.
 *
 * These are the SAME schema objects the web forms use, imported from
 * `src/lib/fields/`, not a second copy that can drift. English messages,
 * because the worker cannot import the app dictionary — `i18n/index.ts` uses
 * extensionless specifiers that Node ESM rejects at runtime, and the emitted
 * worker is Node ESM. The model relays the message to Alina in her language.
 *
 * Every schema here is `.partial()`-shaped by construction: a proposal names
 * only what is changing, and the wrappers `coalesce` the rest. The rules still
 * apply to whatever IS named, which is the whole point.
 */

/** Zod's first message, phrased as something the model can say out loud. */
export function validate<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".");
    throw new Error(field ? `${field}: ${issue?.message}` : (issue?.message ?? "Invalid value."));
  }
  return parsed.data;
}

const op = operatorProfileFields(OPERATOR_MESSAGES_EN);

/** A team member: everything optional, because an update names only changes. */
export const operatorProposal = z.object({
  display_name: op.display_name.optional(),
  legal_name: op.legal_name.optional(),
  staff_role: op.staff_role.optional(),
  email: op.email,
  phone: op.phone,
  country: op.country,
  start_date: op.start_date,
});

export const modelProposal = z.object(modelPatchFields(MODEL_MESSAGES_EN));

const pf = platformFields(PLATFORM_MESSAGES_EN);
export const platformProposal = z.object({
  name: pf.name.optional(),
  website_url: pf.website_url,
});

const af = accountEditableFields(PLATFORM_MESSAGES_EN);
export const accountProposal = z.object({
  username: af.username.optional(),
  platform_fee_percent: af.platform_fee_percent,
});

const asg = assignmentFields(ASSIGNMENT_MESSAGES_EN);
export const assignmentProposal = z
  .object({
    pool_share_percent: asg.pool_share_percent.optional(),
    assigned_from: asg.assigned_from,
    assigned_to: asg.assigned_to,
  })
  .refine(
    (d) => !d.assigned_from || endAfterStart({ assigned_from: d.assigned_from, assigned_to: d.assigned_to }),
    endAfterStartMessage(ASSIGNMENT_MESSAGES_EN),
  );

/**
 * A commission scheme. The three-way split is a DB CHECK
 * (`model + operator + studio = 100`), but saying so in conversation beats a
 * 23514 on a card someone has already read and believed.
 */
export const schemeProposal = z
  .object({
    model_percent: z.number().min(0).max(100).optional(),
    operator_percent: z.number().min(0).max(100).optional(),
    studio_percent: z.number().min(0).max(100).optional(),
    effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the start date as YYYY-MM-DD."),
    effective_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the end date as YYYY-MM-DD.")
      .nullish(),
  })
  .refine(
    (d) =>
      d.model_percent === undefined ||
      d.operator_percent === undefined ||
      d.studio_percent === undefined ||
      Math.abs(d.model_percent + d.operator_percent + d.studio_percent - 100) < 0.005,
    { message: "The model, team and studio percentages must add up to 100." },
  )
  .refine((d) => !d.effective_to || d.effective_to > d.effective_from, {
    message: "The end date must be after the start date.",
    path: ["effective_to"],
  });

export const COMMISSION_PARTIES = [
  "model_with_operator",
  "model_with_coach",
  "model_independent",
  "operator",
  "coach",
  "team_leader",
] as const;

/**
 * A rate card. 025's `fn_set_commission_rates` proves solvency for real — that
 * the studio can never owe more than 100% of a dollar at any income level —
 * and this does NOT duplicate that proof. It catches the shape errors that
 * would otherwise reach it as a cast failure: an unknown party name, a
 * negative bracket floor, a percentage over 100.
 */
export const rateCardProposal = z
  .array(
    z.object({
      party: z.enum(COMMISSION_PARTIES, {
        errorMap: () => ({ message: `Role must be one of: ${COMMISSION_PARTIES.join(", ")}.` }),
      }),
      min_amount: z.number().min(0, "A bracket cannot start below zero."),
      percent: z.number().min(0, "A rate cannot be negative.").max(100, "A rate cannot exceed 100%."),
    }),
  )
  .min(1, "Send at least one rate.")
  .max(60, "That is more brackets than a rate card can hold.");

/* ---------------------------------------------------------------- payouts --- */

const ymd = (what: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `Enter the ${what} as YYYY-MM-DD.`);

/**
 * A payout proposal. Mirrors the portal's payout schema without importing
 * server-action code (the "use server" file cannot be imported by the worker).
 * The DB CHECK `period_end >= period_start` is repeated here so the refusal
 * happens in conversation, not after the tap.
 */
export const payoutProposal = z
  .object({
    period_start: ymd("period start"),
    period_end: ymd("period end"),
    net_amount: z
      .number({ invalid_type_error: "Say the net amount as a number." })
      .positive("The net amount must be above zero.")
      .max(1_000_000_000, "That amount is implausibly large."),
    gross_amount: z.number().nonnegative().max(1_000_000_000).optional(),
    deductions: z.number().nonnegative().max(1_000_000_000).optional(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. USD.")
      .optional(),
  })
  .refine((d) => d.period_end >= d.period_start, {
    message: "The period end cannot be before its start.",
    path: ["period_end"],
  });

/** A period to close: same date rules, no amounts. */
export const periodProposal = z
  .object({
    period_start: ymd("period start"),
    period_end: ymd("period end"),
  })
  .refine((d) => d.period_end >= d.period_start, {
    message: "The period end cannot be before its start.",
    path: ["period_end"],
  });

export const monthsAheadProposal = z
  .number({ invalid_type_error: "Say how many months as a number." })
  .int("Whole months only.")
  .min(1, "At least one month ahead.")
  .max(12, "Twelve months is the furthest the forecast goes.");

/* -------------------------------------------------------------- documents --- */

import {
  DOCUMENT_META_MESSAGES_EN,
  documentMetaFields,
} from "../../../src/lib/fields/documents.js";

/** Metadata for a Telegram-attached upload; the file half is checked in the tool. */
export const documentUploadProposal = z.object(documentMetaFields(DOCUMENT_META_MESSAGES_EN));
