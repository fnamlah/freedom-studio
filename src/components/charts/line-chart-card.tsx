"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
  activeDotSpec,
  AXIS_PROPS,
  CHART_GRID,
  colorForIndex,
  compactAxisNumber,
  dotSpec,
  GRID_PROPS,
  LEGEND_PROPS,
  LINE_WIDTH,
} from "@/components/charts/theme";

export type LineChartCardProps = Omit<ChartFrameProps, "children"> & {
  data: readonly ChartDatum[];
  /** Datum key for the x axis (usually `month` or `week`). */
  xKey: string;
  /** One entry per line, in fixed order — slot 1 is the primary series. */
  series: readonly ChartSeries[];
  height?: number;
  /** Formats tooltip values and the y axis (e.g. `(v) => money(v)`). */
  valueFormat?: ValueFormat;
  /** Formats x-axis ticks and the tooltip heading (e.g. `(v) => month(v)`). */
  xFormat?: AxisFormat;
  emptyMessage?: string;
  /** Connects across null datapoints instead of breaking the line. */
  connectNulls?: boolean;
};

/**
 * Change-over-time chart. Single y-axis by design — two measures of different
 * scale get two charts, never a second axis.
 *
 * ```tsx
 * <LineChartCard
 *   title="Earnings trend"
 *   data={rows}
 *   xKey="month"
 *   series={[
 *     { key: "net_amount", label: "Net" },
 *     { key: "predicted_net", label: "Projected", dash: "6 4" },
 *   ]}
 *   valueFormatter={(v) => money(v)}
 *   xFormatter={(v) => month(String(v))}
 * />
 * ```
 */
export function LineChartCard({
  data,
  xKey,
  series,
  height = 280,
  valueFormat,
  xFormat,
  emptyMessage,
  connectNulls = false,
  ...frame
}: LineChartCardProps) {
  const valueFormatter = resolveValueFormat(valueFormat);
  const xFormatter = resolveAxisFormat(xFormat);
  const hasData = data.length > 0 && series.length > 0;

  return (
    <ChartFrame {...frame}>
      {!hasData ? (
        <ChartEmpty message={emptyMessage} height={height} />
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data as ChartDatum[]} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis
              dataKey={xKey}
              {...AXIS_PROPS}
              tickFormatter={xFormatter ? (value) => xFormatter(value as string | number) : undefined}
              minTickGap={16}
            />
            <YAxis
              {...AXIS_PROPS}
              width={64}
              tickFormatter={(value) =>
                valueFormatter ? valueFormatter(Number(value)) : compactAxisNumber(Number(value))
              }
            />
            <Tooltip
              cursor={{ stroke: CHART_GRID, strokeWidth: 1 }}
              content={
                <ChartTooltipContent
                  valueFormatter={valueFormatter}
                  labelFormatter={xFormatter}
                />
              }
            />
            {series.length > 1 ? <Legend {...LEGEND_PROPS} /> : null}
            {series.map((item, index) => {
              const color = item.color ?? colorForIndex(index);
              return (
                <Line
                  key={item.key}
                  type="monotone"
                  dataKey={item.key}
                  name={item.label ?? item.key}
                  stroke={color}
                  strokeWidth={LINE_WIDTH}
                  strokeDasharray={item.dash}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={data.length <= 24 ? dotSpec(color) : false}
                  activeDot={activeDotSpec(color)}
                  connectNulls={connectNulls}
                  isAnimationActive={false}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}
