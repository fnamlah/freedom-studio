import type { Metadata } from "next";

import { sanitizeNext } from "@/components/auth/safe-next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

/**
 * Flow B entry point (docs/05-auth-2fa.md §4). The middleware and the server
 * guard both redirect here, forwarding `?next=` (the originally requested path)
 * and, when the account cannot use the app, `?error=no_profile|inactive`.
 *
 * `searchParams` is resolved server-side and the sanitised values handed to the
 * client form, so the form never has to reach for `useSearchParams()`.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = sanitizeNext(params.next);

  let initialError: string | null = null;
  if (params.error === "no_profile") {
    initialError =
      "Your account isn't fully set up yet. Contact your administrator to complete the invitation.";
  } else if (params.error === "inactive") {
    initialError =
      "This account has been deactivated. Contact your administrator if you believe this is a mistake.";
  }

  return <LoginForm next={next} initialError={initialError} />;
}
