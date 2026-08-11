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

export type GroupedBarCardProps = Omit<ChartFrameProps, "children"> & {
  data: readonly ChartDatum[];
  xKey: string;
  /** One bar per series within each x group, in fixed slot order. */
  series: readonly ChartSeries[];
  height?: number;
  valueFormat?: ValueFormat;
  xFormat?: AxisFormat;
  emptyMessage?: string;
};

/**
 * Side-by-side columns — comparison across a small number of groups.
 *
 * Backs "model-vs-model earnings, period comparison" (docs/07 §4). Keep the
 * series count low: past ~4 bars per group the chart stops being readable —
 * facet into small multiples instead.
 */
export function GroupedBarCard({
  data,
  xKey,
  series,
  height = 280,
  valueFormat,
  xFormat,
  emptyMessage,
  ...frame
}: GroupedBarCardProps) {
  const valueFormatter = resolveValueFormat(valueFormat);
  const xFormatter = resolveAxisFormat(xFormat);
  const hasData = data.length > 0 && series.length > 0;

  return (
    <ChartFrame {...frame}>
      {!hasData ? (
        <ChartEmpty message={emptyMessage} height={height} />
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={data as ChartDatum[]}
            margin={{ top: 12, right: 16, bottom: 4, left: 4 }}
            barGap={2}
            barCategoryGap="25%"
          >
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
                />
              }
            />
            {series.length > 1 ? <Legend {...LEGEND_PROPS} /> : null}
            {series.map((item, index) => (
              <Bar
                key={item.key}
                dataKey={item.key}
                name={item.label ?? item.key}
                fill={item.color ?? colorForIndex(index)}
                maxBarSize={BAR_MAX_SIZE}
                radius={BAR_RADIUS_TOP}
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
