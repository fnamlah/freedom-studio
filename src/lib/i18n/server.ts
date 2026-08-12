import { cookies } from "next/headers";
import { cache } from "react";

import { createServerSupabase } from "@/lib/supabase/server";
import { dict, type Dictionary } from "./index";
import { DEFAULT_LOCALE, LOCALE_COOKIE, toLocale, type Locale } from "./locales";

/**
 * Server-side locale resolution, for server components, `generateMetadata` and
 * server actions.
 *
 * Order of authority:
 *   1. `profiles.locale` — the person's saved choice, the real answer.
 *   2. the `NEXT_LOCALE` cookie — what an unauthenticated visitor picked on the
 *      login screen, and a cheap hit that avoids a query on auth pages.
 *   3. Russian.
 *
 * Wrapped in React `cache()` so the profile lookup happens at most once per
 * request no matter how many components ask.
 *
 * The cookie is written alongside the profile on every switch, so the two agree
 * — which matters because the client provider is seeded from the same value and
 * a disagreement would be a hydration mismatch, not a cosmetic bug.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;

  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data } = await supabase
        .from("profiles")
        .select("locale")
        .eq("id", user.id)
        .maybeSingle();
      if (data?.locale) return toLocale(data.locale);
    }
  } catch {
    // Never let a language lookup break a render — fall through to the cookie.
  }

  return fromCookie ? toLocale(fromCookie) : DEFAULT_LOCALE;
});

/** The dictionary for this request. */
export async function getDict(): Promise<Dictionary> {
  return dict(await getLocale());
}
