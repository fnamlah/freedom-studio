import * as f from "@/lib/format";
import { plural } from "./index";
import { INTL_LOCALE, type Locale } from "./locales";

/**
 * Locale-bound formatters.
 *
 * `src/lib/format.ts` already accepts an optional `locale` on every Intl-backed
 * formatter — the seam existed, no caller ever used it. This module binds a
 * locale once so call sites read `fm.money(x)` instead of threading a locale
 * through every call, and it REPLACES the handful of formatters in that module
 * whose units were hardcoded English and which `Intl` cannot fix:
 *
 *   duration()  "2h 15m"  → "2 ч 15 мин"
 *   hours()     "2.3 h"   → "2,3 ч"     (note: also the decimal separator)
 *   fileSize()  "1.5 KB"  → "1,5 КБ"
 *
 * Those three used `toFixed()`, which always emits a dot — wrong in Russian
 * regardless of locale, since ru-RU uses a comma. They are re-implemented here
 * on `Intl.NumberFormat` rather than patched.
 *
 * `humanize()` is deliberately NOT re-exported: it upper-cases an English enum
 * key and can only ever produce English. Every remaining call site must use a
 * real label map instead.
 */

const UNITS = {
  en: { h: "h", m: "m", size: ["B", "KB", "MB", "GB", "TB"] },
  ru: { h: "ч", m: "мин", size: ["Б", "КБ", "МБ", "ГБ", "ТБ"] },
} as const;

export interface Formatters {
  locale: Locale;
  money: (value: f.Numeric, currency?: string, options?: f.MoneyOptions) => string;
  number: (value: f.Numeric, options?: Parameters<typeof f.number>[1]) => string;
  percent: (value: f.Numeric, options?: Parameters<typeof f.percent>[1]) => string;
  date: (value: f.DateLike) => string;
  dateTime: (value: f.DateLike) => string;
  month: (value: f.DateLike) => string;
  dateRange: (from: f.DateLike, to: f.DateLike) => string;
  relativeTime: (value: f.DateLike) => string;
  duration: (minutes: f.Numeric, fallback?: string) => string;
  hours: (minutes: f.Numeric, decimals?: number, fallback?: string) => string;
  fileSize: (bytes: f.Numeric, fallback?: string) => string;
  plural: (count: number, forms: { one: string; few?: string; many?: string }) => string;
}

const cacheByLocale = new Map<Locale, Formatters>();

export function fmt(locale: Locale): Formatters {
  const cached = cacheByLocale.get(locale);
  if (cached) return cached;

  const intl = INTL_LOCALE[locale];
  const units = UNITS[locale];
  const decimal = (value: number, decimals: number) =>
    new Intl.NumberFormat(intl, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);

  const formatters: Formatters = {
    locale,
    money: (value, currency, options) => f.money(value, currency, { ...options, locale: intl }),
    number: (value, options) => f.number(value, { ...options, locale: intl }),
    percent: (value, options) => f.percent(value, { ...options, locale: intl }),
    date: (value) => f.date(value, { locale: intl }),
    dateTime: (value) => f.dateTime(value, { locale: intl }),
    month: (value) => f.month(value, { locale: intl }),
    dateRange: (from, to) => f.dateRange(from, to, { locale: intl }),
    relativeTime: (value) => f.relativeTime(value, new Date(), intl),

    duration: (minutes, fallback = f.EM_DASH) => {
      const parsed = f.toNumber(minutes);
      if (parsed === null) return fallback;
      const total = Math.max(0, Math.round(parsed));
      const h = Math.floor(total / 60);
      const m = total % 60;
      if (h === 0) return `${m} ${units.m}`;
      if (m === 0) return `${h} ${units.h}`;
      return `${h} ${units.h} ${m} ${units.m}`;
    },

    hours: (minutes, decimals = 1, fallback = f.EM_DASH) => {
      const parsed = f.toNumber(minutes);
      if (parsed === null) return fallback;
      return `${decimal(parsed / 60, decimals)} ${units.h}`;
    },

    fileSize: (bytes, fallback = f.EM_DASH) => {
      const parsed = f.toNumber(bytes);
      if (parsed === null || parsed < 0) return fallback;
      if (parsed === 0) return `0 ${units.size[0]}`;
      const exponent = Math.min(
        units.size.length - 1,
        Math.floor(Math.log(parsed) / Math.log(1024)),
      );
      const value = parsed / 1024 ** exponent;
      const decimals = exponent === 0 || value >= 100 ? 0 : 1;
      return `${decimal(value, decimals)} ${units.size[exponent]}`;
    },

    plural: (count, forms) => plural(locale, count, forms),
  };

  cacheByLocale.set(locale, formatters);
  return formatters;
}
