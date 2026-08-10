/**
 * Display formatters. Pure, dependency-free, safe on both server and client.
 *
 * Every formatter is null-tolerant and returns `EM_DASH` for missing values, so
 * table cells never render "null" or "NaN". Locale defaults to `en-US` and the
 * time zone to UTC, keeping server-rendered and client-rendered output identical
 * (mismatched output is a hydration error, not a cosmetic issue).
 */

export const EM_DASH = "—";

const DEFAULT_LOCALE = "en-US";
const DEFAULT_TIME_ZONE = "UTC";

export type Numeric = number | string | null | undefined;
export type DateLike = Date | string | number | null | undefined;

/** Coerces PostgREST `numeric` (which may arrive as a string) to a number. */
export function toNumber(value: Numeric): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDate(value: DateLike): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  // Bare `YYYY-MM-DD` (a Postgres `date`) is parsed as UTC midnight, which with
  // a UTC display time zone round-trips exactly.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* --------------------------------------------------------------- money --- */

export type MoneyOptions = {
  locale?: string;
  /** Force decimals. Defaults to 2 (the `numeric(12,2)` money convention). */
  decimals?: number;
  /** Prefix positive values with "+". Useful for ledger credits. */
  signed?: boolean;
  /** Render as `1.2K` / `3.4M` instead of full precision. */
  compact?: boolean;
  fallback?: string;
};

/**
 * Formats a money amount. Currency codes are the `char(3)` values stored on the
 * row (`USD` by default per docs/04 §1).
 *
 * ```ts
 * money(1234.5)                 // "$1,234.50"
 * money("-80", "EUR")           // "-€80.00"
 * money(42, "USD", { signed: true }) // "+$42.00"
 * ```
 */
export function money(
  amount: Numeric,
  currency: string = "USD",
  options: MoneyOptions = {},
): string {
  const value = toNumber(amount);
  if (value === null) return options.fallback ?? EM_DASH;

  const decimals = options.decimals ?? 2;
  const code = (currency || "USD").toUpperCase();

  let formatted: string;
  try {
    formatted = new Intl.NumberFormat(options.locale ?? DEFAULT_LOCALE, {
      style: "currency",
      currency: code,
      minimumFractionDigits: options.compact ? 0 : decimals,
      maximumFractionDigits: options.compact ? 1 : decimals,
      notation: options.compact ? "compact" : "standard",
    }).format(value);
  } catch {
    // Unknown currency code — fall back to a plain number plus the raw code.
    formatted = `${number(value, { decimals })} ${code}`;
  }

  return options.signed && value > 0 ? `+${formatted}` : formatted;
}

/** Currency symbol only, e.g. `$` for USD. Falls back to the code itself. */
export function currencySymbol(currency = "USD", locale = DEFAULT_LOCALE): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

/* ------------------------------------------------------------- numbers --- */

export type NumberOptions = {
  locale?: string;
  decimals?: number;
  compact?: boolean;
  signed?: boolean;
  fallback?: string;
};

/** Plain localized number. */
export function number(value: Numeric, options: NumberOptions = {}): string {
  const parsed = toNumber(value);
  if (parsed === null) return options.fallback ?? EM_DASH;

  const formatted = new Intl.NumberFormat(options.locale ?? DEFAULT_LOCALE, {
    minimumFractionDigits: options.decimals,
    maximumFractionDigits: options.decimals ?? (options.compact ? 1 : 2),
    notation: options.compact ? "compact" : "standard",
  }).format(parsed);

  return options.signed && parsed > 0 ? `+${formatted}` : formatted;
}

/**
 * Formats a percentage. Input is a PERCENTAGE POINT value (the `numeric(5,2)`
 * convention), i.e. `12.5` renders as `12.5%` — not `0.125`.
 *
 * ```ts
 * percent(12.5)            // "12.5%"
 * percent(100)             // "100%"
 * percent(3.2, { signed: true }) // "+3.2%"
 * ```
 */
export function percent(
  value: Numeric,
  options: { locale?: string; decimals?: number; signed?: boolean; fallback?: string } = {},
): string {
  const parsed = toNumber(value);
  if (parsed === null) return options.fallback ?? EM_DASH;

  const decimals =
    options.decimals ?? (Number.isInteger(parsed) ? 0 : 1);

  const formatted = new Intl.NumberFormat(options.locale ?? DEFAULT_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(parsed);

  return `${options.signed && parsed > 0 ? "+" : ""}${formatted}%`;
}

/** Converts a 0–1 ratio to a percentage string. `ratioPercent(0.125)` → `"12.5%"`. */
export function ratioPercent(
  value: Numeric,
  options: { locale?: string; decimals?: number; fallback?: string } = {},
): string {
  const parsed = toNumber(value);
  if (parsed === null) return options.fallback ?? EM_DASH;
  return percent(parsed * 100, options);
}

/* --------------------------------------------------------------- dates --- */

/** `2026-08-10` → `"Aug 10, 2026"`. */
export function date(value: DateLike, options: { locale?: string; fallback?: string } = {}): string {
  const parsed = toDate(value);
  if (!parsed) return options.fallback ?? EM_DASH;
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: DEFAULT_TIME_ZONE,
  }).format(parsed);
}

