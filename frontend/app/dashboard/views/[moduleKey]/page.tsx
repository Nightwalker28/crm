"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Eye, EyeOff, GripVertical, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { SavedViewConditionEditor, getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { RouteLoadingState } from "@/components/ui/RouteStates";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/hooks/useConfirm";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useCustomModuleSchema } from "@/hooks/useModuleBuilder";
import { useSavedViews, type SavedViewConfig } from "@/hooks/useSavedViews";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import {
  buildCustomModuleViewDefinition,
  buildModuleViewDefinition,
  CUSTOM_FIELD_SUPPORTED_MODULES,
  getModuleViewDefinition,
  resolveSavedViewFilters,
  resolveVisibleColumns,
} from "@/lib/moduleViewConfigs";
import { canonicalSavedViewFiltersKey } from "@/lib/savedViewQuery";

const EMPTY_CONFIG: SavedViewConfig = {
  visible_columns: [],
  filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
  sort: null,
};

function sameColumns(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameSort(left: SavedViewConfig["sort"], right: SavedViewConfig["sort"]) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export default function ManageModuleViewPage() {
  const params = useParams<{ moduleKey: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { confirm } = useConfirm();
  const moduleKey = params.moduleKey;
  const builtInDefinition = getModuleViewDefinition(moduleKey);
  const shouldLoadCustomModule = !builtInDefinition;
  const customFieldsQuery = useModuleCustomFields(moduleKey, CUSTOM_FIELD_SUPPORTED_MODULES.has(moduleKey));
  const customModuleSchema = useCustomModuleSchema(moduleKey, shouldLoadCustomModule);
  const moduleFieldsQuery = useModuleFieldConfigs(moduleKey);
  const definition = useMemo(() => {
    const moduleDefinition = buildModuleViewDefinition(moduleKey, customFieldsQuery.data ?? [], moduleFieldsQuery.fields);
    if (moduleDefinition) return moduleDefinition;
    return customModuleSchema.data ? buildCustomModuleViewDefinition(customModuleSchema.data, moduleFieldsQuery.fields) : null;
  }, [customFieldsQuery.data, customModuleSchema.data, moduleFieldsQuery.fields, moduleKey]);
  const safeDefinition = definition ?? {
    key: moduleKey,
    label: "Module",
    route: "/dashboard",
    columns: [],
    filterFields: [],
    defaultConfig: EMPTY_CONFIG,
  };
  const definitionLoading = moduleFieldsQuery.isLoading
    || (CUSTOM_FIELD_SUPPORTED_MODULES.has(moduleKey) && customFieldsQuery.isLoading)
    || (shouldLoadCustomModule && customModuleSchema.isLoading);
  const requestedViewId = searchParams.get("viewId") ?? "system-default";

  const {
    views,
    selectedView,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
    createViewWithConfig,
    updateView,
    setCurrentAsDefault,
    deleteCurrentView,
    isLoading: viewsLoading,
    isSaving,
    error: viewsError,
    refresh: refreshViews,
  } = useSavedViews(moduleKey, safeDefinition.defaultConfig, Boolean(definition) && !definitionLoading);

  const [nameEdit, setNameEdit] = useState<{ viewKey: string; value: string } | null>(null);
  const [availableSearch, setAvailableSearch] = useState("");
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedViewKey = String(selectedView?.id ?? "system-default");
  const baseViewName = selectedView && !selectedView.is_system ? selectedView.name : "";
  const viewName = nameEdit?.viewKey === selectedViewKey ? nameEdit.value : baseViewName;
  const visibleColumns = resolveVisibleColumns(safeDefinition, draftConfig, safeDefinition.defaultConfig);
  const safeFilters = resolveSavedViewFilters(safeDefinition, draftConfig.filters);
  const baseColumns = selectedView
    ? resolveVisibleColumns(safeDefinition, selectedView.config, safeDefinition.defaultConfig)
    : safeDefinition.defaultConfig.visible_columns;
  const baseFilters = selectedView
    ? resolveSavedViewFilters(safeDefinition, selectedView.config.filters)
    : safeDefinition.defaultConfig.filters;
  const isDirty = Boolean(selectedView) && (
    viewName !== baseViewName
    || !sameColumns(visibleColumns, baseColumns)
    || canonicalSavedViewFiltersKey(safeFilters) !== canonicalSavedViewFiltersKey(baseFilters)
    || !sameSort(draftConfig.sort, selectedView?.config.sort)
  );
  useUnsavedChangesGuard(isDirty, isSaving);

  const selectedOptions = visibleColumns
    .map((key) => safeDefinition.columns.find((column) => column.key === key))
    .filter((column): column is TableColumnOption => Boolean(column));
  const availableOptions = safeDefinition.columns.filter((column) => !visibleColumns.includes(column.key));
  const filteredAvailableOptions = availableOptions.filter((column) =>
    column.label.toLocaleLowerCase().includes(availableSearch.trim().toLocaleLowerCase()),
  );
  const { allConditions, anyConditions } = getConditionGroups(safeFilters);
  const conditionCount = allConditions.length + anyConditions.length;
  const hasLoadError = Boolean(
    viewsError
    || moduleFieldsQuery.error
    || customFieldsQuery.error
    || customModuleSchema.error,
  );
  const pageLoading = definitionLoading || (Boolean(definition) && viewsLoading);

  useEffect(() => {
    if (requestedViewId === "system-default" && selectedView?.is_system) return;
    if (selectedViewId !== requestedViewId) {
      setSelectedViewId(requestedViewId);
    }
  }, [requestedViewId, selectedView, selectedViewId, setSelectedViewId]);

  function updateVisibleColumns(next: string[]) {
    if (!next.length) return;
    setDraftConfig((current) => ({ ...current, visible_columns: next }));
    setActionError(null);
  }

  function addColumn(columnKey: string) {
    if (visibleColumns.includes(columnKey)) return;
    updateVisibleColumns([...visibleColumns, columnKey]);
  }

  function removeColumn(columnKey: string) {
    const option = safeDefinition.columns.find((column) => column.key === columnKey);
    if (option?.is_protected || visibleColumns.length <= 1) return;
    updateVisibleColumns(visibleColumns.filter((key) => key !== columnKey));
  }

  function moveColumn(columnKey: string, direction: "up" | "down") {
    const currentIndex = visibleColumns.indexOf(columnKey);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= visibleColumns.length) return;
    const next = [...visibleColumns];
    const [column] = next.splice(currentIndex, 1);
    next.splice(targetIndex, 0, column);
    updateVisibleColumns(next);
  }

  function dropColumn(targetKey: string) {
    if (!draggedColumn || draggedColumn === targetKey) return;
    const next = [...visibleColumns];
    const fromIndex = next.indexOf(draggedColumn);
    const targetIndex = next.indexOf(targetKey);
    if (fromIndex < 0 || targetIndex < 0) return;
    const [column] = next.splice(fromIndex, 1);
    next.splice(targetIndex, 0, column);
    updateVisibleColumns(next);
    setDraggedColumn(null);
  }

  function discardChanges() {
    if (!selectedView) return;
    setNameEdit(null);
    setDraftConfig({
      visible_columns: baseColumns,
      filters: baseFilters,
      sort: selectedView.config.sort ?? null,
    });
    setActionError(null);
  }

  function navigateToView(viewId: string) {
    if (viewId === selectedViewId) return;
    if (isDirty && !window.confirm("Switch views and discard unsaved changes?")) return;
    setNameEdit(null);
    setActionError(null);
    router.replace(`/dashboard/views/${moduleKey}?viewId=${viewId}`);
  }

  async function handleSave() {
    if (!selectedView || selectedView.id == null || selectedView.is_system) return;
    setActionError(null);
    try {
      await updateView(selectedView.id, {
        name: viewName.trim() || selectedView.name,
        config: { ...draftConfig, visible_columns: visibleColumns, filters: safeFilters },
      });
      setNameEdit(null);
      toast.success("Saved view updated.");
    } catch {
      setActionError("The saved view could not be updated. Please try again.");
    }
  }

  async function handleSaveAsNew() {
    if (!viewName.trim()) {
      setActionError("Enter a view name before saving a new view.");
      return;
    }
    setActionError(null);
    try {
      const created = await createViewWithConfig({
        name: viewName.trim(),
        config: { ...draftConfig, visible_columns: visibleColumns, filters: safeFilters },
      });
      setNameEdit(null);
      toast.success("Saved view created.");
      router.replace(`/dashboard/views/${moduleKey}?viewId=${created.id}`);
    } catch {
      setActionError("The saved view could not be created. Please try again.");
    }
  }

  async function handleSetDefault() {
    if (!selectedView || selectedView.id == null || selectedView.is_system) return;
    setActionError(null);
    try {
      await setCurrentAsDefault();
      toast.success("Default view updated.");
    } catch {
      setActionError("The default view could not be updated. Please try again.");
    }
  }

  async function handleDelete() {
    if (!selectedView || selectedView.id == null || selectedView.is_system) return;
    const confirmed = await confirm({
      title: "Delete saved view?",
      description: `Delete the view "${selectedView.name}"?`,
      confirmLabel: "Delete View",
      variant: "destructive",
    });
    if (!confirmed) return;
    setActionError(null);
    try {
      await deleteCurrentView();
      toast.success("Saved view deleted.");
      router.replace(`/dashboard/views/${moduleKey}?viewId=system-default`);
    } catch {
      setActionError("The saved view could not be deleted. Please try again.");
    }
  }

  async function retryAll() {
    await Promise.all([
      refreshViews(),
      moduleFieldsQuery.refresh(),
      CUSTOM_FIELD_SUPPORTED_MODULES.has(moduleKey) ? customFieldsQuery.refetch() : Promise.resolve(),
      shouldLoadCustomModule ? customModuleSchema.refetch() : Promise.resolve(),
    ]);
  }

  if (pageLoading) return <RouteLoadingState label="view manager" />;

  if (hasLoadError) {
    return (
      <Card className="p-6" role="alert">
        <h1 className="text-lg font-semibold text-copy-primary">View manager could not be loaded</h1>
        <p className="mt-1 text-sm text-copy-secondary">Try again. Your existing saved views have not been changed.</p>
        <Button className="mt-4" variant="outline" onClick={() => void retryAll()}>Try again</Button>
      </Card>
    );
  }

  if (!definition) {
    return (
      <Card className="p-6" role="alert">
        <h1 className="text-lg font-semibold text-copy-primary">Unsupported module view</h1>
        <p className="mt-1 text-sm text-copy-secondary">This module does not provide configurable list columns and filters.</p>
        <Button asChild className="mt-4" variant="outline"><Link href="/dashboard">Return to dashboard</Link></Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Manage ${definition.label} View`}
        description="Choose fields, drag them into order, preview the result, and define the filters this view applies."
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button asChild type="button" variant="ghost" size="sm">
              <Link href={definition.route}><ArrowLeft />Back to {definition.label}</Link>
            </Button>
            <Select value={selectedViewId || selectedViewKey} onValueChange={navigateToView}>
              <SelectTrigger className="w-full sm:w-64" aria-label="Select saved view"><SelectValue placeholder="Select view" /></SelectTrigger>
              <SelectContent>
                {views.map((view) => (
                  <SelectItem key={String(view.id ?? "system-default")} value={String(view.id ?? "system-default")}>
                    {view.name}{view.is_default ? " (Default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={() => navigateToView("system-default")}>New From Default</Button>
          </div>
        }
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(220px,0.8fr)_minmax(280px,1fr)_minmax(360px,1.3fr)]">
        <Card className="overflow-visible">
          <div className="border-b border-line-subtle p-4">
            <h2 className="font-semibold text-copy-primary">Available fields</h2>
            <p className="mt-1 text-xs text-copy-muted">Add hidden fields to this view.</p>
            <SearchBar value={availableSearch} onChange={setAvailableSearch} placeholder="Search available fields" className="mt-3 md:w-full" />
          </div>
          <div className="max-h-[32rem] overflow-y-auto p-3">
            {filteredAvailableOptions.length ? (
              <div className="space-y-2">
                {filteredAvailableOptions.map((column) => (
                  <button
                    key={column.key}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line-subtle bg-surface px-3 py-2.5 text-left text-sm text-copy-secondary transition-colors hover:border-line-strong hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={() => addColumn(column.key)}
                    aria-label={`Add ${column.label}`}
                  >
                    <span>{column.label}</span><Plus className="h-4 w-4 text-copy-muted" />
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={availableOptions.length ? Search : Eye}
                title={availableOptions.length ? "No fields match" : "All fields selected"}
                description={availableOptions.length ? "Clear the search to see available fields." : "Hide a selected field to move it back here."}
                action={availableOptions.length ? <Button variant="outline" onClick={() => setAvailableSearch("")}>Clear search</Button> : undefined}
              />
            )}
          </div>
        </Card>

        <Card className="overflow-visible">
          <div className="border-b border-line-subtle p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-copy-primary">Selected fields</h2>
                <p className="mt-1 text-xs text-copy-muted">Drag to reorder, or use the arrow controls.</p>
              </div>
              <Pill>{selectedOptions.length}</Pill>
            </div>
          </div>
          <div className="max-h-[32rem] space-y-2 overflow-y-auto p-3">
            {selectedOptions.map((column, index) => (
              <div
                key={column.key}
                data-testid={`selected-column-${column.key}`}
                draggable
                onDragStart={() => setDraggedColumn(column.key)}
                onDragEnd={() => setDraggedColumn(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropColumn(column.key)}
                className={`flex items-center gap-2 rounded-[var(--radius-control)] border bg-surface px-2 py-2 transition-colors ${draggedColumn === column.key ? "border-primary opacity-60" : "border-line-subtle"}`}
              >
                <GripVertical className="h-4 w-4 cursor-grab text-copy-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm text-copy-primary">{column.label}</span>
                <Button type="button" size="icon-sm" variant="ghost" disabled={index === 0} onClick={() => moveColumn(column.key, "up")} aria-label={`Move ${column.label} up`}><ArrowUp /></Button>
                <Button type="button" size="icon-sm" variant="ghost" disabled={index === selectedOptions.length - 1} onClick={() => moveColumn(column.key, "down")} aria-label={`Move ${column.label} down`}><ArrowDown /></Button>
                <Button type="button" size="icon-sm" variant="ghost" disabled={column.is_protected || selectedOptions.length <= 1} onClick={() => removeColumn(column.key)} aria-label={`Hide ${column.label}`} title={column.is_protected ? "This field is required by the view." : undefined}><EyeOff /></Button>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-visible p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-copy-primary">View preview & filters</h2>
              <p className="mt-1 text-xs text-copy-muted">{conditionCount} saved {conditionCount === 1 ? "condition" : "conditions"}</p>
            </div>
            <div className="flex gap-2">
              {selectedView?.is_system ? <Pill>System</Pill> : null}
              {selectedView?.is_default ? <Pill bg="bg-state-success-muted" text="text-state-success" border="border-state-success/40">Default</Pill> : null}
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="view-name">View name</Label>
              <Input
                id="view-name"
                value={viewName}
                onChange={(event) => setNameEdit({ viewKey: selectedViewKey, value: event.target.value })}
                placeholder={selectedView?.is_system ? `New ${definition.label} view` : "View name"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="default-search">Default search</Label>
              <Input
                id="default-search"
                value={typeof safeFilters.search === "string" ? safeFilters.search : ""}
                onChange={(event) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: event.target.value } }))}
                placeholder={`Search ${definition.label.toLowerCase()}`}
              />
            </div>
          </div>

          <div className="mt-5 overflow-x-auto rounded-[var(--radius-control)] border border-line-default bg-surface">
            <div className="min-w-max">
              <div className="flex border-b border-line-default bg-surface-raised">
                {selectedOptions.map((column) => <div key={column.key} data-testid={`preview-column-${column.key}`} className="w-36 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-copy-muted">{column.label}</div>)}
              </div>
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex border-b border-line-subtle last:border-b-0">
                  {selectedOptions.map((column) => <div key={column.key} className="w-36 px-3 py-3"><div className="h-2 w-20 rounded-full bg-surface-muted" /></div>)}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3 text-xs text-copy-muted">Preview shows column order only. Record data is not loaded in the manager.</p>
        </Card>
      </div>

      <SavedViewConditionEditor
        filterFields={safeDefinition.filterFields}
        filters={safeFilters}
        onChange={(nextFilters) => setDraftConfig((current) => ({ ...current, filters: nextFilters }))}
        title="View filters"
        description="Add required conditions in the AND group, optional-match conditions in the OR group, or use both together."
      />

      <div className="sticky bottom-0 z-30 flex flex-col gap-3 rounded-[var(--radius-card)] border border-line-default bg-surface-raised/95 px-4 py-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className={`text-sm font-medium ${isDirty ? "text-state-warning" : "text-state-success"}`}>{isDirty ? "Unsaved changes" : "All changes saved"}</div>
          {actionError ? <p className="mt-1 text-sm text-state-danger" role="alert">{actionError}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={discardChanges} disabled={!isDirty || isSaving}>Discard</Button>
          <Button type="button" variant="outline" onClick={() => void handleSetDefault()} disabled={!selectedView || selectedView.id == null || selectedView.is_system || selectedView.is_default || isSaving}>Set Default</Button>
          <Button type="button" variant="dangerGhost" onClick={() => void handleDelete()} disabled={!selectedView || selectedView.id == null || selectedView.is_system || isSaving}>Delete</Button>
          <Button type="button" variant="outline" onClick={() => void handleSaveAsNew()} disabled={isSaving || !viewName.trim()}>Save As New</Button>
          <Button type="button" onClick={() => void handleSave()} disabled={!isDirty || !selectedView || selectedView.id == null || selectedView.is_system || isSaving}>Save Changes</Button>
        </div>
      </div>
    </div>
  );
}
