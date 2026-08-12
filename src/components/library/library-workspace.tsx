"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n/client";

import { FileGrid } from "./file-grid";
import { FolderTree } from "./folder-tree";
import {
  buildFolderTree,
  isInFolder,
  normalizeFolderPath,
  runClassify,
  type CategoryLite,
  type LibraryFileLite,
} from "./library-meta";
import { ReviewQueue } from "./review-queue";
import { UploadDialog } from "./upload-dialog";

/**
 * The Library workspace (docs/12). Owns the interactive state the server page
 * cannot: the selected folder, the client-driven batch classification loop
 * (docs/12 §4.4 — re-invoke while `remaining > 0`), and the graceful "AI not
 * configured" fallback when the Wave-2 route/provider is not ready.
 */
export function LibraryWorkspace({
  files,
  categories,
  aiConfigured,
  aiMaxFileMb,
}: {
  files: LibraryFileLite[];
  categories: CategoryLite[];
  aiConfigured: boolean;
  aiMaxFileMb: number;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const d = useDict();

  const [selectedFolder, setSelectedFolder] = useState("/");
  const [notConfigured, setNotConfigured] = useState(!aiConfigured);
  const [classifyingAll, setClassifyingAll] = useState(false);
  const [classifyingId, setClassifyingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; remaining: number } | null>(null);

  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const folderTree = useMemo(
    () => buildFolderTree(files, d.library.allFiles),
    [files, d.library.allFiles],
  );

  const existingFolders = useMemo(() => {
    const set = new Set<string>(["/"]);
    for (const file of files) set.add(normalizeFolderPath(file.folder_path));
    return Array.from(set).sort();
  }, [files]);

  const filteredFiles = useMemo(
    () => files.filter((file) => isInFolder(file.folder_path, selectedFolder)),
    [files, selectedFolder],
  );

  const suggestedFiles = useMemo(
    () => files.filter((file) => file.ai_status === "suggested"),
    [files],
  );

  const pendingCount = useMemo(
    () => files.filter((file) => file.ai_status === "pending" && !file.ai_exempt).length,
    [files],
  );

  const classifyDisabled = notConfigured || pendingCount === 0 || classifyingAll || classifyingId !== null;

  async function classifyAllPending() {
    if (classifyDisabled) return;
    setClassifyingAll(true);
    setProgress({ done: 0, remaining: pendingCount });
    let totalDone = 0;
    try {
      // Client-driven batching (docs/12 §4.4): each call takes the next batch and
      // returns { done, remaining }; re-invoke while remaining > 0.
      for (let guard = 0; guard < 1000; guard += 1) {
        const outcome = await runClassify(d, {});
        if (outcome.status === "not_configured") {
          setNotConfigured(true);
          error(d.library.aiNotConfiguredTitle, d.library.aiNotConfiguredBody);
          break;
        }
        if (outcome.status === "error") {
          error(d.library.classifyErrorTitle, outcome.message);
          break;
        }
        totalDone += outcome.done;
        setProgress({ done: totalDone, remaining: outcome.remaining });
        if (outcome.remaining <= 0) {
          success(
            d.library.classifyDoneTitle,
            totalDone > 0
              ? d.library.classifyDoneBody(totalDone)
              : d.library.classifyNoneLeft,
          );
          break;
        }
        if (outcome.done <= 0) {
          // No forward progress — stop rather than spin forever.
          error(d.library.classifyStalledTitle, d.library.classifyStalledBody);
          break;
        }
      }
    } finally {
      setClassifyingAll(false);
      setProgress(null);
      router.refresh();
    }
  }

  async function classifyOne(fileId: string) {
    if (classifyingId || classifyingAll) return;
    setClassifyingId(fileId);
    try {
      const outcome = await runClassify(d, { file_id: fileId });
      if (outcome.status === "not_configured") {
        setNotConfigured(true);
        error(d.library.aiNotConfiguredTitle, d.library.aiNotConfiguredBody);
      } else if (outcome.status === "error") {
        error(d.library.classifyErrorTitle, outcome.message);
      } else {
        success(d.library.classifiedOneTitle, d.library.classifiedOneBody);
      }
    } finally {
      setClassifyingId(null);
      router.refresh();
    }
  }

  const classifyLabel = classifyingAll
    ? progress
      ? d.library.classifyingProgress(progress.done, progress.remaining)
      : d.library.classifying
    : d.library.classifyAll(pendingCount);

  return (
    <Tabs defaultValue="files">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="files">{d.library.tabFiles}</TabsTrigger>
          <TabsTrigger
            value="review"
            badge={
              suggestedFiles.length > 0 ? (
                <Badge variant="warning">{suggestedFiles.length}</Badge>
              ) : undefined
            }
          >
            {d.library.tabReview}
          </TabsTrigger>
        </TabsList>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            loading={classifyingAll}
            disabled={classifyDisabled}
            onClick={classifyAllPending}
          >
            {classifyLabel}
          </Button>
          <UploadDialog
            categories={categories}
            existingFolders={existingFolders}
            defaultFolder={selectedFolder}
            aiMaxFileMb={aiMaxFileMb}
          />
        </div>
      </div>

      {notConfigured ? (
        <p className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
          {d.library.aiNotConfiguredNotice}
        </p>
      ) : null}

      <TabsContent value="files" className="mt-4">
        {files.length === 0 ? (
          <EmptyState
            title={d.library.emptyTitle}
            description={d.library.emptyDescription}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[15rem_1fr]">
            <Card className="h-max">
              <CardHeader title={d.library.folders} />
              <CardBody className="p-2">
                <FolderTree
                  root={folderTree}
                  selected={selectedFolder}
                  onSelect={setSelectedFolder}
                />
              </CardBody>
            </Card>

            <div className="min-w-0">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs text-muted">
                  {selectedFolder === "/" ? d.library.allFiles : selectedFolder}
                </span>
                <span className="text-xs text-muted">
                  {d.library.shown(filteredFiles.length)}
                </span>
              </div>
              {filteredFiles.length === 0 ? (
                <EmptyState
                  bare
                  title={d.library.folderEmptyTitle}
                  description={d.library.folderEmptyDescription}
                />
              ) : (
                <FileGrid
                  files={filteredFiles}
                  categoryById={categoryById}
                  aiConfigured={!notConfigured}
                  classifyingId={classifyingId}
                  onClassifyFile={classifyOne}
                />
              )}
            </div>
          </div>
        )}
      </TabsContent>

      <TabsContent value="review" className="mt-4">
        <ReviewQueue
          files={suggestedFiles}
          categories={categories}
          categoryById={categoryById}
        />
      </TabsContent>
    </Tabs>
  );
}