/** `2026-08-10` → `"2026-08-10"`. Machine-readable, for inputs and keys. */
export function isoDate(value: DateLike, fallback = ""): string {
  const parsed = toDate(value);
  if (!parsed) return fallback;
  return parsed.toISOString().slice(0, 10);
}

/** `"Aug 10, 2026, 14:05 UTC"`. */
export function dateTime(
  value: DateLike,
  options: { locale?: string; fallback?: string } = {},
): string {
  const parsed = toDate(value);
  if (!parsed) return options.fallback ?? EM_DASH;
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: DEFAULT_TIME_ZONE,
    timeZoneName: "short",
  }).format(parsed);
}

/** `2026-08-01` → `"Aug 2026"`. For month-grain analytics axes. */
export function month(value: DateLike, options: { locale?: string; fallback?: string } = {}): string {
  const parsed = toDate(value);
  if (!parsed) return options.fallback ?? EM_DASH;
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    year: "numeric",
    month: "short",
    timeZone: DEFAULT_TIME_ZONE,
  }).format(parsed);
}

/** `2026-08-01` → `"2026-08"`. First day of the month, machine-readable. */
export function isoMonth(value: DateLike, fallback = ""): string {
  const parsed = toDate(value);
  if (!parsed) return fallback;
  return parsed.toISOString().slice(0, 7);
}

/** `"Aug 1 – Aug 31, 2026"`. Collapses shared month/year where possible. */
export function dateRange(
  from: DateLike,
  to: DateLike,
  options: { locale?: string; fallback?: string } = {},
): string {
  const start = toDate(from);
  const end = toDate(to);
  if (!start && !end) return options.fallback ?? EM_DASH;
  if (!start) return date(end, options);
  if (!end) return `${date(start, options)} →`;

  const locale = options.locale ?? DEFAULT_LOCALE;
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startText = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone: DEFAULT_TIME_ZONE,
  }).format(start);

  return `${startText} – ${date(end, options)}`;
}

/** `"3 days ago"`, `"in 2 months"`. Relative to `now` (defaults to current time). */
export function relativeTime(
  value: DateLike,
  now: Date = new Date(),
  locale = DEFAULT_LOCALE,
): string {
  const parsed = toDate(value);
  if (!parsed) return EM_DASH;

  const diffSeconds = Math.round((parsed.getTime() - now.getTime()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
    ["second", 1],
  ];

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, seconds] of units) {
    if (Math.abs(diffSeconds) >= seconds || unit === "second") {
      return formatter.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return formatter.format(0, "second");
}

/** Whole days from today until `value`; negative when in the past. */
export function daysUntil(value: DateLike, now: Date = new Date()): number | null {
  const parsed = toDate(value);
  if (!parsed) return null;
  const msPerDay = 86_400_000;
  const a = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / msPerDay);
}

/* ------------------------------------------------------------ durations --- */

/** `135` → `"2h 15m"`. Session durations are stored in minutes (docs/04 §4.6). */
export function duration(minutes: Numeric, fallback = EM_DASH): string {
  const parsed = toNumber(minutes);
  if (parsed === null) return fallback;

  const total = Math.max(0, Math.round(parsed));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/** `135` minutes → `"2.3 h"`. For chart axes that need a single unit. */
export function hours(minutes: Numeric, decimals = 1, fallback = EM_DASH): string {
  const parsed = toNumber(minutes);
  if (parsed === null) return fallback;
  return `${(parsed / 60).toFixed(decimals)} h`;
}

/* ----------------------------------------------------------- file sizes --- */

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * `1536` → `"1.5 KB"`. Binary (1024) steps, matching what storage backends report.
 */
export function fileSize(bytes: Numeric, fallback = EM_DASH): string {
  const parsed = toNumber(bytes);
  if (parsed === null || parsed < 0) return fallback;
  if (parsed === 0) return "0 B";

  const exponent = Math.min(
    SIZE_UNITS.length - 1,
    Math.floor(Math.log(parsed) / Math.log(1024)),
  );
  const value = parsed / 1024 ** exponent;
  const decimals = exponent === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 1;

  return `${value.toFixed(decimals)} ${SIZE_UNITS[exponent]}`;
}

/* ---------------------------------------------------------------- misc --- */

/** Truncates to `max` characters on a word boundary, appending an ellipsis. */
export function truncate(value: string | null | undefined, max = 80): string {
  if (!value) return "";
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** `"super_admin"` → `"Super admin"`. For enum values without a label map. */
export function humanize(value: string | null | undefined, fallback = EM_DASH): string {
  if (!value) return fallback;
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Two-letter initials for avatar placeholders. */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
