"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { EM_DASH } from "@/lib/format";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

import { deleteScheme } from "./actions";
import { SchemeForm, type EditableScheme } from "./scheme-form";
import { SCOPE_META, SCOPE_ORDER, STATUS_VARIANT, type SchemeRowView } from "./scheme-meta";
import { TierDialog } from "./tier-dialog";

/**
 * Schemes grouped by scope, in resolution order (account → model → default, most
 * specific first — docs/09 §4.1). Each row shows its three-way split, effective
 * range and status. Edit/delete controls render only for writers (Super Admin);
 * Managers see the same table read-only.
 */
export function SchemesTable({
  rows,
  canWrite,
}: {
  rows: SchemeRowView[];
  canWrite: boolean;
}) {
  const d = useDict();
  const fm = fmt(useLocale());

  /**
   * A percentage column, honestly. With income tiers (023) a scheme has no
   * single model share — it has a range that the week's earnings pick from — so
   * the cell shows the whole span rather than a base rate that may never be the
   * one actually paid. Schemes without tiers read exactly as they always did.
   */
  function span(row: SchemeRowView, key: "model_percent" | "operator_percent" | "studio_percent") {
    if (row.tiers.length === 0) return fm.percent(row[key]);
    const values = [row[key], ...row.tiers.map((t) => t[key])];
    const low = Math.min(...values);
    const high = Math.max(...values);
    return low === high ? fm.percent(low) : `${fm.percent(low)} – ${fm.percent(high)}`;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={d.money.schemes.tableEmptyTitle}
        description={d.money.schemes.tableEmptyDesc}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {SCOPE_ORDER.map((scope) => {
        const group = rows.filter((r) => r.scope === scope);
        if (group.length === 0) return null;
        const meta = SCOPE_META[scope];
        const words = d.money.schemes.scope[scope];

        return (
          <section key={scope}>
            <div className="mb-3 flex items-center gap-3">
              <Badge variant={meta.badge}>{words.label}</Badge>
              <p className="text-xs text-muted">{words.description}</p>
            </div>

            <Table containerClassName="rounded-lg border border-border">
              <THead>
                <TR>
                  <TH>{scope === "default" ? d.money.schemes.colScope : words.short}</TH>
                  <TH align="right">{d.money.schemes.colModel}</TH>
                  <TH align="right">{d.money.schemes.colOperator}</TH>
                  <TH align="right">{d.money.schemes.colStudio}</TH>
                  <TH>{d.money.schemes.colEffective}</TH>
                  <TH>{d.common.status}</TH>
                  {canWrite ? (
                    <TH align="right">
                      <span className="sr-only">{d.common.actions}</span>
                    </TH>
                  ) : null}
                </TR>
              </THead>
              <TBody>
                {group.map((row) => {
                  return (
                    <TR key={row.id}>
                      <TD className="font-medium text-foreground">{row.scopeLabel}</TD>
                      <TD numeric>{span(row, "model_percent")}</TD>
                      <TD numeric>{span(row, "operator_percent")}</TD>
                      <TD numeric>{span(row, "studio_percent")}</TD>
                      <TD className="text-muted whitespace-nowrap">
                        {fm.date(row.effective_from)}
                        {" – "}
                        {row.effective_to ? fm.date(row.effective_to) : d.money.schemes.openEnded}
                      </TD>
                      <TD>
                        <Badge variant={STATUS_VARIANT[row.status]} dot>
                          {d.money.schemes.status[row.status]}
                        </Badge>
                      </TD>
                      {canWrite ? (
                        <TD align="right">
                          <div className="flex items-center justify-end gap-2">
                            <TierDialog
                              schemeId={row.id}
                              scopeLabel={`${d.money.schemes.scope[row.scope].label} · ${row.scopeLabel}`}
                              base={{
                                model_percent: row.model_percent,
                                operator_percent: row.operator_percent,
                                studio_percent: row.studio_percent,
                              }}
                              tiers={row.tiers}
                            />
                            <SchemeForm mode="edit" scheme={toEditable(row)} />
                            {row.isDefault ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled
                                title={d.money.schemes.defaultCantDelete}
                              >
                                {d.common.delete}
                              </Button>
                            ) : (
                              <DeleteSchemeButton row={row} />
                            )}
                          </div>
                        </TD>
                      ) : null}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </section>
        );
      })}
    </div>
  );
}

function toEditable(row: SchemeRowView): EditableScheme {
  return {
    id: row.id,
    scope: row.scope,
    scopeLabel: row.scopeLabel,
    model_percent: row.model_percent,
    operator_percent: row.operator_percent,
    studio_percent: row.studio_percent,
    effective_from: row.effective_from,
    effective_to: row.effective_to,
    notes: row.notes,
  };
}

/**
 * Delete with an explicit confirmation (schemes carry money-math provenance).
 * The default scheme never reaches this control — the table renders a disabled
 * button for it — but the server action refuses it regardless (docs/04 §4.9).
 */
function DeleteSchemeButton({ row }: { row: SchemeRowView }) {
  const router = useRouter();
  const d = useDict();
  const fm = fmt(useLocale());
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();

  function close() {
    if (isRunning) return;
    setOpen(false);
  }

  function confirm() {
    startTransition(async () => {
      const result = await deleteScheme({ id: row.id });
      if (result.ok) {
        success(d.money.schemes.deleteToastOk, result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(d.money.schemes.deleteToastErr, result.error);
      }
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {d.common.delete}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={d.money.schemes.deleteTitle}
        description={`${d.money.schemes.scope[row.scope].label} · ${row.scopeLabel}`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button variant="danger" onClick={confirm} loading={isRunning}>
              {d.money.schemes.deleteConfirm}
            </Button>
          </>
        }
      >
        {/* One sentence, one dictionary entry: the split and the effective
            window are values inside it, not translated fragments glued around
            emphasis spans. */}
        <p className="text-sm text-foreground">
          {d.money.schemes.deleteBody(
            `${fm.percent(row.model_percent)} / ${fm.percent(row.operator_percent)} / ${fm.percent(row.studio_percent)}`,
            row.effective_to
              ? d.money.schemes.deleteRange(fm.date(row.effective_from), fm.date(row.effective_to))
              : d.money.schemes.deleteOnward(fm.date(row.effective_from)),
          )}
        </p>
        <p className="mt-2 text-xs text-muted">
          {d.money.schemes.deleteNote} {EM_DASH}
        </p>
      </Dialog>
    </>
  );
}
