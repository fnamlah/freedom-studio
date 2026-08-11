import type { Metadata } from "next";

import { sanitizeNext } from "@/components/auth/safe-next";
import { ChallengeForm } from "./challenge-form";

export const metadata: Metadata = { title: "Two-factor verification" };
export const dynamic = "force-dynamic";

/**
 * TOTP challenge (docs/05-auth-2fa.md Flow B). Reached by an AAL1 session that
 * already has a verified factor. On success the session is upgraded to AAL2 and
 * the user is returned to `?next=` (or the dashboard).
 */
export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return <ChallengeForm next={sanitizeNext(params.next)} />;
}
