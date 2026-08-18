"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Copy, EyeOff, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Chip } from "@/components/ui/Chip";
import { SavedViewConditionEditor, getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageShell } from "@/components/ui/PageShell";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/hooks/useConfirm";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useCustomModuleSchema } from "@/hooks/useModuleBuilder";
import { SavedViewApiError, useSavedViews, type SavedViewConfig } from "@/hooks/useSavedViews";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { buildCustomModuleViewDefinition, buildModuleViewDefinition, CUSTOM_FIELD_SUPPORTED_MODULES, getModuleViewDefinition, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";
import { canonicalSavedViewFiltersKey } from "@/lib/savedViewQuery";
import type { TableColumnOption } from "@/types/table";

const EMPTY_CONFIG: SavedViewConfig = { visible_columns: [], filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] }, sort: null };
type EditorMode = "view" | "edit" | "duplicate" | "create";
type EditorSection = "columns" | "filters" | "sort";

function sameColumns(left: string[], right: string[]) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function sameSort(left: SavedViewConfig["sort"], right: SavedViewConfig["sort"]) { return JSON.stringify(left ?? null) === JSON.stringify(right ?? null); }

export default function ManageModuleViewPage() {
  const { moduleKey } = useParams<{ moduleKey: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { confirm } = useConfirm();
  const builtInDefinition = getModuleViewDefinition(moduleKey);
  const shouldLoadCustomModule = !builtInDefinition;
  const fieldConfigModuleKey = moduleKey === "finance_payments" ? "finance_pos" : moduleKey;
  const customFieldsQuery = useModuleCustomFields(moduleKey, CUSTOM_FIELD_SUPPORTED_MODULES.has(moduleKey));
  const customModuleSchema = useCustomModuleSchema(moduleKey, shouldLoadCustomModule);
  const moduleFieldsQuery = useModuleFieldConfigs(fieldConfigModuleKey);
  const definition = useMemo(() => {
    const built = buildModuleViewDefinition(moduleKey, customFieldsQuery.data ?? [], moduleFieldsQuery.fields);
    if (built) return built;
    return customModuleSchema.data ? buildCustomModuleViewDefinition(customModuleSchema.data, moduleFieldsQuery.fields) : null;
  }, [customFieldsQuery.data, customModuleSchema.data, moduleFieldsQuery.fields, moduleKey]);
  const safeDefinition = definition ?? { key: moduleKey, label: "Module", route: "/dashboard", columns: [], filterFields: [], defaultConfig: EMPTY_CONFIG };
  const definitionLoading = moduleFieldsQuery.isLoading || (CUSTOM_FIELD_SUPPORTED_MODULES.has(moduleKey) && customFieldsQuery.isLoading) || (shouldLoadCustomModule && customModuleSchema.isLoading);
  const requestedViewId = searchParams.get("viewId") ?? "system-default";
  const saved = useSavedViews(moduleKey, safeDefinition.defaultConfig, Boolean(definition) && !definitionLoading);
  const [mode, setMode] = useState<EditorMode>("view");
  const [section, setSection] = useState<EditorSection>("columns");
  const [name, setName] = useState("");
  const [availableSearch, setAvailableSearch] = useState("");
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedViewKey = String(saved.selectedView?.id ?? "system-default");
  const visibleColumns = resolveVisibleColumns(safeDefinition, saved.draftConfig, safeDefinition.defaultConfig);
  const safeFilters = resolveSavedViewFilters(safeDefinition, saved.draftConfig.filters);
  const baseColumns = saved.selectedView ? resolveVisibleColumns(safeDefinition, saved.selectedView.config, safeDefinition.defaultConfig) : safeDefinition.defaultConfig.visible_columns;
  const baseFilters = saved.selectedView ? resolveSavedViewFilters(safeDefinition, saved.selectedView.config.filters) : safeDefinition.defaultConfig.filters;
  const baseName = saved.selectedView?.name ?? "";
  const editDirty = mode === "edit" && Boolean(saved.selectedView) && (name !== baseName || !sameColumns(visibleColumns, baseColumns) || canonicalSavedViewFiltersKey(safeFilters) !== canonicalSavedViewFiltersKey(baseFilters) || !sameSort(saved.draftConfig.sort, saved.selectedView?.config.sort));
  const isDirty = editDirty || mode === "duplicate" || mode === "create";
  const editable = mode !== "view";
  useUnsavedChangesGuard(isDirty, saved.isSaving);

  const selectedOptions = visibleColumns.map((key) => safeDefinition.columns.find((column) => column.key === key)).filter((column): column is TableColumnOption => Boolean(column));
  const protectedColumnKey = safeDefinition.defaultConfig.visible_columns[0];
  const availableOptions = safeDefinition.columns.filter((column) => !visibleColumns.includes(column.key));
  const filteredAvailable = availableOptions.filter((column) => column.label.toLowerCase().includes(availableSearch.trim().toLowerCase()));
  const { allConditions, anyConditions } = getConditionGroups(safeFilters);
  const conditionCount = allConditions.length + anyConditions.length;
  const sortKey = typeof saved.draftConfig.sort?.key === "string" ? saved.draftConfig.sort.key : "__none__";
  const sortDirection = saved.draftConfig.sort?.direction === "desc" ? "desc" : "asc";
  const hasLoadError = Boolean(saved.error || moduleFieldsQuery.error || customFieldsQuery.error || customModuleSchema.error);
  const pageLoading = definitionLoading || (Boolean(definition) && saved.isLoading);

  useEffect(() => {
    if (saved.selectedViewId !== requestedViewId && !(requestedViewId === "system-default" && saved.selectedView?.is_system)) saved.setSelectedViewId(requestedViewId);
  }, [requestedViewId, saved]);

  function setConfig(config: SavedViewConfig) { saved.setDraftConfig({ visible_columns: [...config.visible_columns], filters: { ...config.filters }, sort: config.sort ? { ...config.sort } : null }); }
  function startEdit() { if (!saved.selectedView || saved.selectedView.is_system) return; setName(saved.selectedView.name); setMode("edit"); setActionError(null); }
  function startDuplicate() { if (!saved.selectedView) return; setName(`${saved.selectedView.name} copy`); setConfig({ ...saved.draftConfig, visible_columns: visibleColumns, filters: safeFilters }); setMode("duplicate"); setActionError(null); }
  function startCreate() { setName(""); setConfig(safeDefinition.defaultConfig); setMode("create"); setActionError(null); }
  function discard() { setName(baseName); if (saved.selectedView) setConfig({ ...saved.selectedView.config, visible_columns: baseColumns, filters: baseFilters }); setMode("view"); setActionError(null); }
  function navigateToView(viewId: string) { if (viewId === saved.selectedViewId) return; if (isDirty && !window.confirm("Switch views and discard unsaved changes?")) return; setMode("view"); setActionError(null); router.replace(`/dashboard/views/${moduleKey}?viewId=${viewId}`); }

  function updateColumns(next: string[], message?: string) { if (!editable || !next.length) return; saved.setDraftConfig((current) => ({ ...current, visible_columns: next })); if (message) setAnnouncement(message); }
  function addColumn(key: string) { const option = safeDefinition.columns.find((column) => column.key === key); if (!visibleColumns.includes(key)) updateColumns([...visibleColumns, key], `${option?.label ?? key} added.`); }
  function removeColumn(key: string) { const option = safeDefinition.columns.find((column) => column.key === key); if (option?.is_protected || key === protectedColumnKey || visibleColumns.length <= 1) return; updateColumns(visibleColumns.filter((column) => column !== key), `${option?.label ?? key} removed.`); }
  function moveColumn(key: string, direction: "up" | "down") { const index = visibleColumns.indexOf(key); const target = direction === "up" ? index - 1 : index + 1; if (index < 0 || target < 0 || target >= visibleColumns.length) return; const next = [...visibleColumns]; const [column] = next.splice(index, 1); next.splice(target, 0, column); const label = safeDefinition.columns.find((item) => item.key === key)?.label ?? key; updateColumns(next, `${label} moved to position ${target + 1}.`); }
  function dropColumn(targetKey: string) { if (!editable || !draggedColumn || draggedColumn === targetKey) return; const next = [...visibleColumns]; const from = next.indexOf(draggedColumn); const target = next.indexOf(targetKey); if (from < 0 || target < 0) return; const [column] = next.splice(from, 1); next.splice(target, 0, column); setDraggedColumn(null); updateColumns(next, `${safeDefinition.columns.find((item) => item.key === column)?.label ?? column} moved to position ${target + 1}.`); }

  async function saveDraft() {
    if (!name.trim()) { setActionError("Enter a view name before saving."); return; }
    setActionError(null);
    const config = { ...saved.draftConfig, visible_columns: visibleColumns, filters: safeFilters };
    try {
      if (mode === "edit" && saved.selectedView?.id != null) {
        await saved.updateView(saved.selectedView.id, { name: name.trim(), config });
        setMode("view"); toast.success("Saved view updated.");
      } else {
        const created = await saved.createViewWithConfig({ name: name.trim(), config });
        setMode("view"); toast.success(mode === "duplicate" ? "View duplicated." : "Saved view created.");
        router.replace(`/dashboard/views/${moduleKey}?viewId=${created.id}`);
      }
    } catch (error) {
      setActionError(error instanceof SavedViewApiError && error.code === "not-found" ? "This view was deleted elsewhere. Your draft is still available; duplicate it to keep these changes." : "The saved view could not be saved. Your draft has been kept.");
    }
  }
  async function setDefault() { try { await saved.setCurrentAsDefault(); toast.success("Default view updated."); } catch { setActionError("The default view could not be updated."); } }
  async function removeView() { if (!saved.selectedView || saved.selectedView.is_system) return; if (!(await confirm({ title: "Delete saved view?", description: `Delete the view "${saved.selectedView.name}"?`, confirmLabel: "Delete View", variant: "destructive" }))) return; try { await saved.deleteCurrentView(); toast.success("Saved view deleted."); router.replace(`/dashboard/views/${moduleKey}?viewId=system-default`); } catch (error) { setActionError(error instanceof SavedViewApiError && error.code === "not-found" ? "This view was already deleted elsewhere." : "The saved view could not be deleted. Please try again."); } }
  async function retryAll() { await Promise.all([saved.refresh(), moduleFieldsQuery.refresh(), CUSTOM_FIELD_SUPPORTED_MODULES.has(moduleKey) ? customFieldsQuery.refetch() : Promise.resolve(), shouldLoadCustomModule ? customModuleSchema.refetch() : Promise.resolve()]); }

  const viewManagerTitle = `${safeDefinition.label} views`;

  // The three whole-route states go through the shell so this route keeps one h1 and one
  // state vocabulary (§7.4, §8) — each of these used to draw its own heading inside a Card.
  if (pageLoading || hasLoadError || !definition) {
    return (
      <PageShell
        title={viewManagerTitle}
        isLoading={pageLoading}
        hasError={hasLoadError || !definition}
        errorDescription={
          hasLoadError
            ? "Try again. Your existing saved views have not been changed."
            : "This module does not provide configurable list columns and filters."
        }
        onRetry={hasLoadError ? () => void retryAll() : undefined}
      >
        {null}
      </PageShell>
    );
  }

  return <PageShell
   title={viewManagerTitle}
   actions={(
     <>
     <Button asChild variant="ghost" size="sm"><Link href={definition.route}><ArrowLeft />Back to {definition.label}</Link></Button>
     <Select value={saved.selectedViewId || selectedViewKey} onValueChange={navigateToView}><SelectTrigger className="w-full sm:w-64" aria-label="Select saved view"><SelectValue /></SelectTrigger><SelectContent>{saved.views.map((view) => <SelectItem key={String(view.id ?? "system-default")} value={String(view.id ?? "system-default")}>{view.name}{view.is_default ? " (Default)" : ""}</SelectItem>)}</SelectContent></Select>
     {saved.selectedView?.is_system ? <Button variant="outline" onClick={startDuplicate}><Copy />Duplicate</Button> : mode === "view" ? <Button variant="outline" onClick={startEdit}><Pencil />Edit view</Button> : null}
     <Button onClick={startCreate}><Plus />New view</Button>
     </>
   )}
 >

    <Card>
      <CardHeader className="flex-col gap-4 sm:flex-row">
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold text-copy-primary">{mode === "view" ? saved.selectedView?.name : mode === "edit" ? "Edit user view" : mode === "duplicate" ? "Duplicate view" : "Create new view"}</h2>{saved.selectedView?.is_system && mode === "view" ? <Chip>System · read-only</Chip> : null}{saved.selectedView?.is_default && mode === "view" ? <Chip>Default</Chip> : null}</div><p className="mt-1 text-sm text-copy-muted">{visibleColumns.length} columns · {conditionCount} conditions · {sortKey === "__none__" ? "Default sorting" : `Sorted by ${safeDefinition.columns.find((column) => column.key === sortKey)?.label ?? sortKey}`}</p></div>
        {editable ? <div className="w-full sm:w-72"><Label htmlFor="view-name">View name</Label><Input id="view-name" className="mt-2" value={name} onChange={(event) => setName(event.target.value)} placeholder={`${definition.label} view`} /></div> : null}
      </CardHeader>
      <div className="mt-5 overflow-x-auto border-y border-line-subtle px-4" role="tablist" aria-label="Saved view editor">{(["columns", "filters", "sort"] as EditorSection[]).map((item) => <button key={item} type="button" role="tab" aria-selected={section === item} onClick={() => setSection(item)} className={`px-4 py-3 text-sm font-medium capitalize ${section === item ? "border-b-2 border-primary text-primary" : "text-copy-secondary"}`}>{item}</button>)}</div>
      <CardBody>
        {section === "columns" ? <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
          <div><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-copy-primary">Selected columns</h3><p className="text-xs text-copy-muted">Ordered from left to right in the module table.</p></div><Chip>{selectedOptions.length}</Chip></div><div className="mt-3 divide-y divide-line-subtle rounded-[var(--radius-control)] border border-line-default">{selectedOptions.map((column, index) => { const isProtected = column.is_protected || column.key === protectedColumnKey; return <div key={column.key} data-testid={`selected-column-${column.key}`} draggable={editable} onDragStart={() => setDraggedColumn(column.key)} onDragEnd={() => setDraggedColumn(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropColumn(column.key)} className="flex items-center gap-2 px-3 py-2"><GripVertical className="h-4 w-4 text-copy-muted" /><span className="min-w-0 flex-1 truncate text-sm text-copy-primary">{index + 1}. {column.label}{isProtected ? " · Required" : ""}</span>{editable ? <><Button size="icon-sm" variant="ghost" disabled={index === 0} onClick={() => moveColumn(column.key, "up")} aria-label={`Move ${column.label} up`}><ArrowUp /></Button><Button size="icon-sm" variant="ghost" disabled={index === selectedOptions.length - 1} onClick={() => moveColumn(column.key, "down")} aria-label={`Move ${column.label} down`}><ArrowDown /></Button><Button size="icon-sm" variant="ghost" disabled={isProtected || selectedOptions.length <= 1} onClick={() => removeColumn(column.key)} aria-label={`Hide ${column.label}`} title={isProtected ? "This column is required." : undefined}><EyeOff /></Button></> : null}</div>; })}</div></div>
          <div><h3 className="text-sm font-semibold text-copy-primary">Available columns</h3><SearchBar value={availableSearch} onChange={setAvailableSearch} placeholder="Search available columns" className="mt-3 md:w-full" />{editable ? <div className="mt-3 max-h-72 divide-y divide-line-subtle overflow-y-auto rounded-[var(--radius-control)] border border-line-default">{filteredAvailable.length ? filteredAvailable.map((column) => <button key={column.key} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-muted" onClick={() => addColumn(column.key)}><span>{column.label}</span><Plus className="h-4 w-4" /></button>) : <p className="p-3 text-sm text-copy-muted">{availableOptions.length ? "No columns match this search." : "All available columns are selected."}</p>}</div> : <p className="mt-3 text-sm text-copy-muted">Choose Edit view or Duplicate to change columns.</p>}</div>
          <p className="sr-only" aria-live="polite">{announcement}</p>
        </div> : section === "filters" ? editable ? <div className="space-y-5"><div className="max-w-md"><Label htmlFor="default-search">Default search</Label><Input id="default-search" className="mt-2" value={typeof safeFilters.search === "string" ? safeFilters.search : ""} onChange={(event) => saved.setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: event.target.value } }))} /></div><SavedViewConditionEditor filterFields={safeDefinition.filterFields} filters={safeFilters} onChange={(filters) => saved.setDraftConfig((current) => ({ ...current, filters }))} allConditions={allConditions} anyConditions={anyConditions} title="View filters" description="AND conditions must all match; OR conditions may match." wrapInCard={false} /></div> : <div className="space-y-3"><p className="text-sm text-copy-secondary">Default search: {typeof safeFilters.search === "string" && safeFilters.search ? safeFilters.search : "None"}</p><p className="text-sm text-copy-secondary">{allConditions.length} AND conditions · {anyConditions.length} OR conditions</p><p className="text-sm text-copy-muted">Choose Edit view or Duplicate to change filters.</p></div> : <div className="grid gap-4 sm:grid-cols-2"><div><Label>Sort column</Label><Select value={sortKey} disabled={!editable} onValueChange={(key) => saved.setDraftConfig((current) => ({ ...current, sort: key === "__none__" ? null : { key, direction: sortDirection } }))}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">Module default</SelectItem>{safeDefinition.columns.map((column) => <SelectItem key={column.key} value={column.key}>{column.label}</SelectItem>)}</SelectContent></Select></div><div><Label>Direction</Label><Select value={sortDirection} disabled={!editable || sortKey === "__none__"} onValueChange={(direction) => saved.setDraftConfig((current) => ({ ...current, sort: sortKey === "__none__" ? null : { key: sortKey, direction } }))}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="asc">Ascending</SelectItem><SelectItem value="desc">Descending</SelectItem></SelectContent></Select></div></div>}
      </CardBody>
      <CardFooter className="sticky bottom-0 z-20 flex flex-col gap-3 bg-surface/95 backdrop-blur sm:flex-row sm:items-center sm:justify-between"><div><p className={`text-sm font-medium ${isDirty ? "text-state-warning" : "text-state-success"}`}>{isDirty ? "Unsaved changes" : mode === "view" ? "Viewing saved configuration" : "All changes saved"}</p>{actionError ? <p role="alert" className="mt-1 text-sm text-state-danger">{actionError}</p> : null}</div><div className="flex flex-wrap gap-2">{mode === "view" && saved.selectedView && !saved.selectedView.is_system ? <><Button variant="outline" disabled={saved.selectedView.is_default || saved.isSaving} onClick={() => void setDefault()}>Set default</Button><Button variant="destructiveGhost" disabled={saved.isSaving} onClick={() => void removeView()}><Trash2 />Delete</Button></> : null}{editable ? <><Button variant="ghost" disabled={saved.isSaving} onClick={discard}>Discard</Button><Button disabled={saved.isSaving || !name.trim() || (mode === "edit" && !editDirty)} onClick={() => void saveDraft()}>{saved.isSaving ? "Saving…" : mode === "edit" ? "Save changes" : mode === "duplicate" ? "Create duplicate" : "Create view"}</Button></> : null}</div></CardFooter>
    </Card>
  </PageShell>;
}
