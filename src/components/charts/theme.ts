/**
 * Shared chart theming.
 *
 * The app ships a single committed dark theme (see `src/app/globals.css`), so the
 * palette below is the DARK step of the reference categorical ramp, validated
 * against this app's chart surface (`--surface`, #14171c):
 *
 *   lightness band PASS · chroma floor PASS · adjacent CVD ΔE 8.4 PASS ·
 *   normal-vision ΔE 19.3 PASS · contrast ≥ 3:1 PASS
 *
 * RULES (do not break these when adding a chart):
 *  - Assign slots in FIXED ORDER. Colour follows the entity, never its rank, so a
 *    filter that removes a series must not repaint the survivors.
 *  - Never generate or cycle a 9th hue. Fold the tail into "Other" (`OTHER_COLOR`)
 *    or facet into small multiples — `foldToTop()` below does the folding.
 *  - Never use a status colour (success/warning/danger) for a plain data series.
 *  - Text always wears text tokens; only marks wear the series colour.
 *  - One y-axis per chart. Two measures of different scale = two charts.
 */

/** Categorical slots 1–8, in fixed order. */
export const CHART_COLORS = [
  "#3987e5", // 1 blue
  "#d95926", // 2 orange
  "#199e70", // 3 aqua
  "#c98500", // 4 yellow
  "#d55181", // 5 magenta
  "#008300", // 6 green
  "#9085e9", // 7 violet
  "#e66767", // 8 red
] as const;

/** Reserved neutral for the folded "Other" bucket. Never a categorical slot. */
export const OTHER_COLOR = "#6b7280";

/** Chart surface — must match `--surface` in globals.css. */
export const CHART_SURFACE = "#14171c";
/** Recessive grid/axis colour — one step off the surface (`--border`). */
export const CHART_GRID = "#2a2f38";
/** Text tokens. */
export const CHART_TEXT = "#e6e9ef";
export const CHART_TEXT_MUTED = "#9aa4b2";

/** Status tokens — ONLY for charts whose colour means good/bad (e.g. payout status). */
export const STATUS_COLORS = {
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
  neutral: OTHER_COLOR,
} as const;

/**
 * Colour for categorical slot `index` (0-based). Past slot 8 it returns the
 * neutral "Other" colour rather than inventing a hue — fold the data instead.
 */
export function colorForIndex(index: number): string {
  return CHART_COLORS[index] ?? OTHER_COLOR;
}

/* ------------------------------------------------------------ mark specs */

/** Bars: ≤24px thick, 4px rounded data-end, square at the baseline. */
export const BAR_MAX_SIZE = 24;
export const BAR_RADIUS_TOP: [number, number, number, number] = [4, 4, 0, 0];
export const BAR_RADIUS_RIGHT: [number, number, number, number] = [0, 4, 4, 0];

/** Lines: 2px, round join/cap. */
export const LINE_WIDTH = 2;

/**
 * 2px separation in the surface colour between touching marks (stacked segments,
 * adjacent bars). Implemented as a surface-coloured stroke: half of it falls
 * outside each segment, so two neighbours leave exactly 2px of surface showing.
 */
export const SEGMENT_GAP = {
  stroke: CHART_SURFACE,
  strokeWidth: 2,
} as const;

/** Dots/end markers: r ≥ 4 with a 2px surface ring so they stay legible on crossings. */
export function dotSpec(color: string) {
  return { r: 4, fill: color, stroke: CHART_SURFACE, strokeWidth: 2 } as const;
}

export function activeDotSpec(color: string) {
  return { r: 6, fill: color, stroke: CHART_SURFACE, strokeWidth: 2 } as const;
}

/* ---------------------------------------------------------- axis presets */

export const AXIS_PROPS = {
  stroke: CHART_GRID,
  tickLine: false,
  axisLine: false,
  tick: { fill: CHART_TEXT_MUTED, fontSize: 11 },
} as const;

export const GRID_PROPS = {
  stroke: CHART_GRID,
  strokeWidth: 1,
  vertical: false,
} as const;

export const LEGEND_PROPS = {
  wrapperStyle: { fontSize: 12, color: CHART_TEXT_MUTED, paddingTop: 8 },
  iconType: "circle" as const,
  iconSize: 8,
};

/* ------------------------------------------------------------- helpers */

/** Compact axis numbers: 1200 → "1.2K". Keeps y-axis ticks short and clean. */
export function compactAxisNumber(value: number | string): string {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return String(value);
  const abs = Math.abs(parsed);
  if (abs >= 1_000_000) return `${(parsed / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${(parsed / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(parsed);
}

export type SliceDatum = { name: string; value: number };

/**
 * Folds a categorical list to at most `max` slices, summing the tail into
 * "Other". Use this before EVERY pie/donut and any bar chart that could exceed
 * eight categories — it is the sanctioned alternative to a 9th hue.
 */
export function foldToTop(
  data: readonly SliceDatum[],
  max = 6,
  otherLabel = "Other",
): SliceDatum[] {
  if (data.length <= max) return [...data];
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, max - 1);
  const tail = sorted.slice(max - 1);
  const rest = tail.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  return [...head, { name: otherLabel, value: rest }];
}
