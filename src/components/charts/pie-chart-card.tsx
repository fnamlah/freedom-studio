"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import {
  ChartEmpty,
  ChartFrame,
  ChartTooltipContent,
  type ChartFrameProps,
} from "@/components/charts/chart-frame";
import {
  colorForIndex,
  foldToTop,
  LEGEND_PROPS,
  OTHER_COLOR,
  SEGMENT_GAP,
  type SliceDatum,
} from "@/components/charts/theme";

export type PieChartCardProps = Omit<ChartFrameProps, "children"> & {
  /** Slices. Values must be non-negative; the component does not normalise them. */
  data: readonly SliceDatum[];
  height?: number;
  valueFormatter?: (value: number) => string;
  emptyMessage?: string;
  /** Max slices before the tail folds into "Other". Part-to-whole reads badly past 6. */
  maxSlices?: number;
  /** Explicit colour per slice name — for status pies (e.g. payout status). */
  colorByName?: Record<string, string>;
  /** Inner radius as a fraction of the outer radius. 0 = pie, >0 = donut. */
  innerRadiusRatio?: number;
  /** Center content for the donut variant. */
  centerLabel?: string;
  centerValue?: string;
};

/**
 * Part-to-whole at a glance. Use for composition (share by model / platform /
 * split bucket), never to compare close values — that is a bar chart.
 *
 * Anything past `maxSlices` folds into a neutral "Other" slice rather than
 * inventing a 9th hue.
 */
export function PieChartCard({
  data,
  height = 280,
  valueFormatter,
  emptyMessage,
  maxSlices = 6,
  colorByName,
  innerRadiusRatio = 0,
  centerLabel,
  centerValue,
  ...frame
}: PieChartCardProps) {
  const slices = foldToTop(data, maxSlices);
  const total = slices.reduce((sum, slice) => sum + (Number(slice.value) || 0), 0);
  const hasData = slices.length > 0 && total > 0;

  const outerRadius = Math.max(60, Math.min(110, height / 2 - 30));
  const innerRadius = innerRadiusRatio > 0 ? Math.round(outerRadius * innerRadiusRatio) : 0;

  return (
    <ChartFrame {...frame}>
      {!hasData ? (
        <ChartEmpty message={emptyMessage} height={height} />
      ) : (
        <div className="relative">
          <ResponsiveContainer width="100%" height={height}>
            <PieChart margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
              <Tooltip
                content={<ChartTooltipContent valueFormatter={valueFormatter} />}
              />
              <Legend {...LEGEND_PROPS} />
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={outerRadius}
                innerRadius={innerRadius}
                paddingAngle={0}
                isAnimationActive={false}
                {...SEGMENT_GAP}
              >
                {slices.map((slice, index) => (
                  <Cell
                    key={slice.name}
                    fill={
                      colorByName?.[slice.name] ??
                      (slice.name === "Other" ? OTHER_COLOR : colorForIndex(index))
                    }
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>

          {innerRadius > 0 && (centerValue || centerLabel) ? (
            <div
              className="pointer-events-none absolute inset-x-0 flex flex-col items-center justify-center"
              style={{ top: 8, height: height - 40 }}
            >
              {centerValue ? (
                <span className="text-lg font-semibold tabular-nums text-foreground">
                  {centerValue}
                </span>
              ) : null}
              {centerLabel ? (
                <span className="text-[11px] text-muted">{centerLabel}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </ChartFrame>
  );
}
