import { fmt } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";

/**
 * Serializable formatter descriptors for the chart cards.
 *
 * The cards are client components while every call site is a SERVER component;
 * React cannot serialize functions across that boundary, so callers name a
 * format here and the client resolves it to a function locally. Add a new
 * variant rather than ever reintroducing function props on a card.
 *
 * The LOCALE is not part of the descriptor: it is read in the card itself with
 * `useLocale()` and passed in here. That keeps the serialized prop a plain
 * string and means a chart can never disagree with the rest of the page about
 * how a number is written.
 */
export type ValueFormat =
  | "money" // USD
  | "number"
  | "percent"
  | "percent-signed"
  | { money: string }; // explicit currency code
export type AxisFormat = "month";

export function resolveValueFormat(
  format: ValueFormat | undefined,
  locale: Locale,
): ((value: number) => string) | undefined {
  const fm = fmt(locale);
  if (typeof format === "object") {
    return (value) => fm.money(value, format.money);
  }
  switch (format) {
    case "money":
      return (value) => fm.money(value);
    case "number":
      return (value) => fm.number(value, { decimals: Number.isInteger(value) ? 0 : 1 });
    case "percent":
      return (value) => fm.percent(value);
    case "percent-signed":
      return (value) => fm.percent(value, { signed: true });
    default:
      return undefined;
  }
}

export function resolveAxisFormat(
  format: AxisFormat | undefined,
  locale: Locale,
): ((value: string | number) => string) | undefined {
  const fm = fmt(locale);
  switch (format) {
    case "month":
      return (value) => fm.month(String(value));
    default:
      return undefined;
  }
}
