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
import { fileSize } from "@/lib/format";

import { uploadDocument } from "./actions";
import {
  ALLOWED_MIME_LABEL,
  DOCUMENT_TYPE_OPTIONS,
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
      error("No file chosen", "Pick a document file to upload.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      error("File too large", `The limit is ${MAX_FILE_MB} MB.`);
      return;
    }
    if (!isAllowedMime(file.type)) {
      error("Unsupported file type", `Upload one of: ${ALLOWED_MIME_LABEL}.`);
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
        success("Document uploaded", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error("Could not upload document", result.error);
      }
    });
  }

  return (
    <>
      <Button onClick={openDialog} disabled={noModels}>
        Upload document
      </Button>

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title="Upload a compliance document"
        description="Stored in a private bucket. Retrieval is only ever a 60-second signed URL or a revocable share link — every access is audited (docs/06)."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              Cancel
            </Button>
            <Button type="submit" form="document-upload-form" loading={isRunning}>
              Upload document
            </Button>
          </>
        }
      >
        <form id="document-upload-form" onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="doc-model" required>
                Model
              </Label>
              <Select
                id="doc-model"
                required
                placeholder="Select a model…"
                options={modelOptions}
                value={form.model_id}
                onChange={(e) => set("model_id", e.target.value)}
              />
            </Field>

            <Field>
              <Label htmlFor="doc-type" required>
                Document type
              </Label>
              <Select
                id="doc-type"
                required
                placeholder="Select a type…"
                options={DOCUMENT_TYPE_OPTIONS}
                value={form.doc_type}
                onChange={(e) => set("doc_type", e.target.value)}
              />
            </Field>
          </div>

          <Field help="A human label, e.g. 'US Passport' or '2026 W-9'.">
            <Label htmlFor="doc-title" required>
              Title
            </Label>
            <Input
              id="doc-title"
              required
              maxLength={200}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Document title"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field help="When the document was issued (optional).">
              <Label htmlFor="doc-issued">Issued date</Label>
              <Input
                id="doc-issued"
                type="date"
                value={form.issued_date}
                onChange={(e) => set("issued_date", e.target.value)}
              />
            </Field>

            <Field help="Drives the compliance status. Leave blank for non-expiring documents.">
              <Label htmlFor="doc-expires">Expires</Label>
              <Input
                id="doc-expires"
                type="date"
                value={form.expires_at}
                onChange={(e) => set("expires_at", e.target.value)}
              />
            </Field>
          </div>

          <Field help={`${ALLOWED_MIME_LABEL}. Max ${MAX_FILE_MB} MB.`}>
            <Label htmlFor="doc-file" required>
              File
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
                {file.name} · {fileSize(file.size)}
              </p>
            ) : null}
          </Field>

          <Field help="Optional context stored with the record.">
            <Label htmlFor="doc-notes">Notes</Label>
            <Textarea
              id="doc-notes"
              rows={2}
              maxLength={2000}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Optional notes"
            />
          </Field>
        </form>
      </Dialog>
    </>
  );
}
