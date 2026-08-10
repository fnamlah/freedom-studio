"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartEmpty,
  ChartFrame,
  ChartTooltipContent,
  type ChartFrameProps,
} from "@/components/charts/chart-frame";
import {
  AXIS_PROPS,
  BAR_MAX_SIZE,
  BAR_RADIUS_RIGHT,
  CHART_GRID,
  CHART_TEXT_MUTED,
  colorForIndex,
  compactAxisNumber,
  STATUS_COLORS,
} from "@/components/charts/theme";

export type HorizontalBarDatum = {
  /** Category label shown on the y axis. */
  name: string;
  value: number;
  /** Overrides the bar colour — for negative balances, status, or emphasis. */
  color?: string;
};

export type HorizontalBarCardProps = Omit<ChartFrameProps, "children"> & {
  data: readonly HorizontalBarDatum[];
  height?: number;
  valueFormatter?: (value: number) => string;
  emptyMessage?: string;
  /**
   * A single measure across nominal categories is ONE series → one colour
   * (slot 1). Set `colorPerCategory` only when each row is a distinct entity
   * whose colour is reused elsewhere on the page.
   */
  colorPerCategory?: boolean;
  /** Draws negative values in the danger token — for payee balances. */
  highlightNegative?: boolean;
  /** Renders the value at the bar tip. */
  showValueLabels?: boolean;
  /** Width reserved for category labels. */
  categoryWidth?: number;
};

/**
 * Ranked horizontal bars — magnitude across named categories.
 *
 * Backs "payee outstanding balances" (docs/07 §4). Sort the data before passing
 * it in; the component does not reorder, so colour stays bound to the entity.
 */
export function HorizontalBarCard({
  data,
  height,
  valueFormatter,
  emptyMessage,
  colorPerCategory = false,
  highlightNegative = false,
  showValueLabels = true,
  categoryWidth = 120,
  ...frame
}: HorizontalBarCardProps) {
  const hasData = data.length > 0;
  const resolvedHeight = height ?? Math.max(180, data.length * 34 + 48);

  return (
    <ChartFrame {...frame}>
      {!hasData ? (
        <ChartEmpty message={emptyMessage} height={220} />
      ) : (
        <ResponsiveContainer width="100%" height={resolvedHeight}>
          <BarChart
            data={data as HorizontalBarDatum[]}
            layout="vertical"
            margin={{ top: 8, right: showValueLabels ? 56 : 16, bottom: 4, left: 4 }}
            barCategoryGap="30%"
          >
            <CartesianGrid stroke={CHART_GRID} strokeWidth={1} horizontal={false} />
            <XAxis
              type="number"
              {...AXIS_PROPS}
              tickFormatter={(value) =>
                valueFormatter ? valueFormatter(Number(value)) : compactAxisNumber(Number(value))
              }
            />
            <YAxis
              type="category"
              dataKey="name"
              {...AXIS_PROPS}
              width={categoryWidth}
              tick={{ fill: CHART_TEXT_MUTED, fontSize: 11 }}
            />
            <Tooltip
              cursor={{ fill: CHART_GRID, fillOpacity: 0.25 }}
              content={<ChartTooltipContent valueFormatter={valueFormatter} />}
            />
            <Bar
              dataKey="value"
              name="Value"
              maxBarSize={BAR_MAX_SIZE}
              radius={BAR_RADIUS_RIGHT}
              isAnimationActive={false}
            >
              {data.map((datum, index) => (
                <Cell
                  key={datum.name}
                  fill={
                    datum.color ??
                    (highlightNegative && datum.value < 0
                      ? STATUS_COLORS.danger
                      : colorForIndex(colorPerCategory ? index : 0))
                  }
                />
              ))}
              {showValueLabels ? (
                <LabelList
                  dataKey="value"
                  position="right"
                  fill={CHART_TEXT_MUTED}
                  fontSize={11}
                  formatter={(value: number | string) =>
                    valueFormatter
                      ? valueFormatter(Number(value))
                      : compactAxisNumber(Number(value))
                  }
                />
              ) : null}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}
