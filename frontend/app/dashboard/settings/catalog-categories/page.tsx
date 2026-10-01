"use client";

import { useMemo, useState } from "react";
import { FolderTree, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ActionBar } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/button";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { RequiredMark } from "@/components/ui/RequiredMark";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCatalogCategories, useCatalogCategoryActions, type CatalogCategory } from "@/hooks/catalog/useCatalogCategories";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { isForbiddenError } from "@/lib/api";
import { SETTINGS_ROUTES } from "@/lib/routes";

const TOP_LEVEL = "none";

type Draft = { name: string; parent_id: string; description: string; sort_order: string };
const EMPTY_DRAFT: Draft = { name: "", parent_id: TOP_LEVEL, description: "", sort_order: "0" };

function draftFrom(category: CatalogCategory): Draft {
  return {
    name: category.name,
    parent_id: category.parent_id ? String(category.parent_id) : TOP_LEVEL,
    description: category.description ?? "",
    sort_order: String(category.sort_order),
  };
}

function usageLabel(category: CatalogCategory) {
  const parts = [
    category.product_count ? `${category.product_count} ${category.product_count === 1 ? "product" : "products"}` : null,
    category.service_count ? `${category.service_count} ${category.service_count === 1 ? "service" : "services"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Not used yet";
}

/**
 * Catalog categories (archetype 4, settings): one level of nesting, shared by products and
 * services. Benchmarked in docs/crm-evolution/12-erp-inventory.md §4.1; the page itself is the
 * customer-groups pattern, a `RecordTable` plus an `EditorPanel`.
 */
export default function CatalogCategoriesSettingsPage() {
  const { confirm } = useConfirm();
  const categories = useCatalogCategories();
  const { createCategory, updateCategory, deleteCategory, isSaving } = useCatalogCategoryActions();
  const [editing, setEditing] = useState<CatalogCategory | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT });
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const initial = editing ? draftFrom(editing) : EMPTY_DRAFT;
  const isDirty = (Object.keys(initial) as (keyof Draft)[]).some((key) => draft[key] !== initial[key]);
  useUnsavedChangesGuard(isDirty, isSaving);

  // A parent must be top level, and a category with subcategories cannot become one.
  const parentOptions = useMemo(() => {
    const all = categories.data ?? [];
    const editingHasChildren = Boolean(editing && all.some((category) => category.parent_id === editing.id));
    if (editingHasChildren) return [];
    return all.filter((category) => category.parent_id === null && category.id !== editing?.id);
  }, [categories.data, editing]);

  const visible = useMemo(() => {
    const text = search.trim().toLowerCase();
    const all = categories.data ?? [];
    if (!text) return all;
    return all.filter((category) => `${category.full_name} ${category.description ?? ""}`.toLowerCase().includes(text));
  }, [categories.data, search]);

  async function confirmDiscard() {
    if (!isDirty) return true;
    return confirm({
      title: "Discard category changes?",
      description: "The current draft will be lost.",
      confirmLabel: "Discard changes",
      variant: "destructive",
    });
  }

  async function openEditor(category: CatalogCategory | null) {
    if (!(await confirmDiscard())) return;
    setEditing(category);
    setDraft(category ? draftFrom(category) : { ...EMPTY_DRAFT });
    setNameError(null);
    setSaveError(null);
    setEditorOpen(true);
  }

  async function closeEditor() {
    if (!(await confirmDiscard())) return;
    setEditing(null);
    setDraft({ ...EMPTY_DRAFT });
    setEditorOpen(false);
  }

  async function save() {
    if (!draft.name.trim()) {
      setNameError("Enter a category name.");
      document.getElementById("catalog-category-name")?.focus();
      return;
    }
    const sortOrder = Number(draft.sort_order);
    const payload = {
      name: draft.name.trim(),
      parent_id: draft.parent_id === TOP_LEVEL ? null : Number(draft.parent_id),
      description: draft.description.trim() || null,
      sort_order: Number.isInteger(sortOrder) && sortOrder >= 0 ? sortOrder : 0,
    };
    try {
      setSaveError(null);
      if (editing) {
        await updateCategory({ id: editing.id, payload });
        toast.success("Category updated.");
      } else {
        await createCategory(payload);
        toast.success("Category created.");
      }
      setEditing(null);
      setDraft({ ...EMPTY_DRAFT });
      setEditorOpen(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The category could not be saved.");
    }
  }

  async function remove(category: CatalogCategory) {
    const confirmed = await confirm({
      title: `Delete ${category.full_name}?`,
      description: "Deleting a category is permanent. A category that products, services or subcategories still use cannot be deleted.",
      confirmLabel: "Delete category",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      await deleteCategory(category.id);
      toast.success("Category deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The category could not be deleted.");
    }
  }

  return (
    <PageShell
      variant="settings"
      title="Catalog categories"
      description="Group products and services the way your team browses them. Categories nest one level deep."
      actions={<Button type="button" onClick={() => void openEditor(null)}><Plus />Create category</Button>}
      isPermissionDenied={isForbiddenError(categories.error)}
      backHref={SETTINGS_ROUTES.root}
      backLabel="Back to settings"
    >
      <EditorPanel
        open={editorOpen}
        onOpenChange={(open) => (open ? setEditorOpen(true) : void closeEditor())}
        title={editing ? "Edit category" : "Create category"}
        description="Products and services pick a category on their own form."
        closeLabel="Close category editor"
        onSubmit={() => void save()}
        status={saveError
          ? <span role="alert" className="text-state-danger">{saveError}</span>
          : isDirty ? "Unsaved changes" : null}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => void closeEditor()} disabled={isSaving}>Cancel</Button>
            <Button type="submit" disabled={isSaving || !draft.name.trim() || (Boolean(editing) && !isDirty)}>
              {isSaving ? "Saving…" : editing ? "Save category" : "Create category"}
            </Button>
          </>
        )}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="catalog-category-name">Name <RequiredMark /></FieldLabel>
            <Input
              id="catalog-category-name"
              value={draft.name}
              maxLength={120}
              onChange={(event) => {
                setDraft((current) => ({ ...current, name: event.target.value }));
                setNameError(null);
              }}
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? "catalog-category-name-error" : undefined}
              required
            />
            {nameError ? <FieldError id="catalog-category-name-error">{nameError}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="catalog-category-parent">Parent</FieldLabel>
            <Select value={draft.parent_id} onValueChange={(parent_id) => setDraft((current) => ({ ...current, parent_id }))}>
              <SelectTrigger id="catalog-category-parent" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TOP_LEVEL}>None (top level)</SelectItem>
                {parentOptions.map((category) => (
                  <SelectItem key={category.id} value={String(category.id)}>{category.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              {editing && (categories.data ?? []).some((category) => category.parent_id === editing.id)
                ? "This category has subcategories, so it stays top level."
                : "Choose a parent to make this a subcategory."}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="catalog-category-order">Order</FieldLabel>
            <Input
              id="catalog-category-order"
              type="number"
              min="0"
              step="1"
              value={draft.sort_order}
              onChange={(event) => setDraft((current) => ({ ...current, sort_order: event.target.value }))}
              aria-describedby="catalog-category-order-description"
            />
            <FieldDescription id="catalog-category-order-description">Lower numbers list first; equal numbers sort by name.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="catalog-category-description">Description</FieldLabel>
            <Textarea
              id="catalog-category-description"
              value={draft.description}
              maxLength={2000}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            />
          </Field>
        </FieldGroup>
      </EditorPanel>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchBar value={search} onChange={setSearch} placeholder="Search categories" className="sm:max-w-sm" />
        <ActionBar size="sm">
          <span className="text-sm text-copy-muted">
            {categories.isLoading ? "Loading…" : `${visible.length} of ${categories.data?.length ?? 0} categories`}
          </span>
        </ActionBar>
      </div>
      <RecordTable
        label="Catalog categories"
        columns={[
          {
            key: "name",
            label: "Category",
            size: "lg",
            render: (category) => (
              <>
                <div className={category.parent_id ? "pl-4 text-copy-primary" : "font-medium text-copy-primary"}>
                  {category.parent_id ? category.full_name : category.name}
                </div>
                {category.description ? <div className="mt-1 text-xs text-copy-muted">{category.description}</div> : null}
              </>
            ),
          },
          { key: "usage", label: "Used by", render: (category) => <span className="text-sm text-copy-secondary">{usageLabel(category)}</span> },
          { key: "sort_order", label: "Order", size: "sm", align: "right", render: (category) => <span className="tabular-nums">{category.sort_order}</span> },
        ]}
        rows={visible}
        rowKey={(category) => category.id}
        onOpenRow={(category) => void openEditor(category)}
        rowLabel={(category) => `Edit ${category.full_name}`}
        isLoading={categories.isLoading}
        isRefreshing={categories.isFetching && !categories.isLoading}
        isPermissionDenied={isForbiddenError(categories.error)}
        hasError={Boolean(categories.error) && !isForbiddenError(categories.error)}
        onRetry={() => void categories.refetch()}
        errorState={{ title: "Categories could not be loaded" }}
        hasActiveFilters={Boolean(search.trim())}
        onClearFilters={() => setSearch("")}
        filteredEmptyState={{ icon: FolderTree, title: "No matching categories", description: "Adjust the search to find another category." }}
        emptyState={{
          icon: FolderTree,
          title: "No catalog categories yet",
          description: "Create a category, then pick it on a product or service.",
          action: <Button type="button" onClick={() => void openEditor(null)}><Plus />Create category</Button>,
        }}
        rowActions={(category) => (
          <Button type="button" size="icon" variant="ghost" aria-label={`Delete ${category.full_name}`} onClick={() => void remove(category)}>
            <Trash2 />
          </Button>
        )}
      />
    </PageShell>
  );
}
