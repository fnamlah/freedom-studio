import type { Metadata } from "next";

import { sanitizeNext } from "@/components/auth/safe-next";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { getDict } from "@/lib/i18n/server";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).auth.signInTitle };
}

export const dynamic = "force-dynamic";

/**
 * Flow B entry point (docs/05-auth-2fa.md §4). The middleware and the server
 * guard both redirect here, forwarding `?next=` (the originally requested path)
 * and, when the account cannot use the app, `?error=no_profile|inactive`.
 *
 * `searchParams` is resolved server-side and the sanitised values handed to the
 * client form, so the form never has to reach for `useSearchParams()`.
 *
 * The language switcher belongs on this page rather than only in the app shell:
 * this is the first screen anyone sees, and it renders before there is a profile
 * to read a language preference from — the choice lands in the `NEXT_LOCALE`
 * cookie and survives into the session.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = sanitizeNext(params.next);
  const d = await getDict();

  let initialError: string | null = null;
  if (params.error === "no_profile") {
    initialError = d.authFlow.errorNoProfile;
  } else if (params.error === "inactive") {
    initialError = d.authFlow.errorInactive;
  }

  return (
    <>
      <LocaleSwitcher className="fixed right-4 top-4 z-10" />
      <LoginForm next={next} initialError={initialError} />
    </>
  );
}
