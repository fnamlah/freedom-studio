import type { Enums } from "@/lib/database.types";
import type { Dictionary } from "@/lib/i18n";

/**
 * Shared, CLIENT-SAFE vocabulary for the studio rate card (migration 025).
 *
 * The card pays each PARTY their own percentage of the model's weekly
 * (Sunday–Saturday) net, and each party carries its own brackets — the model's
 * break at 1501/2500 while the operator's and team leader's break at
 * 1501/3000. Which of the three model rows applies is decided by who is
 * assigned to her, not by anything stored on the model.
 *
 * No words here: labels live in `d.money.schemes.rates.party` so both locales
 * stay in the dictionary. Order is display order — the model's three tables
 * first, then the people around her.
 */

export type CommissionParty = Enums<"commission_party">;

export const COMMISSION_PARTIES: readonly CommissionParty[] = [
  "model_independent",
  "model_with_coach",
  "model_with_operator",
  "operator",
  "coach",
  "team_leader",
] as const;

/** One row of the card: a party's rate from a weekly-net threshold upward. */
export type RateRow = {
  party: CommissionParty;
  min_amount: number;
  percent: number;
};

/** The parties whose row is the MODEL's — exactly one applies per composition. */
export const MODEL_PARTIES: readonly CommissionParty[] = [
  "model_independent",
  "model_with_coach",
  "model_with_operator",
] as const;

export function isModelParty(party: CommissionParty): boolean {
  return (MODEL_PARTIES as readonly string[]).includes(party);
}

export function partyLabel(d: Dictionary, party: CommissionParty): string {
  return d.money.schemes.rates.party[party];
}

/**
 * The rate a party earns at `weekNet` — the highest threshold it reaches.
 * Mirrors `fn_rate_at` (025) exactly; used only to render the card's preview,
 * never to decide money. Returns null when the card has no row for the party.
 */
export function rateAt(
  rows: readonly RateRow[],
  party: CommissionParty,
  weekNet: number,
): number | null {
  let best: RateRow | null = null;
  for (const row of rows) {
    if (row.party !== party) continue;
    if (row.min_amount > weekNet) continue;
    if (!best || row.min_amount > best.min_amount) best = row;
  }
  return best ? best.percent : null;
}

/**
 * What the studio keeps for a composition at `weekNet`. Negative means the
 * card would pay out more than it takes in — `fn_set_commission_rates` refuses
 * to save such a card, and this is what warns before the save is attempted.
 */
export function studioRemainder(
  rows: readonly RateRow[],
  weekNet: number,
  composition: "independent" | "with_coach" | "with_operator" | "full",
): number {
  const model =
    composition === "independent"
      ? rateAt(rows, "model_independent", weekNet)
      : composition === "with_coach"
        ? rateAt(rows, "model_with_coach", weekNet)
        : rateAt(rows, "model_with_operator", weekNet);

  let paid = model ?? 0;
  if (composition === "with_operator" || composition === "full") {
    paid += rateAt(rows, "operator", weekNet) ?? 0;
  }
  if (composition === "with_coach" || composition === "full") {
    paid += rateAt(rows, "coach", weekNet) ?? 0;
  }
  if (composition === "full") {
    paid += rateAt(rows, "team_leader", weekNet) ?? 0;
  }
  return Math.round((100 - paid) * 100) / 100;
}

/**
 * Every threshold the card mentions, ascending, always including 0 — that is
 * the row that must exist for a party to be payable at all.
 */
export function thresholds(rows: readonly RateRow[]): number[] {
  return [...new Set([0, ...rows.map((r) => r.min_amount)])].sort((a, b) => a - b);
}
