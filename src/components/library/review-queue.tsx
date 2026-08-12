"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

import { categorizeLibraryFile } from "@/app/(app)/library/actions";

import { CategoryBadge } from "./category-badge";
import { categoryName, type CategoryLite, type LibraryFileLite } from "./library-meta";

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
  const d = useDict();

  if (files.length === 0) {
    return (
      <EmptyState
        title={d.library.reviewEmptyTitle}
        description={d.library.reviewEmptyDescription}
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
  const d = useDict();
  const locale = useLocale();
  const fm = fmt(locale);
  const [override, setOverride] = useState("");
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await categorizeLibraryFile({ file_id: file.id, decision: "confirm" });
      if (res.ok) {
        success(d.library.confirmedTitle, res.message);
        router.refresh();
      } else {
        error(d.library.confirmFailedTitle, res.error);
      }
    });
  }

  function applyOverride() {
    if (!override) {
      error(d.library.chooseCategoryTitle, d.library.chooseCategoryBody);
      return;
    }
    startTransition(async () => {
      const res = await categorizeLibraryFile({
        file_id: file.id,
        decision: "override",
        category_id: override,
      });
      if (res.ok) {
        success(d.library.filedTitle, res.message);
        router.refresh();
      } else {
        error(d.library.fileFailedTitle, res.error);
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
          <span>{d.library.suggestedLabel}</span>
          <CategoryBadge category={suggestion} />
          {file.ai_confidence !== null ? (
            <span className="tabular-nums">
              {fm.percent(file.ai_confidence * 100, { decimals: 0 })}
            </span>
          ) : null}
        </div>
      </div>

      {file.ai_summary ? (
        <p className="mt-2 text-sm whitespace-pre-wrap text-foreground">{file.ai_summary}</p>
      ) : null}

      {file.ai_key_figures.length > 0 ? (
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {file.ai_key_figures.map((f, i) => (
            <div key={i} className="flex items-baseline gap-1.5 text-xs">
              <dt className="text-muted">{f.label}:</dt>
              <dd className="font-medium tabular-nums text-foreground">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {file.ai_rationale ? (
        <p className="mt-2 text-xs text-muted">
          <span className="font-medium text-foreground">{d.library.why}</span>
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
          {d.library.confirmSuggestion}
        </Button>
        <span className="text-xs text-muted">{d.library.orOverride}</span>
        <Select
          aria-label={d.library.overrideAria(file.name)}
          placeholder={d.library.chooseCategoryPlaceholder}
          className="h-9 w-auto min-w-44"
          options={categories.map((c) => {
            const name = categoryName(c, locale);
            return { value: c.id, label: c.ai_enabled ? name : d.library.aiOff(name) };
          })}
          value={override}
          onChange={(e) => setOverride(e.target.value)}
        />
        <Button variant="outline" size="sm" onClick={applyOverride} loading={pending} disabled={!override}>
          {d.library.applyOverride}
        </Button>
      </div>
    </div>
  );
}
