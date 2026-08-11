/**
 * Shared TOTP one-time-code constants and helpers used by the enrollment and
 * challenge forms. Client-safe, dependency-free.
 */

/** Supabase TOTP factors always issue 6-digit codes. */
export const OTP_LENGTH = 6;

/** Strips everything but digits and caps the length — for controlled inputs. */
export function normalizeOtp(value: string): string {
  return value.replace(/\D+/g, "").slice(0, OTP_LENGTH);
}

/** True once a full 6-digit code has been entered. */
export function isCompleteOtp(value: string): boolean {
  return normalizeOtp(value).length === OTP_LENGTH;
}
