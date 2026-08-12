import type { Metadata } from "next";

import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { getDict } from "@/lib/i18n/server";
import { AcceptForm } from "./accept-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).auth.setPasswordTitle };
}

export const dynamic = "force-dynamic";

/**
 * Invite landing (docs/05-auth-2fa.md Flow A). The invited user arrives here
 * from the Supabase invite email with a fresh AAL1 session; they set a password
 * and are then sent into forced TOTP enrollment.
 *
 * The `handle_new_user` trigger has already created their `profiles` row
 * (status `invited`) from the pending invitation, so nothing is provisioned
 * here — this step only sets the password and hands off to `/auth/mfa-enroll`.
 *
 * Like the login screen this renders before a language preference exists, so it
 * carries its own switcher; the choice is written to the `NEXT_LOCALE` cookie.
 */
export default function AcceptPage() {
  return (
    <>
      <LocaleSwitcher className="fixed right-4 top-4 z-10" />
      <AcceptForm />
    </>
  );
}
