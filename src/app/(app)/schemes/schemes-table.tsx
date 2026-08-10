"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { date, EM_DASH, percent } from "@/lib/format";

import { deleteScheme } from "./actions";
import { SchemeForm, type EditableScheme } from "./scheme-form";
import { SCOPE_META, SCOPE_ORDER, STATUS_META, type SchemeRowView } from "./scheme-meta";

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
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No commission schemes yet"
        description="At least the studio default scheme should exist. If this is empty, the schema seed may not have run."
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {SCOPE_ORDER.map((scope) => {
        const group = rows.filter((r) => r.scope === scope);
        if (group.length === 0) return null;
        const meta = SCOPE_META[scope];

        return (
          <section key={scope}>
            <div className="mb-3 flex items-center gap-3">
              <Badge variant={meta.badge}>{meta.label}</Badge>
              <p className="text-xs text-muted">{meta.description}</p>
            </div>

            <Table containerClassName="rounded-lg border border-border">
              <THead>
                <TR>
                  <TH>{scope === "default" ? "Scope" : meta.short}</TH>
                  <TH align="right">Model</TH>
                  <TH align="right">Operator</TH>
                  <TH align="right">Studio</TH>
                  <TH>Effective</TH>
                  <TH>Status</TH>
                  {canWrite ? (
                    <TH align="right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  ) : null}
                </TR>
              </THead>
              <TBody>
                {group.map((row) => {
                  const status = STATUS_META[row.status];
                  return (
                    <TR key={row.id}>
                      <TD className="font-medium text-foreground">{row.scopeLabel}</TD>
                      <TD numeric>{percent(row.model_percent)}</TD>
                      <TD numeric>{percent(row.operator_percent)}</TD>
                      <TD numeric>{percent(row.studio_percent)}</TD>
                      <TD className="text-muted whitespace-nowrap">
                        {date(row.effective_from)}
                        {" – "}
                        {row.effective_to ? date(row.effective_to) : "open"}
                      </TD>
                      <TD>
                        <Badge variant={status.variant} dot>
                          {status.label}
                        </Badge>
                      </TD>
                      {canWrite ? (
                        <TD align="right">
                          <div className="flex items-center justify-end gap-2">
                            <SchemeForm mode="edit" scheme={toEditable(row)} />
                            {row.isDefault ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled
                                title="The studio default scheme can't be deleted."
                              >
                                Delete
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
        success("Scheme deleted", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error("Could not delete scheme", result.error);
      }
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Delete
      </Button>

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title="Delete commission scheme"
        description={`${SCOPE_META[row.scope].label} · ${row.scopeLabel}`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm} loading={isRunning}>
              Delete scheme
            </Button>
          </>
        }
      >
        <p className="text-sm text-foreground">
          This removes the split{" "}
          <span className="font-medium">
            {percent(row.model_percent)} / {percent(row.operator_percent)} /{" "}
            {percent(row.studio_percent)}
          </span>{" "}
          effective {date(row.effective_from)}
          {row.effective_to ? ` – ${date(row.effective_to)}` : " onward"}.
        </p>
        <p className="mt-2 text-xs text-muted">
          If this scheme has already produced ledger entries it can't be deleted — close it with an
          effective-to date instead so its history stays intact. {EM_DASH}
        </p>
      </Dialog>
    </>
  );
}
