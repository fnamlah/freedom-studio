"use client";

import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { fileSize } from "@/lib/format";
import { cn } from "@/lib/utils";

import { uploadLibraryFile } from "@/app/(app)/library/actions";

import {
  EXEMPT_NOTICE,
  MAX_UPLOAD_MB,
  normalizeFolderPath,
  type CategoryLite,
} from "./library-meta";

type FormState = {
  folder_path: string;
  name: string;
  category_id: string;
  ai_exempt: boolean;
};

/**
 * Upload dialog for a Library file (SA/MGR only, docs/12 §4.1). Submits the file
 * plus metadata as `FormData` to the `uploadLibraryFile` server action, which
 * stores the object in the private `library` bucket, inserts the metadata row
 * with the right initial `ai_status`, and audits `library.upload`.
 *
 * The exemption notice from docs/12 §6 is shown UNCONDITIONALLY next to the
 * toggle: it is the studio's procedural protection against a mis-upload, and it
 * must be stated plainly at the moment of upload.
 */
export function UploadDialog({
  categories,
  existingFolders,
  defaultFolder,
  aiMaxFileMb,
}: {
  categories: CategoryLite[];
  existingFolders: string[];
  defaultFolder: string;
  aiMaxFileMb: number;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initial = useMemo<FormState>(
    () => ({ folder_path: defaultFolder || "/", name: "", category_id: "", ai_exempt: false }),
    [defaultFolder],
  );
  const [form, setForm] = useState<FormState>(initial);

  const categoryOptions: SelectOption[] = useMemo(
    () =>
      categories.map((c) => ({
        value: c.id,
        label: c.ai_enabled ? c.name : `${c.name} (AI off)`,
      })),
    [categories],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openDialog() {
    setForm(initial);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setOpen(true);
  }

  function close() {
    if (isRunning) return;
    setOpen(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      error("No file chosen", "Pick a file to upload.");
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      error("File too large", `The limit is ${MAX_UPLOAD_MB} MB.`);
      return;
    }

    const fd = new FormData();
    fd.set("folder_path", normalizeFolderPath(form.folder_path));
    fd.set("name", form.name);
    fd.set("category_id", form.category_id);
    fd.set("ai_exempt", form.ai_exempt ? "true" : "false");
    fd.set("file", file);

    startTransition(async () => {
      const result = await uploadLibraryFile(fd);
      if (result.ok) {
        success("File uploaded", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error("Could not upload file", result.error);
      }
    });
  }

  return (
    <>
      <Button onClick={openDialog}>Upload file</Button>

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title="Upload a file to the Library"
        description="Stored in a private bucket. There is no share-link path into the Library; retrieval is only ever a 60-second signed URL (docs/12)."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              Cancel
            </Button>
            <Button type="submit" form="library-upload-form" loading={isRunning}>
              Upload file
            </Button>
          </>
        }
      >
        <form id="library-upload-form" onSubmit={submit} className="flex flex-col gap-4">
          <Field help="A virtual folder such as /tax or /contracts/2026. It organizes filing only; the file's bytes are stored flat.">
            <Label htmlFor="lib-folder" required>
              Folder
            </Label>
            <Input
              id="lib-folder"
              list="lib-folder-options"
              required
              value={form.folder_path}
              onChange={(e) => set("folder_path", e.target.value)}
              placeholder="/"
            />
            <datalist id="lib-folder-options">
              {existingFolders.map((folder) => (
                <option key={folder} value={folder} />
              ))}
            </datalist>
          </Field>

          <Field help="Optional. Defaults to the uploaded file's name.">
            <Label htmlFor="lib-name">Display name</Label>
            <Input
              id="lib-name"
              maxLength={200}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Q1 platform payout statement"
            />
          </Field>

          <Field help="Optional. File it by hand now, or leave blank and let the AI suggest one for review.">
            <Label htmlFor="lib-category">Category</Label>
            <Select
              id="lib-category"
              placeholder="Let the AI suggest…"
              options={categoryOptions}
              value={form.category_id}
              onChange={(e) => set("category_id", e.target.value)}
            />
          </Field>

          <Field help={`Max ${MAX_UPLOAD_MB} MB. Files over ${aiMaxFileMb} MB are stored but skipped by the classifier.`}>
            <Label htmlFor="lib-file" required>
              File
            </Label>
            <Input
              id="lib-file"
              ref={fileInputRef}
              type="file"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <p className="mt-1 text-xs text-muted">
                {file.name} · {fileSize(file.size)}
              </p>
            ) : null}
          </Field>

          <div
            className={cn(
              "rounded-md border px-3 py-3",
              form.ai_exempt
                ? "border-border bg-surface-2"
                : "border-warning/30 bg-warning/10",
            )}
          >
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={form.ai_exempt}
                onChange={(e) => set("ai_exempt", e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-surface text-primary accent-primary"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  Exempt this file from AI classification
                </span>
                <span className="mt-1 block text-xs text-muted">{EXEMPT_NOTICE}</span>
                {form.ai_exempt ? (
                  <span className="mt-1 block text-xs text-foreground">
                    Marked exempt — this file will never leave the system for classification.
                  </span>
                ) : null}
              </span>
            </label>
          </div>
        </form>
      </Dialog>
    </>
  );
}
