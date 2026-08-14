import { z } from "zod";

import { emptyToNull } from "../forms.js";
import { optionalTelegramUsername } from "./operators.js";

/**
 * Model validation, shared by the manual form and the Telegram bot.
 *
 * See `operators.ts` for why messages are a parameter rather than a dictionary
 * lookup. The short version: the worker emits Node ESM and cannot import
 * `i18n/index.ts`, so the RULES travel and the WORDS are supplied.
 *
 * The 18+ gate is the reason this module matters most. It is enforced twice —
 * here, with a sentence a person can act on, and by the
 * `date_of_birth <= current_date - interval '18 years'` CHECK on the table,
 * which is authoritative. Before this module existed the bot had neither: it
 * checked "is a string" and let Postgres decide, so an under-age date of birth
 * reached the approver's card looking perfectly ordinary and failed with a raw
 * SQLSTATE after they tapped Approve.
 */

export interface ModelMessages {
  stageNameRequired: string;
  legalNameRequired: string;
  dobInvalid: string;
  adult: string;
  dateInvalid: string;
  email: string;
  phoneLong: string;
  country: string;
  commissionType: string;
  commissionMin: string;
  commissionMax: string;
  notesLong: string;
  telegramUsername: string;
}

export const MODEL_MESSAGES_EN: ModelMessages = {
  stageNameRequired: "Enter a stage name.",
  legalNameRequired: "Enter the legal name.",
  dobInvalid: "Enter a real date of birth as YYYY-MM-DD.",
  adult: "The studio only works with people aged 18 or over.",
  dateInvalid: "Enter a real date as YYYY-MM-DD.",
  email: "That doesn't look like an email address.",
  phoneLong: "Keep the phone number under 40 characters.",
  country: "Use a 2-letter country code, e.g. PL.",
  commissionType: "Enter the commission as a number.",
  commissionMin: "Commission cannot be negative.",
  commissionMax: "Commission cannot exceed 100%.",
  notesLong: "Keep notes under 4000 characters.",
  telegramUsername: "A Telegram username is 5–32 letters, digits or underscores.",
};

export const MODEL_STATUSES = ["active", "inactive", "on_leave", "terminated"] as const;

export type Ymd = { y: number; m: number; d: number };

/** Parses a strict `YYYY-MM-DD` and rejects impossible calendar dates. */
export function parseYmd(value: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const asDate = new Date(Date.UTC(y, m - 1, d));
  if (asDate.getUTCFullYear() !== y || asDate.getUTCMonth() !== m - 1 || asDate.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/** Mirrors the DB CHECK: born on or before (today − 18 years). */
export function isAdult({ y, m, d }: Ymd): boolean {
  const birth = Date.UTC(y, m - 1, d);
  const now = new Date();
  const cutoff = Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate());
  return birth <= cutoff;
}

const dateOfBirth = (m: ModelMessages) =>
  z
    .string()
    .refine((v) => parseYmd(v) !== null, m.dobInvalid)
    .refine((v) => {
      const parsed = parseYmd(v);
      return parsed !== null && isAdult(parsed);
    }, m.adult);

const optionalDate = (m: ModelMessages) =>
  z
    .preprocess(
      emptyToNull,
      z
        .string()
        .refine((v) => parseYmd(v) !== null, m.dateInvalid)
        .nullable(),
    )
    .optional();

const optionalEmail = (m: ModelMessages) =>
  z.preprocess(emptyToNull, z.string().trim().email(m.email).nullable()).optional();

const optionalPhone = (m: ModelMessages) =>
  z.preprocess(emptyToNull, z.string().trim().max(40, m.phoneLong).nullable()).optional();

const optionalCountry = (m: ModelMessages) =>
  z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null),
      z.string().regex(/^[A-Z]{2}$/, m.country).nullable(),
    )
    .optional();

const optionalNotes = (m: ModelMessages) =>
  z.preprocess(emptyToNull, z.string().trim().max(4000, m.notesLong).nullable()).optional();

const commissionPercent = (m: ModelMessages) =>
  z.coerce
    .number({ invalid_type_error: m.commissionType })
    .min(0, m.commissionMin)
    .max(100, m.commissionMax);

/** Everything except lifecycle status, which moves only through its own path. */
export const modelProfileFields = (m: ModelMessages) => ({
  stage_name: z.string().trim().min(1, m.stageNameRequired).max(160),
  legal_name: z.string().trim().min(1, m.legalNameRequired).max(200),
  date_of_birth: dateOfBirth(m),
  email: optionalEmail(m),
  phone: optionalPhone(m),
  country: optionalCountry(m),
  start_date: optionalDate(m),
  commission_percent: commissionPercent(m),
  notes: optionalNotes(m),
  telegram_username: optionalTelegramUsername(m.telegramUsername),
});

/**
 * The subset the bot may send on an UPDATE, where every field is optional
 * because the wrapper `coalesce`s omissions to the existing value. The rules
 * are the same objects as above — only their optionality differs.
 */
export const modelPatchFields = (m: ModelMessages) => ({
  stage_name: z.string().trim().min(1, m.stageNameRequired).max(160).optional(),
  legal_name: z.string().trim().min(1, m.legalNameRequired).max(200).optional(),
  date_of_birth: dateOfBirth(m).optional(),
  email: optionalEmail(m),
  phone: optionalPhone(m),
  country: optionalCountry(m),
  commission_percent: commissionPercent(m).optional(),
  status: z.enum(MODEL_STATUSES).optional(),
  telegram_username: optionalTelegramUsername(m.telegramUsername),
});
