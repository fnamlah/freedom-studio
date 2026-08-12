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
import { EM_DASH } from "@/lib/format";
import { useDict, useLocale } from "@/lib/i18n/client";

import {
  createCategory,
  deleteCategory,
  setCategoryEnabled,
  updateCategory,
} from "@/app/(app)/admin/categories/actions";

import { CategoryBadge } from "./category-badge";
import { categoryDescription, categoryName, type CategoryLite } from "./library-meta";

type EditorState = {
  mode: "create" | "edit";
  id: string | null;
  slug: string;
  name: string;
  name_ru: string;
  description: string;
  description_ru: string;
  ai_enabled: boolean;
  sort: string;
};

const NEW_EDITOR: EditorState = {
  mode: "create",
  id: null,
  slug: "",
  name: "",
  name_ru: "",
  description: "",
  description_ru: "",
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
  const d = useDict();
  const locale = useLocale();
  const c = d.library.categories;

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
      name_ru: category.name_ru ?? "",
      description: category.description ?? "",
      description_ru: category.description_ru ?? "",
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
              name_ru: editor.name_ru,
              description: editor.description,
              description_ru: editor.description_ru,
              ai_enabled: editor.ai_enabled,
              sort: editor.sort,
            })
          : await updateCategory({
              id: editor.id!,
              name: editor.name,
              name_ru: editor.name_ru,
              description: editor.description,
              description_ru: editor.description_ru,
              ai_enabled: editor.ai_enabled,
              sort: editor.sort,
            });

      if (result.ok) {
        success(editor.mode === "create" ? c.createdTitle : c.updatedTitle, result.message);
        setEditor(null);
        router.refresh();
      } else {
        error(c.saveFailedTitle, result.error);
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
        success(c.updatedTitle, result.message);
        router.refresh();
      } else {
        error(c.updateFailedTitle, result.error);
      }
    });
  }

  function confirmDelete() {
    if (!deleting) return;
    startDelete(async () => {
      const result = await deleteCategory({ id: deleting.id });
      if (result.ok) {
        success(c.deletedTitle, result.message);
        setDeleting(null);
        router.refresh();
      } else {
        error(c.deleteFailedTitle, result.error);
      }
    });
  }

  function set<K extends keyof EditorState>(key: K, value: EditorState[K]) {
    setEditor((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-end">
        <Button onClick={openCreate}>{c.newCategory}</Button>
      </div>

      <Card>
        <CardBody flush>
          <Table>
            <THead>
              <TR>
                <TH>{c.colCategory}</TH>
                <TH>{c.colSlug}</TH>
                <TH>{c.colDescription}</TH>
                <TH align="center">{c.colAi}</TH>
                <TH align="right">{c.colSort}</TH>
                <TH align="right">{d.common.actions}</TH>
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
                      {categoryDescription(category, locale) ?? EM_DASH}
                    </span>
                  </TD>
                  <TD align="center">
                    <button
                      type="button"
                      onClick={() => toggle(category)}
                      disabled={saving && togglingId === category.id}
                      className="disabled:opacity-50"
                      title={category.ai_enabled ? c.aiOnTitle : c.aiOffTitle}
                    >
                      <Badge variant={category.ai_enabled ? "success" : "muted"} dot>
                        {category.ai_enabled ? c.aiOn : c.aiOffShort}
                      </Badge>
                    </button>
                  </TD>
                  <TD numeric>{category.sort}</TD>
                  <TD align="right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(category)}>
                        {d.common.edit}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        onClick={() => setDeleting(category)}
                      >
                        {d.common.delete}
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
        title={editor?.mode === "create" ? c.newCategory : c.editTitle}
        description={c.editorDescription}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={closeEditor} disabled={saving}>
              {d.common.cancel}
            </Button>
            <Button type="submit" form="category-form" loading={saving}>
              {editor?.mode === "create" ? c.createCta : c.saveCta}
            </Button>
          </>
        }
      >
        {editor ? (
          <form id="category-form" onSubmit={save} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                help={editor.mode === "create" ? c.slugHelpCreate : c.slugHelpEdit}
              >
                <Label htmlFor="cat-slug" required>
                  {c.slugLabel}
                </Label>
                <Input
                  id="cat-slug"
                  required={editor.mode === "create"}
                  disabled={editor.mode === "edit"}
                  value={editor.slug}
                  maxLength={60}
                  onChange={(e) => set("slug", e.target.value)}
                  placeholder={c.slugPlaceholder}
                />
              </Field>

              <Field help={c.sortHelp}>
                <Label htmlFor="cat-sort">{c.sortLabel}</Label>
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
                {c.nameLabel}
              </Label>
              <Input
                id="cat-name"
                required
                maxLength={80}
                value={editor.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={c.namePlaceholder}
              />
            </Field>

            <Field help={c.nameRuHelp}>
              <Label htmlFor="cat-name-ru">{c.nameRuLabel}</Label>
              <Input
                id="cat-name-ru"
                maxLength={80}
                value={editor.name_ru}
                onChange={(e) => set("name_ru", e.target.value)}
              />
            </Field>

            <Field help={c.descriptionHelp}>
              <Label htmlFor="cat-description">{c.descriptionLabel}</Label>
              <Textarea
                id="cat-description"
                rows={3}
                maxLength={1000}
                value={editor.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder={c.descriptionPlaceholder}
              />
            </Field>

            <Field help={c.descriptionRuHelp}>
              <Label htmlFor="cat-description-ru">{c.descriptionRuLabel}</Label>
              <Textarea
                id="cat-description-ru"
                rows={3}
                maxLength={1000}
                value={editor.description_ru}
                onChange={(e) => set("description_ru", e.target.value)}
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
                    {c.aiEnabledToggle}
                  </span>
                  <span className="mt-1 block text-xs text-muted">{c.aiEnabledHelp}</span>
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
        title={c.deleteTitle}
        description={c.deleteDescription}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={isDeleting}>
              {d.common.cancel}
            </Button>
            <Button variant="danger" loading={isDeleting} onClick={confirmDelete}>
              {c.deleteCta}
            </Button>
          </>
        }
      >
        {deleting ? (
          <p className="text-sm text-muted">
            <span className="font-medium text-foreground">
              {categoryName(deleting, locale)}
            </span>{" "}
            (<code className="text-xs">{deleting.slug}</code>)
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
