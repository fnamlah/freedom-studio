/** Shared types + helpers for compliance-document AI analysis (migration 014). */

export type KeyFigure = { label: string; value: string };

/** Coerce the jsonb `ai_key_figures` column into a clean {label,value}[]. */
export function normaliseKeyFigures(raw: unknown): KeyFigure[] {
  if (!Array.isArray(raw)) return [];
  const out: KeyFigure[] = [];
  for (const item of raw) {
    if (item && typeof item === "object") {
      const label = (item as Record<string, unknown>).label;
      const value = (item as Record<string, unknown>).value;
      if (typeof label === "string" && typeof value === "string") {
        out.push({ label, value });
      }
    }
  }
  return out;
}

export const AI_STATUS_LABEL: Record<string, string> = {
  pending: "Not analysed",
  suggested: "Suggested",
  confirmed: "Analysed",
  overridden: "Analysed",
  skipped: "Skipped",
  failed: "Failed",
};
