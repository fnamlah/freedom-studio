"use client";

import { createContext, useContext, type ReactNode } from "react";

import { dict, type Dictionary } from "./index";
import { DEFAULT_LOCALE, type Locale } from "./locales";

/**
 * Client-side locale access.
 *
 * The locale is resolved ONCE on the server (see ./server.ts) and handed to this
 * provider, rather than being re-derived in the browser. That is deliberate:
 * both sides must agree on the first render or React reports a hydration
 * mismatch, and dates and numbers are exactly the kind of output that would
 * differ silently.
 *
 * Only the locale crosses the server/client boundary — a short string. The
 * dictionary itself is a module import on both sides, so nothing large is
 * serialized into the RSC payload.
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** The dictionary, in a client component. */
export function useDict(): Dictionary {
  return dict(useContext(LocaleContext));
}
