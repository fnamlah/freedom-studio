"use client";

import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

import { analyseDraftDocument, uploadDocument } from "./actions";
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
  const [isReading, setIsReading] = useState(false);
  /** Which fields the AI filled, so the form can say so and the user can trust or override. */
  const [aiFilled, setAiFilled] = useState<Set<keyof FormState>>(new Set());
  const [aiNote, setAiNote] = useState<string | null>(null);

  const noModels = models.length === 0;

  /** Marks a label whose value came from the document rather than the keyboard. */
  const fromDoc = (key: keyof FormState) =>
    aiFilled.has(key) ? (
      <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
        {d.documents.aiFilledBadge}
      </span>
    ) : null;

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
    setAiFilled(new Set());
    setAiNote(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setOpen(true);
  }

  function close() {
    if (isRunning) return;
    setOpen(false);
  }

  /**
   * Read the chosen file and fill in what it says.
   *
   * Runs the moment a file is picked, before anything is stored. Only fields the
   * user has not already typed are touched — a human's own entry always wins —
   * and everything filled stays editable. If the AI cannot read the file, the
   * form simply stays manual.
   */
  async function readFile(chosen: File) {
    setIsReading(true);
    setAiNote(null);
    try {
      const fd = new FormData();
      fd.set("file", chosen);
      const result = await analyseDraftDocument(fd);
      if (!result.ok) {
        setAiNote(result.error);
        return;
      }
      const filled = new Set<keyof FormState>();
      setForm((prev) => {
        const next = { ...prev };
        const put = (key: keyof FormState, value: string | undefined) => {
          if (!value) return;
          if (next[key].trim() !== "") return; // never overwrite what a person typed
          next[key] = value;
          filled.add(key);
        };
        put("doc_type", result.meta.docType);
        put("title", result.meta.title);
        put("issued_date", result.meta.issuedDate);
        put("expires_at", result.meta.expiresAt);
        return next;
      });
      setAiFilled(filled);
      setAiNote(filled.size > 0 ? d.documents.aiFilledNote : d.documents.aiFilledNothing);
    } finally {
      setIsReading(false);
    }
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
                {fromDoc("doc_type")}
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
                {fromDoc("title")}
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
              <Label htmlFor="doc-issued">{d.documents.issuedLabel}
                {fromDoc("issued_date")}</Label>
              <Input
                id="doc-issued"
                type="date"
                value={form.issued_date}
                onChange={(e) => set("issued_date", e.target.value)}
              />
            </Field>

            <Field help={d.documents.expiresHelp}>
              <Label htmlFor="doc-expires">{d.documents.expiresLabel}
                {fromDoc("expires_at")}</Label>
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
              onChange={(e) => {
                const chosen = e.target.files?.[0] ?? null;
                setFile(chosen);
                setAiFilled(new Set());
                setAiNote(null);
                // Read it straight away: the point is that she does not type
                // what the document already says.
                if (chosen && isAllowedMime(chosen.type) && chosen.size <= MAX_FILE_BYTES) {
                  void readFile(chosen);
                }
              }}
            />
            {file ? (
              <p className="mt-1 text-xs text-muted">
                {d.documents.filePicked(file.name, fm.fileSize(file.size))}
              </p>
            ) : null}
            {isReading ? (
              <p className="mt-1 flex items-center gap-2 text-xs text-primary">
                <Spinner size="sm" />
                {d.documents.aiReading}
              </p>
            ) : aiNote ? (
              <p className="mt-1 text-xs text-muted">{aiNote}</p>
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
