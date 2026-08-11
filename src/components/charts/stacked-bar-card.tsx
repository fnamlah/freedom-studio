"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  resolveAxisFormat,
  resolveValueFormat,
  type AxisFormat,
  type ValueFormat,
} from "./formats";

import {
  ChartEmpty,
  ChartFrame,
  ChartTooltipContent,
  type ChartDatum,
  type ChartFrameProps,
  type ChartSeries,
} from "@/components/charts/chart-frame";
import {
  AXIS_PROPS,
  BAR_MAX_SIZE,
  BAR_RADIUS_TOP,
  CHART_GRID,
  colorForIndex,
  compactAxisNumber,
  GRID_PROPS,
  LEGEND_PROPS,
  SEGMENT_GAP,
} from "@/components/charts/theme";

export type StackedBarCardProps = Omit<ChartFrameProps, "children"> & {
  data: readonly ChartDatum[];
  xKey: string;
  /** Stack segments, bottom to top, in fixed slot order. */
  series: readonly ChartSeries[];
  height?: number;
  valueFormat?: ValueFormat;
  xFormat?: AxisFormat;
  emptyMessage?: string;
  /** Adds a Total row to the tooltip. Default true — the point of a stack. */
  showTotal?: boolean;
};

/**
 * Stacked columns — composition over time.
 *
 * Used by "forecast breakdown by model" and "payout history by status"
 * (docs/07-analytics.md §4). For status stacks pass explicit `color` values from
 * `STATUS_COLORS`; otherwise let the fixed categorical order assign them.
 *
 * Segments are separated by a 2px surface-coloured gap, not by borders.
 */
export function StackedBarCard({
  data,
  xKey,
  series,
  height = 280,
  valueFormat,
  xFormat,
  emptyMessage,
  showTotal = true,
  ...frame
}: StackedBarCardProps) {
  const valueFormatter = resolveValueFormat(valueFormat);
  const xFormatter = resolveAxisFormat(xFormat);
  const hasData = data.length > 0 && series.length > 0;

  return (
    <ChartFrame {...frame}>
      {!hasData ? (
        <ChartEmpty message={emptyMessage} height={height} />
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data as ChartDatum[]} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis
              dataKey={xKey}
              {...AXIS_PROPS}
              tickFormatter={xFormatter ? (value) => xFormatter(value as string | number) : undefined}
              minTickGap={12}
            />
            <YAxis
              {...AXIS_PROPS}
              width={64}
              tickFormatter={(value) =>
                valueFormatter ? valueFormatter(Number(value)) : compactAxisNumber(Number(value))
              }
            />
            <Tooltip
              cursor={{ fill: CHART_GRID, fillOpacity: 0.25 }}
              content={
                <ChartTooltipContent
                  valueFormatter={valueFormatter}
                  labelFormatter={xFormatter}
                  showTotal={showTotal}
                />
              }
            />
            {series.length > 1 ? <Legend {...LEGEND_PROPS} /> : null}
            {series.map((item, index) => (
              <Bar
                key={item.key}
                dataKey={item.key}
                name={item.label ?? item.key}
                stackId="stack"
                fill={item.color ?? colorForIndex(index)}
                maxBarSize={BAR_MAX_SIZE}
                radius={index === series.length - 1 ? BAR_RADIUS_TOP : undefined}
                isAnimationActive={false}
                {...SEGMENT_GAP}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}
