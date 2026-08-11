"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ratioPercent } from "@/lib/format";

import { categorizeLibraryFile } from "@/app/(app)/library/actions";

import { CategoryBadge } from "./category-badge";
import type { CategoryLite, LibraryFileLite } from "./library-meta";

/**
 * Review queue (docs/12 §4.3) — files with `ai_status = 'suggested'`. Human
 * confirmation is the filing step: Confirm applies the AI's
 * `ai_suggested_category_id`; Override files under a different category. The
 * suggestion and the decision are kept as distinct states, so "what the machine
 * thought" and "what the studio decided" never blur.
 */
export function ReviewQueue({
  files,
  categories,
  categoryById,
}: {
  files: LibraryFileLite[];
  categories: CategoryLite[];
  categoryById: Map<string, CategoryLite>;
}) {
  if (files.length === 0) {
    return (
      <EmptyState
        title="Nothing to review"
        description="When the classifier proposes a category, the file appears here for you to confirm or override. The machine never files anything on its own."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {files.map((file) => (
        <ReviewRow
          key={file.id}
          file={file}
          categories={categories}
          suggestion={
            file.ai_suggested_category_id
              ? categoryById.get(file.ai_suggested_category_id) ?? null
              : null
          }
        />
      ))}
    </div>
  );
}

function ReviewRow({
  file,
  categories,
  suggestion,
}: {
  file: LibraryFileLite;
  categories: CategoryLite[];
  suggestion: CategoryLite | null;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [override, setOverride] = useState("");
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await categorizeLibraryFile({ file_id: file.id, decision: "confirm" });
      if (res.ok) {
        success("Suggestion confirmed", res.message);
        router.refresh();
      } else {
        error("Could not confirm", res.error);
      }
    });
  }

  function applyOverride() {
    if (!override) {
      error("Choose a category", "Pick a category to file this file under.");
      return;
    }
    startTransition(async () => {
      const res = await categorizeLibraryFile({
        file_id: file.id,
        decision: "override",
        category_id: override,
      });
      if (res.ok) {
        success("Filed", res.message);
        router.refresh();
      } else {
        error("Could not file", res.error);
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground" title={file.name}>
            {file.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted" title={file.folder_path}>
            {file.folder_path}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>Suggested</span>
          <CategoryBadge category={suggestion} />
          {file.ai_confidence !== null ? (
            <span className="tabular-nums">{ratioPercent(file.ai_confidence, { decimals: 0 })}</span>
          ) : null}
        </div>
      </div>

      {file.ai_rationale ? (
        <p className="mt-2 text-xs text-muted">
          <span className="font-medium text-foreground">Why: </span>
          {file.ai_rationale}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={confirm}
          loading={pending}
          disabled={!file.ai_suggested_category_id}
        >
          Confirm suggestion
        </Button>
        <span className="text-xs text-muted">or override:</span>
        <Select
          aria-label={`Override category for ${file.name}`}
          placeholder="Choose a category…"
          className="h-9 w-auto min-w-44"
          options={categories.map((c) => ({
            value: c.id,
            label: c.ai_enabled ? c.name : `${c.name} (AI off)`,
          }))}
          value={override}
          onChange={(e) => setOverride(e.target.value)}
        />
        <Button variant="outline" size="sm" onClick={applyOverride} loading={pending} disabled={!override}>
          Apply override
        </Button>
      </div>
    </div>
  );
}
