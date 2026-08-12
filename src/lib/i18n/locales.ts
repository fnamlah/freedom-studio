/**
 * The locale primitive. Deliberately dependency-free and safe to import from
 * anywhere — the Next.js app, the Hermes worker, and plain scripts.
 *
 * Two locales, no negotiation machinery: the studio is operated in Russian and
 * the owner reads English. Language is a property of the PERSON (profiles.locale,
 * migration 019), not of the URL — so there is no `[locale]` route segment and
 * no Accept-Language content negotiation to get wrong.
 */

export const LOCALES = ["ru", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * Russian, because that is the language the studio is run in. An account that
 * has never chosen, and a visitor who has not signed in yet, both get Russian.
 */
export const DEFAULT_LOCALE: Locale = "ru";

/** The cookie that carries the choice before a session exists (login screens). */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Narrow anything to a usable locale. Never throws — display must not fail. */
export function toLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** The BCP-47 tag for `Intl` — distinct from our short internal code. */
export const INTL_LOCALE: Record<Locale, string> = {
  ru: "ru-RU",
  en: "en-US",
};

/** Native names, for the switcher. A language is always named in itself. */
export const LOCALE_NAMES: Record<Locale, string> = {
  ru: "Русский",
  en: "English",
};

/**
 * Russian has THREE plural forms where English has two, and the rule is not
 * "n === 1" (1 файл · 2 файла · 5 файлов · 21 файл). `Intl.PluralRules` knows
 * it; the `n > 1 ? "s" : ""` ternaries this codebase used cannot express it.
 *
 * Lives here, in the dependency-free module, so per-area dictionaries and the
 * Hermes worker can pluralize without importing the whole dictionary tree.
 */
export function plural(
  locale: Locale,
  count: number,
  forms: { one: string; few?: string; many?: string; other?: string },
): string {
  switch (new Intl.PluralRules(INTL_LOCALE[locale]).select(count)) {
    case "one":
      return forms.one;
    case "few":
      return forms.few ?? forms.many ?? forms.other ?? forms.one;
    case "many":
      return forms.many ?? forms.few ?? forms.other ?? forms.one;
    default:
      return forms.other ?? forms.many ?? forms.few ?? forms.one;
  }
}

/** `5 файлов` — the count together with its correctly-inflected noun. */
export function pluralize(
  locale: Locale,
  count: number,
  forms: { one: string; few?: string; many?: string; other?: string },
): string {
  return `${count} ${plural(locale, count, forms)}`;
}
