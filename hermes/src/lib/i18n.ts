/**
 * The worker's view of the shared dictionary.
 *
 * RELATIVE import, deliberately: `tsc` does not rewrite `@studio/*` path aliases
 * at emit, so an aliased value import compiles and then fails inside the
 * container. Because `rootDir` is the repo root, this path resolves identically
 * in `src/` and in `dist/` — the same technique the redactor import uses.
 *
 * It reaches only `areas/hermes.ts` and `locales.ts`, both dependency-free, so
 * no React or Next code is dragged into the worker bundle.
 */
export { hermesDict, hermesEn, hermesRu } from "../../../src/lib/i18n/areas/hermes.js";
export {
  DEFAULT_LOCALE,
  INTL_LOCALE,
  plural,
  pluralize,
  toLocale,
  type Locale,
} from "../../../src/lib/i18n/locales.js";

import { INTL_LOCALE, type Locale } from "../../../src/lib/i18n/locales.js";

/**
 * Locales that get their own Telegram command menu. English is registered as
 * the DEFAULT list (no language_code), so only the non-default ones go here.
 */
export const LOCALES_FOR_MENU: Locale[] = ["ru"];

/**
 * Money for Telegram. The worker cannot use the app's `format.ts` (it pulls in
 * app-only concerns), and the previous hardcoded `toLocaleString("en-US")`
 * printed `$1,234.50` to a Russian reader who expects `1 234,50 $`.
 */
export function money(value: unknown, locale: Locale, currency = "USD"): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: "currency",
    currency,
  }).format(Number.isFinite(n) ? n : 0);
}

/** A plain number with the locale's own grouping and decimal separator. */
export function decimal(value: number, locale: Locale, decimals = 2): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}
