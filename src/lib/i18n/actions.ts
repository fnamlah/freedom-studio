"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { createServerSupabase } from "@/lib/supabase/server";
import { dict } from "./index";
import { isLocale, LOCALE_COOKIE, type Locale } from "./locales";

/**
 * Change the interface language.
 *
 * Two writes, deliberately:
 *   - `profiles.locale` — the durable answer, and the one Hermes reads when it
 *     decides which language to send this person a Telegram message in.
 *   - the `NEXT_LOCALE` cookie — so the login screen and any pre-session render
 *     agree, and so `getLocale()` can answer without a query.
 *
 * Signed-out visitors (the login screen has a switcher too) get the cookie only;
 * there is no profile to write to and no session to write it with.
 */
export type SetLocaleResult = { ok: true } | { ok: false; error: string };

export async function setLocale(next: string): Promise<SetLocaleResult> {
  if (!isLocale(next)) {
    return { ok: false, error: dict("en").locale.changeFailed };
  }
  const locale: Locale = next;

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });

  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      // Through the caller's own RLS client — a user may update their own
      // profile and no one else's, which is exactly the rule we want here.
      const { error } = await supabase
        .from("profiles")
        .update({ locale })
        .eq("id", user.id);
      if (error) {
        // The cookie is already set, so the interface still switches; only the
        // durable preference failed. Say so rather than pretending it worked.
        return { ok: false, error: dict(locale).locale.changeFailed };
      }
    }
  } catch {
    return { ok: false, error: dict(locale).locale.changeFailed };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
