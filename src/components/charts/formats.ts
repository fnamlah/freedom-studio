import { money, month, number, percent } from "@/lib/format";

/**
 * Serializable formatter descriptors for the chart cards.
 *
 * The cards are client components while every call site is a SERVER component;
 * React cannot serialize functions across that boundary, so callers name a
 * format here and the client resolves it to a function locally. Add a new
 * variant rather than ever reintroducing function props on a card.
 */
export type ValueFormat =
  | "money" // USD
  | "number"
  | "percent"
  | "percent-signed"
  | { money: string }; // explicit currency code
export type AxisFormat = "month";

export function resolveValueFormat(
  format?: ValueFormat,
): ((value: number) => string) | undefined {
  if (typeof format === "object") {
    return (value) => money(value, format.money);
  }
  switch (format) {
    case "money":
      return (value) => money(value);
    case "number":
      return (value) => number(value, { decimals: Number.isInteger(value) ? 0 : 1 });
    case "percent":
      return (value) => percent(value);
    case "percent-signed":
      return (value) => percent(value, { signed: true });
    default:
      return undefined;
  }
}

export function resolveAxisFormat(
  format?: AxisFormat,
): ((value: string | number) => string) | undefined {
  switch (format) {
    case "month":
      return (value) => month(String(value));
    default:
      return undefined;
  }
}
