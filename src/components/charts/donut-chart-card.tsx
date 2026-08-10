"use client";

import { PieChartCard, type PieChartCardProps } from "@/components/charts/pie-chart-card";

export type DonutChartCardProps = Omit<PieChartCardProps, "innerRadiusRatio"> & {
  /** Inner radius as a fraction of the outer radius. Default 0.62. */
  thicknessRatio?: number;
};

/**
 * Donut variant of `PieChartCard`, with a hole reserved for a headline figure.
 *
 * Use for the document-compliance widget (valid / expiring / expired — a STATUS
 * chart, so pass `colorByName` with the status tokens) and other three-to-six
 * bucket compositions.
 *
 * ```tsx
 * <DonutChartCard
 *   title="Document compliance"
 *   data={[{ name: "Valid", value: 42 }, { name: "Expiring", value: 5 }, { name: "Expired", value: 2 }]}
 *   colorByName={{ Valid: STATUS_COLORS.success, Expiring: STATUS_COLORS.warning, Expired: STATUS_COLORS.danger }}
 *   centerValue="49"
 *   centerLabel="documents"
 * />
 * ```
 */
export function DonutChartCard({ thicknessRatio = 0.62, ...props }: DonutChartCardProps) {
  return <PieChartCard {...props} innerRadiusRatio={thicknessRatio} />;
}
