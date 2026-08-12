"use client";

import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";

import { uploadLibraryFile } from "@/app/(app)/library/actions";

import {
  categoryName,
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
  const d = useDict();
  const locale = useLocale();
  const fm = fmt(locale);
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
      categories.map((c) => {
        const name = categoryName(c, locale);
        return { value: c.id, label: c.ai_enabled ? name : d.library.aiOff(name) };
      }),
    [categories, locale, d],
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
      error(d.library.noFileTitle, d.library.noFileBody);
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      error(d.library.tooLargeTitle, d.library.tooLargeBody(MAX_UPLOAD_MB));
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
        success(d.library.uploadedTitle, result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(d.library.uploadFailedTitle, result.error);
      }
    });
  }

  return (
    <>
      <Button onClick={openDialog}>{d.library.uploadCta}</Button>

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={d.library.uploadTitle}
        description={d.library.uploadDescription}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button type="submit" form="library-upload-form" loading={isRunning}>
              {d.library.uploadCta}
            </Button>
          </>
        }
      >
        <form id="library-upload-form" onSubmit={submit} className="flex flex-col gap-4">
          <Field help={d.library.folderHelp}>
            <Label htmlFor="lib-folder" required>
              {d.library.folderLabel}
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

          <Field help={d.library.displayNameHelp}>
            <Label htmlFor="lib-name">{d.library.displayNameLabel}</Label>
            <Input
              id="lib-name"
              maxLength={200}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={d.library.displayNamePlaceholder}
            />
          </Field>

          <Field help={d.library.categoryHelp}>
            <Label htmlFor="lib-category">{d.library.categoryLabel}</Label>
            <Select
              id="lib-category"
              placeholder={d.library.categoryPlaceholder}
              options={categoryOptions}
              value={form.category_id}
              onChange={(e) => set("category_id", e.target.value)}
            />
          </Field>

          <Field help={d.library.fileHelp(MAX_UPLOAD_MB, aiMaxFileMb)}>
            <Label htmlFor="lib-file" required>
              {d.library.fileLabel}
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
                {d.library.filePicked(file.name, fm.fileSize(file.size))}
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
                  {d.library.exemptToggle}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {d.library.exemptNotice}
                </span>
                {form.ai_exempt ? (
                  <span className="mt-1 block text-xs text-foreground">
                    {d.library.exemptConfirmed}
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
