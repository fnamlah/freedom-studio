import type { Metadata } from "next";

import { sanitizeNext } from "@/components/auth/safe-next";
import { getDict } from "@/lib/i18n/server";
import { EnrollForm } from "./enroll-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).auth.mfaEnrollTitle };
}

export const dynamic = "force-dynamic";

/**
 * Forced TOTP enrollment (docs/05-auth-2fa.md Flow A). Reached with an AAL1
 * session that has zero verified factors — the only app-adjacent route such a
 * session may render. On successful verification the client calls the
 * `activateProfileAfterEnrollment` server action, flipping the profile to
 * `active`, and lands the user in the app.
 */
export default async function MfaEnrollPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return <EnrollForm next={sanitizeNext(params.next)} />;
}
