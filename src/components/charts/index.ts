/**
 * Chart wrappers. Every component here is a client component (`"use client"`),
 * so server components pass already-scoped, serialized rows straight in — the
 * browser never holds a query capability (docs/07-analytics.md §6).
 *
 * ```ts
 * import { LineChartCard, DonutChartCard, CHART_COLORS } from "@/components/charts";
 * ```
 */

export {
  ChartEmpty,
  ChartFrame,
  ChartTooltipContent,
  type ChartDatum,
  type ChartFrameProps,
  type ChartSeries,
  type ChartTooltipContentProps,
} from "./chart-frame";

export { LineChartCard, type LineChartCardProps } from "./line-chart-card";
export { PieChartCard, type PieChartCardProps } from "./pie-chart-card";
export { DonutChartCard, type DonutChartCardProps } from "./donut-chart-card";
export { StackedBarCard, type StackedBarCardProps } from "./stacked-bar-card";
export { GroupedBarCard, type GroupedBarCardProps } from "./grouped-bar-card";
export {
  HorizontalBarCard,
  type HorizontalBarCardProps,
  type HorizontalBarDatum,
} from "./horizontal-bar-card";

export {
  activeDotSpec,
  AXIS_PROPS,
  axisLabelWidth,
  BAR_MAX_SIZE,
  BAR_RADIUS_RIGHT,
  BAR_RADIUS_TOP,
  CHART_COLORS,
  CHART_GRID,
  CHART_SURFACE,
  CHART_TEXT,
  CHART_TEXT_MUTED,
  colorForIndex,
  compactAxisNumber,
  dotSpec,
  foldToTop,
  GRID_PROPS,
  LEGEND_PROPS,
  LINE_WIDTH,
  OTHER_COLOR,
  SEGMENT_GAP,
  STATUS_COLORS,
  valueLabelSpace,
  type SliceDatum,
} from "./theme";
