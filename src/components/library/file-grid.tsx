"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { date, fileSize } from "@/lib/format";

import { deleteLibraryFile, getLibraryDownloadUrl } from "@/app/(app)/library/actions";

import { AiStatusBadge } from "./ai-status-badge";
import { CategoryBadge } from "./category-badge";
import type { CategoryLite, LibraryFileLite } from "./library-meta";

/**
 * The file grid (docs/12 §1). Each card carries the authoritative
 * `CategoryBadge`, the `ai_status` with its confidence, plus the folder, size
 * and upload date. Download issues a 60-second signed URL; a pending file can be
 * classified individually. `storage_path` is never rendered.
 */
export function FileGrid({
  files,
  categoryById,
  aiConfigured,
  classifyingId,
  onClassifyFile,
}: {
  files: LibraryFileLite[];
  categoryById: Map<string, CategoryLite>;
  aiConfigured: boolean;
  classifyingId: string | null;
  onClassifyFile: (fileId: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {files.map((file) => (
        <FileCard
          key={file.id}
          file={file}
          category={file.category_id ? categoryById.get(file.category_id) ?? null : null}
          aiConfigured={aiConfigured}
          classifying={classifyingId === file.id}
          onClassify={() => onClassifyFile(file.id)}
        />
      ))}
    </div>
  );
}

function FileCard({
  file,
  category,
  aiConfigured,
  classifying,
  onClassify,
}: {
  file: LibraryFileLite;
  category: CategoryLite | null;
  aiConfigured: boolean;
  classifying: boolean;
  onClassify: () => void;
}) {
  const router = useRouter();
  const { error, success } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  async function download() {
    const pre = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
    setDownloading(true);
    const res = await getLibraryDownloadUrl(file.id);
    setDownloading(false);
    if (res.ok) {
      if (pre && !pre.closed) {
        pre.location.href = res.url;
      } else {
        const a = document.createElement("a");
        a.href = res.url;
        a.rel = "noopener noreferrer";
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } else {
      pre?.close();
      error("Could not download", res.error);
    }
  }

  function remove() {
    startDelete(async () => {
      const res = await deleteLibraryFile(file.id);
      if (res.ok) {
        success("File deleted", res.message);
        setConfirmOpen(false);
        router.refresh();
      } else {
        error("Could not delete file", res.error);
      }
    });
  }

  const canClassify = aiConfigured && file.ai_status === "pending" && !file.ai_exempt;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground" title={file.name}>
            {file.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted" title={file.folder_path}>
            {file.folder_path}
          </p>
        </div>
        <AiStatusBadge status={file.ai_status} confidence={file.ai_confidence} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CategoryBadge category={category} />
        {file.ai_exempt ? (
          <span className="text-xs text-muted">Exempt</span>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="tabular-nums">{fileSize(file.size_bytes)}</span>
        <span>{date(file.created_at)}</span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" loading={downloading} onClick={download}>
          Download
        </Button>
        {canClassify ? (
          <Button variant="ghost" size="sm" loading={classifying} onClick={onClassify}>
            Classify
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-danger"
          onClick={() => setConfirmOpen(true)}
        >
          Delete
        </Button>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => (isDeleting ? undefined : setConfirmOpen(false))}
        dismissible={!isDeleting}
        title="Delete this file?"
        description="The file object and its metadata are removed. This cannot be undone."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="danger" loading={isDeleting} onClick={remove}>
              Delete file
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          <span className="font-medium text-foreground">{file.name}</span> in {file.folder_path}
        </p>
      </Dialog>
    </div>
  );
}
