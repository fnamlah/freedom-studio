import * as OTPAuth from "otpauth";

/** Current 6-digit code for a base32 secret (as scraped from the enroll page). */
export function totpCode(secret: string): string {
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret.replace(/\s+/g, "").toUpperCase()),
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  });
  return totp.generate();
}

/**
 * Supabase rejects a TOTP code replayed inside the same 30s window. Call this
 * between two consecutive verifications for the same user.
 */
export async function waitForNextTotpWindow(): Promise<void> {
  const msIntoWindow = Date.now() % 30_000;
  const waitMs = 30_000 - msIntoWindow + 500;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}
