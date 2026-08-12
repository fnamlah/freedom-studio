"use client";

import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

import { uploadDocument } from "./actions";
import {
  documentTypeOptions,
  FILE_ACCEPT_ATTR,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  isAllowedMime,
} from "./doc-meta";

export type ModelOption = { id: string; stage_name: string };

type FormState = {
  model_id: string;
  doc_type: string;
  title: string;
  issued_date: string;
  expires_at: string;
  notes: string;
};

const EMPTY: FormState = {
  model_id: "",
  doc_type: "",
  title: "",
  issued_date: "",
  expires_at: "",
  notes: "",
};

/**
 * Upload dialog for a compliance document (SA/MGR only). Submits the file plus
 * metadata as `FormData` to the `uploadDocument` server action, which validates
 * type/size/MIME, stores the object server-side in the private bucket, inserts the
 * metadata row, and audits `document.upload`. Client-side checks here are UX only.
 */
export function DocumentUpload({ models }: { models: ModelOption[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const d = useDict();
  const fm = fmt(useLocale());
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const noModels = models.length === 0;

  const modelOptions: SelectOption[] = useMemo(
    () => models.map((m) => ({ value: m.id, label: m.stage_name })),
    [models],
  );

  const typeOptions: SelectOption[] = useMemo(() => documentTypeOptions(d), [d]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openDialog() {
    setForm(EMPTY);
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
      error(d.documents.noFileTitle, d.documents.noFileBody);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      error(d.documents.tooLargeTitle, d.documents.tooLargeBody(MAX_FILE_MB));
      return;
    }
    if (!isAllowedMime(file.type)) {
      error(
        d.documents.badTypeTitle,
        d.documents.badTypeBody(d.documents.allowedMimeLabel),
      );
      return;
    }

    const fd = new FormData();
    fd.set("model_id", form.model_id);
    fd.set("doc_type", form.doc_type);
    fd.set("title", form.title);
    fd.set("issued_date", form.issued_date);
    fd.set("expires_at", form.expires_at);
    fd.set("notes", form.notes);
    fd.set("file", file);

    startTransition(async () => {
      const result = await uploadDocument(fd);
      if (result.ok) {
        success(d.documents.uploadedTitle, result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(d.documents.uploadFailedTitle, result.error);
      }
    });
  }

  return (
    <>
      <Button onClick={openDialog} disabled={noModels}>
        {d.documents.uploadCta}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={d.documents.uploadTitle}
        description={d.documents.uploadDescription}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button type="submit" form="document-upload-form" loading={isRunning}>
              {d.documents.uploadCta}
            </Button>
          </>
        }
      >
        <form id="document-upload-form" onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="doc-model" required>
                {d.documents.modelLabel}
              </Label>
              <Select
                id="doc-model"
                required
                placeholder={d.documents.modelPlaceholder}
                options={modelOptions}
                value={form.model_id}
                onChange={(e) => set("model_id", e.target.value)}
              />
            </Field>

            <Field>
              <Label htmlFor="doc-type" required>
                {d.documents.typeLabel}
              </Label>
              <Select
                id="doc-type"
                required
                placeholder={d.documents.typePlaceholder}
                options={typeOptions}
                value={form.doc_type}
                onChange={(e) => set("doc_type", e.target.value)}
              />
            </Field>
          </div>

          <Field help={d.documents.titleHelp}>
            <Label htmlFor="doc-title" required>
              {d.documents.titleLabel}
            </Label>
            <Input
              id="doc-title"
              required
              maxLength={200}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder={d.documents.titlePlaceholder}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field help={d.documents.issuedHelp}>
              <Label htmlFor="doc-issued">{d.documents.issuedLabel}</Label>
              <Input
                id="doc-issued"
                type="date"
                value={form.issued_date}
                onChange={(e) => set("issued_date", e.target.value)}
              />
            </Field>

            <Field help={d.documents.expiresHelp}>
              <Label htmlFor="doc-expires">{d.documents.expiresLabel}</Label>
              <Input
                id="doc-expires"
                type="date"
                value={form.expires_at}
                onChange={(e) => set("expires_at", e.target.value)}
              />
            </Field>
          </div>

          <Field help={d.documents.fileHelp(d.documents.allowedMimeLabel, MAX_FILE_MB)}>
            <Label htmlFor="doc-file" required>
              {d.documents.fileLabel}
            </Label>
            <Input
              id="doc-file"
              ref={fileInputRef}
              type="file"
              required
              accept={FILE_ACCEPT_ATTR}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <p className="mt-1 text-xs text-muted">
                {d.documents.filePicked(file.name, fm.fileSize(file.size))}
              </p>
            ) : null}
          </Field>

          <Field help={d.documents.notesHelp}>
            <Label htmlFor="doc-notes">{d.documents.notesLabel}</Label>
            <Textarea
              id="doc-notes"
              rows={2}
              maxLength={2000}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder={d.documents.notesPlaceholder}
            />
          </Field>
        </form>
      </Dialog>
    </>
  );
}
