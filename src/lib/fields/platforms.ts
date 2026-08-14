import { z } from "zod";

import { emptyToNull } from "../forms.js";

/**
 * Platform and platform-account validation, shared by the manual form and the
 * Telegram bot. Messages are a parameter — see `operators.ts` for why.
 *
 * One rule here is load-bearing beyond tidiness: `platform_fee_percent` on an
 * account is what the earnings maths divides by. A fee of 1000 entered by
 * mistake does not fail any constraint the bot could see — `platform_accounts`
 * has no CHECK on it — it just quietly makes every future net figure wrong.
 */

export interface PlatformMessages {
  nameRequired: string;
  url: string;
  urlLong: string;
  usernameRequired: string;
  feeType: string;
  feeMin: string;
  feeMax: string;
  modelRequired: string;
  platformRequired: string;
}

export const PLATFORM_MESSAGES_EN: PlatformMessages = {
  nameRequired: "Enter a platform name.",
  url: "That doesn't look like a website address.",
  urlLong: "That web address is too long.",
  usernameRequired: "Enter the account username.",
  feeType: "Enter the platform fee as a number.",
  feeMin: "A fee cannot be negative.",
  feeMax: "A fee cannot exceed 100%.",
  modelRequired: "Choose which model this account belongs to.",
  platformRequired: "Choose which platform this account is on.",
};

export const ACCOUNT_STATUSES = ["active", "suspended", "closed"] as const;

/** Website URL: optional, normalized to include a scheme, then validated. */
export const optionalUrl = (m: PlatformMessages) =>
  z
    .preprocess((v) => {
      if (typeof v !== "string") return v;
      const trimmed = v.trim();
      if (trimmed === "") return null;
      return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    }, z.string().url(m.url).max(2048, m.urlLong).nullable())
    .optional();

/** Platform revenue cut: optional (nullable in the schema), 0–100 when present. */
export const optionalFeePercent = (m: PlatformMessages) =>
  z
    .preprocess(
      emptyToNull,
      z.coerce
        .number({ invalid_type_error: m.feeType })
        .min(0, m.feeMin)
        .max(100, m.feeMax)
        .nullable(),
    )
    .optional();

export const platformName = (m: PlatformMessages) =>
  z.string().trim().min(1, m.nameRequired).max(160);

export const accountUsername = (m: PlatformMessages) =>
  z.string().trim().min(1, m.usernameRequired).max(160);

export const platformFields = (m: PlatformMessages) => ({
  name: platformName(m),
  website_url: optionalUrl(m),
});

/**
 * An account's identity — which model, on which platform — is fixed at
 * creation. The manual form's update path deliberately carries only username
 * and fee, and the bot's wrapper must not be more permissive: moving an
 * existing account between models would silently re-attribute every earning
 * already recorded against it.
 */
export const accountEditableFields = (m: PlatformMessages) => ({
  username: accountUsername(m),
  platform_fee_percent: optionalFeePercent(m),
});
