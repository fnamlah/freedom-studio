"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

import {
  createCategory,
  deleteCategory,
  setCategoryEnabled,
  updateCategory,
} from "@/app/(app)/admin/categories/actions";

import { CategoryBadge } from "./category-badge";
import type { CategoryLite } from "./library-meta";

type EditorState = {
  mode: "create" | "edit";
  id: string | null;
  slug: string;
  name: string;
  description: string;
  ai_enabled: boolean;
  sort: string;
};

const NEW_EDITOR: EditorState = {
  mode: "create",
  id: null,
  slug: "",
  name: "",
  description: "",
  ai_enabled: true,
  sort: "0",
};

/**
 * Super-Admin surface for the classification vocabulary (docs/12 §2.1, §5). The
 * `description` is the prompt text handed verbatim to the classifier, so editing
 * it changes model behaviour — it belongs in review, and here behind the SA-only
 * gate. `ai_enabled` is a control, not a default: `false` means the classifier is
 * never told the category exists (docs/12 §6), seeded `false` for `identity`.
 */
export function CategoryManager({ categories }: { categories: CategoryLite[] }) {
  const router = useRouter();
  const { success, error } = useToast();

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<CategoryLite | null>(null);
  const [saving, startSave] = useTransition();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [isDeleting, startDelete] = useTransition();

  function openCreate() {
    setEditor({ ...NEW_EDITOR });
  }

  function openEdit(category: CategoryLite) {
    setEditor({
      mode: "edit",
      id: category.id,
      slug: category.slug,
      name: category.name,
      description: category.description ?? "",
      ai_enabled: category.ai_enabled,
      sort: String(category.sort),
    });
  }

  function closeEditor() {
    if (saving) return;
    setEditor(null);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;

    startSave(async () => {
      const result =
        editor.mode === "create"
          ? await createCategory({
              slug: editor.slug,
              name: editor.name,
              description: editor.description,
              ai_enabled: editor.ai_enabled,
              sort: editor.sort,
            })
          : await updateCategory({
              id: editor.id!,
              name: editor.name,
              description: editor.description,
              ai_enabled: editor.ai_enabled,
              sort: editor.sort,
            });

      if (result.ok) {
        success(editor.mode === "create" ? "Category created" : "Category updated", result.message);
        setEditor(null);
        router.refresh();
      } else {
        error("Could not save category", result.error);
      }
    });
  }

  function toggle(category: CategoryLite) {
    setTogglingId(category.id);
    startSave(async () => {
      const result = await setCategoryEnabled({
        id: category.id,
        ai_enabled: !category.ai_enabled,
      });
      setTogglingId(null);
      if (result.ok) {
        success("Category updated", result.message);
        router.refresh();
      } else {
        error("Could not update category", result.error);
      }
    });
  }

  function confirmDelete() {
    if (!deleting) return;
    startDelete(async () => {
      const result = await deleteCategory({ id: deleting.id });
      if (result.ok) {
        success("Category deleted", result.message);
        setDeleting(null);
        router.refresh();
      } else {
        error("Could not delete category", result.error);
      }
    });
  }

  function set<K extends keyof EditorState>(key: K, value: EditorState[K]) {
    setEditor((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-end">
        <Button onClick={openCreate}>New category</Button>
      </div>

      <Card>
        <CardBody flush>
          <Table>
            <THead>
              <TR>
                <TH>Category</TH>
                <TH>Slug</TH>
                <TH>Description (prompt text)</TH>
                <TH align="center">AI</TH>
                <TH align="right">Sort</TH>
                <TH align="right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {categories.map((category) => (
                <TR key={category.id}>
                  <TD>
                    <CategoryBadge category={category} />
                  </TD>
                  <TD>
                    <code className="text-xs text-muted">{category.slug}</code>
                  </TD>
                  <TD className="max-w-md">
                    <span className="line-clamp-2 text-xs text-muted">
                      {category.description ?? "—"}
                    </span>
                  </TD>
                  <TD align="center">
                    <button
                      type="button"
                      onClick={() => toggle(category)}
                      disabled={saving && togglingId === category.id}
                      className="disabled:opacity-50"
                      title={
                        category.ai_enabled
                          ? "The classifier may suggest this category. Click to disable."
                          : "Human-only filing. Click to enable AI suggestions."
                      }
                    >
                      <Badge variant={category.ai_enabled ? "success" : "muted"} dot>
                        {category.ai_enabled ? "Enabled" : "Off"}
                      </Badge>
                    </button>
                  </TD>
                  <TD numeric>{category.sort}</TD>
                  <TD align="right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(category)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        onClick={() => setDeleting(category)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <Dialog
        open={editor !== null}
        onClose={closeEditor}
        dismissible={!saving}
        title={editor?.mode === "create" ? "New category" : "Edit category"}
        description="The description is handed verbatim to the classifier as the category's definition — editing it changes how files are suggested."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={closeEditor} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="category-form" loading={saving}>
              {editor?.mode === "create" ? "Create category" : "Save changes"}
            </Button>
          </>
        }
      >
        {editor ? (
          <form id="category-form" onSubmit={save} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                help={
                  editor.mode === "create"
                    ? "Stable machine key, e.g. incoming_money. Cannot be changed later."
                    : "The slug is a stable machine key and cannot be renamed."
                }
              >
                <Label htmlFor="cat-slug" required>
                  Slug
                </Label>
                <Input
                  id="cat-slug"
                  required={editor.mode === "create"}
                  disabled={editor.mode === "edit"}
                  value={editor.slug}
                  maxLength={60}
                  onChange={(e) => set("slug", e.target.value)}
                  placeholder="incoming_money"
                />
              </Field>

              <Field help="UI ordering. Lower sorts first.">
                <Label htmlFor="cat-sort">Sort</Label>
                <Input
                  id="cat-sort"
                  type="number"
                  min={0}
                  max={9999}
                  value={editor.sort}
                  onChange={(e) => set("sort", e.target.value)}
                />
              </Field>
            </div>

            <Field>
              <Label htmlFor="cat-name" required>
                Name
              </Label>
              <Input
                id="cat-name"
                required
                maxLength={80}
                value={editor.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Incoming money"
              />
            </Field>

            <Field help="Prompt text: the definition the classifier uses to decide whether a file belongs here.">
              <Label htmlFor="cat-description">Description</Label>
              <Textarea
                id="cat-description"
                rows={3}
                maxLength={1000}
                value={editor.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Platform payout statements, remittance advices, settlement reports — money received."
              />
            </Field>

            <div className="rounded-md border border-border bg-surface-2 px-3 py-3">
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={editor.ai_enabled}
                  onChange={(e) => set("ai_enabled", e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-surface text-primary accent-primary"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    Enabled for AI classification
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    When off, the classifier is never told this category exists — filing under
                    it is human-only (docs/12 §6). This is the control used for identity documents.
                  </span>
                </span>
              </label>
            </div>
          </form>
        ) : null}
      </Dialog>

      <Dialog
        open={deleting !== null}
        onClose={() => (isDeleting ? undefined : setDeleting(null))}
        dismissible={!isDeleting}
        title="Delete this category?"
        description="A category still referenced by a file cannot be deleted."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="danger" loading={isDeleting} onClick={confirmDelete}>
              Delete category
            </Button>
          </>
        }
      >
        {deleting ? (
          <p className="text-sm text-muted">
            <span className="font-medium text-foreground">{deleting.name}</span> (
            <code className="text-xs">{deleting.slug}</code>)
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
