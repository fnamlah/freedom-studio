"use client";

import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EM_DASH } from "@/lib/format";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

import { modelStatusMeta, type ModelStatus } from "./status";

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
  const d = useDict();
  const fm = fmt(useLocale());

  if (rows.length === 0) {
    return (
      <EmptyState
        title={d.studio.models.emptyTitle}
        description={d.studio.models.emptyDescription}
      />
    );
  }

  return (
    <Table containerClassName="rounded-lg border border-border">
      <THead>
        <TR>
          <TH>{d.studio.models.colModel}</TH>
          <TH>{d.studio.models.colCountry}</TH>
          <TH>{d.studio.models.colStartDate}</TH>
          <TH align="right">{d.studio.models.colCommission}</TH>
          <TH>{d.studio.models.colStatus}</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((model) => {
          const meta = modelStatusMeta(d, model.status);
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
              <TD className="text-muted">
                {model.start_date ? fm.date(model.start_date) : EM_DASH}
              </TD>
              <TD numeric>{fm.percent(model.commission_percent)}</TD>
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
