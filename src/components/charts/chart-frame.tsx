"use client";

import type { ReactNode } from "react";

import { CHART_GRID, CHART_SURFACE, CHART_TEXT, CHART_TEXT_MUTED } from "@/components/charts/theme";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";

/** Series descriptor shared by the line and bar wrappers. */
export type ChartSeries = {
  /** Key in each datum object. */
  key: string;
  /** Legend/tooltip label. Defaults to `key`. */
  label?: string;
  /** Overrides the fixed categorical slot. Use only for status-coloured charts. */
  color?: string;
  /** Dashed stroke, e.g. "6 4" for a projection line. Line charts only. */
  dash?: string;
};

export type ChartDatum = Record<string, string | number | null | undefined>;

export type ChartFrameProps = {
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned slot for a filter or period selector. */
  action?: ReactNode;
  /** Rendered under the plot — footnotes, "as of" stamps. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
};

/**
 * Card chrome shared by every chart wrapper: title row, action slot, and a
 * consistent surface. Charts render inside it at a fixed height.
 */
export function ChartFrame({
  title,
  description,
  action,
  footer,
  className,
  children,
}: ChartFrameProps) {
  return (
    <section className={cn("rounded-lg border border-border bg-surface", className)}>
      {title || description || action ? (
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-2">
          <div className="min-w-0">
            {title ? (
              <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
            ) : null}
            {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className="px-2 pb-3">{children}</div>
      {footer ? <div className="border-t border-border px-5 py-2 text-xs text-muted">{footer}</div> : null}
    </section>
  );
}

/** Neutral in-chart empty state. Wording stays neutral — an empty set is often an RLS outcome. */
export function ChartEmpty({ message, height = 260 }: {
  message?: string;
  height?: number;
}) {
  const d = useDict();
  const text = message ?? d.money.charts.noData;
  return (
    <div
      style={{ height }}
      className="flex items-center justify-center px-5 text-center text-xs text-muted"
    >
      {text}
    </div>
  );
}

type TooltipEntry = {
  name?: string | number;
  value?: string | number | (string | number)[];
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
};

export type ChartTooltipContentProps = {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  /** Formats each value. Defaults to a localized number. */
  valueFormatter?: (value: number) => string;
  /** Formats the tooltip heading (the x value). */
  labelFormatter?: (label: string | number) => string;
  /** Appends a total row — useful on stacked bars. */
  showTotal?: boolean;
};

/**
 * Tooltip body. Values and names wear text tokens; identity comes from the
 * colour dot beside them, never from coloured text.
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  valueFormatter,
  labelFormatter,
  showTotal = false,
}: ChartTooltipContentProps) {
  const d = useDict();
  const fm = fmt(useLocale());

  if (!active || !payload || payload.length === 0) return null;

  const format = (value: unknown): string => {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return "—";
    // The bare fallback used to be `toLocaleString("en-US")` — a hardcoded
    // locale that would print "1,234.5" next to Russian axis labels.
    return valueFormatter ? valueFormatter(parsed) : fm.number(parsed);
  };

  const total = payload.reduce((sum, entry) => {
    const parsed = Number(Array.isArray(entry.value) ? entry.value[0] : entry.value);
    return sum + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);

  return (
    <div
      style={{ background: CHART_SURFACE, borderColor: CHART_GRID, color: CHART_TEXT }}
      className="rounded-md border px-3 py-2 text-xs shadow-lg"
    >
      {label !== undefined && label !== null ? (
        <p className="mb-1.5 font-medium" style={{ color: CHART_TEXT }}>
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {payload.map((entry, index) => (
          <li key={`${String(entry.dataKey ?? entry.name)}-${index}`} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              style={{ background: entry.color }}
              className="h-2 w-2 shrink-0 rounded-full"
            />
            <span style={{ color: CHART_TEXT_MUTED }} className="mr-3">
              {entry.name}
            </span>
            <span className="ml-auto tabular-nums" style={{ color: CHART_TEXT }}>
              {format(Array.isArray(entry.value) ? entry.value[0] : entry.value)}
            </span>
          </li>
        ))}
        {showTotal && payload.length > 1 ? (
          <li
            className="mt-1 flex items-center gap-2 border-t pt-1"
            style={{ borderColor: CHART_GRID }}
          >
            <span style={{ color: CHART_TEXT_MUTED }}>{d.common.total}</span>
            <span className="ml-auto font-medium tabular-nums" style={{ color: CHART_TEXT }}>
              {format(total)}
            </span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
