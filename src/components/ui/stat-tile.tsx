import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StatTileTrend = {
  /** Percentage-point change vs the comparison period. Sign drives the colour. */
  value: number;
  label?: string;
  /** Set when "down" is the good direction (e.g. expired documents). */
  invert?: boolean;
};

export type StatTileProps = {
  label: string;
  /** Pre-formatted value — use `money()` / `percent()` / `duration()` from @/lib/format. */
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  trend?: StatTileTrend;
  /** Renders a muted skeleton in place of the value. */
  loading?: boolean;
  className?: string;
};

/**
 * KPI tile for the dashboard rows (docs/07-analytics.md §4, "KPI tiles").
 *
 * ```tsx
 * <StatTile label="Net revenue (MTD)" value={money(netTotal)} trend={{ value: 4.2 }} />
 * ```
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  trend,
  loading = false,
  className,
}: StatTileProps) {
  const positive = trend ? (trend.invert ? trend.value < 0 : trend.value > 0) : false;
  const negative = trend ? (trend.invert ? trend.value > 0 : trend.value < 0) : false;

  return (
    <div className={cn("min-w-0 rounded-lg border border-border bg-surface p-3 sm:p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium tracking-wide text-muted uppercase sm:text-xs">{label}</p>
        {icon ? <span className="shrink-0 text-muted">{icon}</span> : null}
      </div>

      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-surface-2" />
      ) : (
        <p className="mt-1.5 truncate text-xl font-semibold tabular-nums text-foreground sm:mt-2 sm:text-2xl">
          {value}
        </p>
      )}

      {(hint || trend) && !loading ? (
        <div className="mt-1.5 flex items-center gap-2 text-xs">
          {trend ? (
            <span
              className={cn(
                "font-medium tabular-nums",
                positive && "text-success",
                negative && "text-danger",
                !positive && !negative && "text-muted",
              )}
            >
              {trend.value > 0 ? "▲" : trend.value < 0 ? "▼" : "•"}{" "}
              {Math.abs(trend.value).toFixed(1)}%
              {trend.label ? <span className="ml-1 text-muted">{trend.label}</span> : null}
            </span>
          ) : null}
          {hint ? <span className="text-muted">{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Responsive grid wrapper for a row of tiles. */
export function StatTileRow({
  children,
  className,
  columns = 4,
}: {
  children: ReactNode;
  className?: string;
  columns?: 2 | 3 | 4 | 5;
}) {
  // Phones show tiles 2-up: one-per-row turned a 4-tile header into four
  // screens of scrolling before any actual content.
  const COLUMNS: Record<2 | 3 | 4 | 5, string> = {
    2: "grid-cols-2",
    3: "grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
    5: "grid-cols-2 lg:grid-cols-5",
  };
  return (
    <div className={cn("grid gap-3 sm:gap-4", COLUMNS[columns], className)}>{children}</div>
  );
}
