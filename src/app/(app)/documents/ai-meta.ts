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

/**
 * The `ai_status` labels live in `d.documents.analysis.status` — keyed by the
 * same enum values. A status the dictionary has no entry for (a value added to
 * the enum ahead of the UI) falls back to the raw key rather than a blank.
 */
export function aiStatusLabel(
  labels: Record<string, string>,
  status: string,
): string {
  return labels[status] ?? status;
}
