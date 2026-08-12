import type { Factor, SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { dict, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

/**
 * Thin, typed wrappers over `supabase.auth.mfa` for the auth pages, the guard
 * and the middleware (docs/05-auth-2fa.md flows A and B).
 *
 * Every function takes the Supabase client explicitly so the same helpers work
 * against a browser client (enrollment/challenge UI), a server client (guard),
 * and the middleware client — and so this module never creates a client itself.
 */

export type AssuranceLevel = "aal1" | "aal2";

export type AssuranceState = {
  /** What the session has achieved right now. `null` when there is no session. */
  currentLevel: AssuranceLevel | null;
  /** The highest level the user COULD reach — `aal2` iff a verified factor exists. */
  nextLevel: AssuranceLevel | null;
  /** True when the session is fully assured (password + TOTP). */
  isAal2: boolean;
  /** True when a verified factor exists but this session has not used it yet. */
  needsChallenge: boolean;
  /** True when the user has no verified factor at all — forced enrollment. */
  needsEnrollment: boolean;
};

type AnySupabase = SupabaseClient<Database, "public">;

function normalize(level: string | null | undefined): AssuranceLevel | null {
  return level === "aal1" || level === "aal2" ? level : null;
}

/**
 * Computes the session's assurance state.
 *
 * This is the exact predicate doc 05 §5 layer 1 specifies:
 * `nextLevel === 'aal2' && currentLevel !== 'aal2'` → challenge;
 * no verified factor → enrollment.
 *
 * On error it fails CLOSED: `isAal2` is false, so callers redirect rather than
 * admit an unverified session.
 */
export async function getAssurance(supabase: AnySupabase): Promise<AssuranceState> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (error || !data) {
    return {
      currentLevel: null,
      nextLevel: null,
      isAal2: false,
      needsChallenge: false,
      needsEnrollment: false,
    };
  }

  const currentLevel = normalize(data.currentLevel);
  const nextLevel = normalize(data.nextLevel);
  const isAal2 = currentLevel === "aal2";

  return {
    currentLevel,
    nextLevel,
    isAal2,
    needsChallenge: !isAal2 && nextLevel === "aal2",
    needsEnrollment: !isAal2 && nextLevel !== "aal2",
  };
}

/** All factors on the account (verified and unverified). */
export async function listFactors(supabase: AnySupabase): Promise<Factor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return [];
  return data.all ?? [];
}

/** TOTP factors only — the single factor type this product enrolls. */
export async function listTotpFactors(supabase: AnySupabase): Promise<Factor[]> {
  const all = await listFactors(supabase);
  return all.filter((factor) => factor.factor_type === "totp");
}

/** The verified TOTP factor to challenge, or `null` when enrollment is required. */
export async function getVerifiedTotpFactor(
  supabase: AnySupabase,
): Promise<Factor | null> {
  const factors = await listTotpFactors(supabase);
  return factors.find((factor) => factor.status === "verified") ?? null;
}

/** True when at least one verified TOTP factor exists. */
export async function hasVerifiedFactor(supabase: AnySupabase): Promise<boolean> {
  return (await getVerifiedTotpFactor(supabase)) !== null;
}

export type TotpEnrollment = {
  factorId: string;
  /** SVG markup of the provisioning QR code. Shown exactly once. */
  qrCode: string;
  /** Base32 secret for manual entry. Shown exactly once, never stored. */
  secret: string;
  /** `otpauth://` provisioning URI. */
  uri: string;
};

/**
 * Starts TOTP enrollment (docs/05 flow A). Any pre-existing UNVERIFIED totp
 * factor is cleaned up first, because Supabase rejects a duplicate friendly name
 * and abandoned enrollments otherwise wedge the flow.
 */
export async function enrollTotp(
  supabase: AnySupabase,
  // `friendlyName` is a Supabase FACTOR IDENTIFIER, not display copy: it must be
  // stable across languages or a Russian-locale re-enrolment would create a
  // second factor instead of matching the existing one. It stays English.
  friendlyName = "Authenticator app",
  locale: Locale = DEFAULT_LOCALE,
): Promise<TotpEnrollment> {
  const existing = await listTotpFactors(supabase);
  for (const factor of existing) {
    if (factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName,
  });
  if (error || !data) {
    throw new Error(error?.message ?? dict(locale).aiRuntime.totpEnrollFailed);
  }

  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

/**
 * Challenges a factor and verifies the user's 6-digit code in one step.
 * On success the session is upgraded to AAL2 and new cookies are written.
 */
export async function challengeAndVerifyTotp(
  supabase: AnySupabase,
  factorId: string,
  code: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId,
  });
  if (challengeError || !challenge) {
    throw new Error(challengeError?.message ?? dict(locale).aiRuntime.totpChallengeFailed);
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: code.trim(),
  });
  if (verifyError) {
    throw new Error(verifyError.message);
  }
}

/** Removes a factor from the CURRENT user's account (self-service only). */
export async function unenrollFactor(
  supabase: AnySupabase,
  factorId: string,
): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw new Error(error.message);
}
