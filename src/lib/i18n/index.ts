import { en, type Dictionary } from "./en";
import { ru } from "./ru";
import { DEFAULT_LOCALE, type Locale } from "./locales";

export type { Dictionary } from "./en";
export {
  DEFAULT_LOCALE,
  INTL_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  LOCALE_NAMES,
  LOCALES,
  toLocale,
  type Locale,
} from "./locales";

const DICTIONARIES: Record<Locale, Dictionary> = { en, ru };

/**
 * The whole dictionary for a locale. Consumers use plain property access
 * (`dict(locale).nav.library`) rather than a `t("nav.library")` string path, so
 * TypeScript checks every single reference — a renamed or deleted key fails the
 * build instead of rendering an empty span at runtime.
 */
export function dict(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

/** Re-exported from ./locales so `import { plural } from "@/lib/i18n"` keeps working. */
export { plural } from "./locales";

