"use client";

import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { date, EM_DASH, percent } from "@/lib/format";

import { MODEL_STATUS_META, type ModelStatus } from "./status";

export type ModelListRow = {
  id: string;
  stage_name: string;
  legal_name: string;
  status: ModelStatus;
  country: string | null;
  start_date: string | null;
  commission_percent: number;
};

/** Roster table. Rows navigate to the model's detail page. */
export function ModelsTable({ rows }: { rows: ModelListRow[] }) {
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No models to show"
        description="No models match this filter. Add one, or clear the status filter to see the full roster."
      />
    );
  }

  return (
    <Table containerClassName="rounded-lg border border-border">
      <THead>
        <TR>
          <TH>Model</TH>
          <TH>Country</TH>
          <TH>Start date</TH>
          <TH align="right">Commission</TH>
          <TH>Status</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((model) => {
          const meta = MODEL_STATUS_META[model.status];
          return (
            <TR
              key={model.id}
              interactive
              onClick={() => router.push(`/models/${model.id}`)}
            >
              <TD>
                <div className="font-medium text-foreground">{model.stage_name}</div>
                <div className="text-xs text-muted">{model.legal_name}</div>
              </TD>
              <TD className="text-muted">{model.country ?? EM_DASH}</TD>
              <TD className="text-muted">{model.start_date ? date(model.start_date) : EM_DASH}</TD>
              <TD numeric>{percent(model.commission_percent)}</TD>
              <TD>
                <Badge variant={meta.variant} dot>
                  {meta.label}
                </Badge>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
