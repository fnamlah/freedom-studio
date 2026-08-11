import type { Metadata } from "next";

import { AcceptForm } from "./accept-form";

export const metadata: Metadata = { title: "Set your password" };
export const dynamic = "force-dynamic";

/**
 * Invite landing (docs/05-auth-2fa.md Flow A). The invited user arrives here
 * from the Supabase invite email with a fresh AAL1 session; they set a password
 * and are then sent into forced TOTP enrollment.
 *
 * The `handle_new_user` trigger has already created their `profiles` row
 * (status `invited`) from the pending invitation, so nothing is provisioned
 * here — this step only sets the password and hands off to `/auth/mfa-enroll`.
 */
export default function AcceptPage() {
  return <AcceptForm />;
}
