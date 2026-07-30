"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ColumnPicker } from "@/components/ui/ColumnPicker";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { PageHeader } from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { SortableHead, Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useCustomModuleRecords, useCustomModuleSchema, type CustomModuleRecord, type CustomModuleRecordSortState } from "@/hooks/useModuleBuilder";
import { useSavedViews } from "@/hooks/useSavedViews";
import { formatDateTime } from "@/lib/datetime";
import { buildCustomModuleViewDefinition, resolveVisibleColumns } from "@/lib/moduleViewConfigs";

function renderValue(value: unknown) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value == null || value === "" ? "—" : String(value);
}

type CustomModuleTableSortState = { column: string; direction: "asc" | "desc" } | null;

const SORTABLE_RECORD_COLUMNS = new Set(["title", "created_at", "updated_at"]);

function renderRecordColumn(record: CustomModuleRecord, column: string) {
  if (column === "title") return record.title;
  if (column === "created_at") {
    return record.created_at ? formatDateTime(record.created_at, { hour: "numeric", minute: "2-digit" }) : "—";
  }
  if (column === "updated_at") {
    return record.updated_at ? formatDateTime(record.updated_at, { hour: "numeric", minute: "2-digit" }) : "—";
  }
  return renderValue(record.values[column]);
}

export default function CustomModulePage() {
  const params = useParams<{ moduleKey: string }>();
  const router = useRouter();
  const { confirm } = useConfirm();
  const moduleKey = params.moduleKey;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const schema = useCustomModuleSchema(moduleKey);
  const accessibleModule = modules.find((module) => module.id === schema.data?.module_id);
  const actions = accessibleModule?.actions;
  const canCreate = Boolean(actions?.can_create);
  const canDelete = Boolean(actions?.can_delete);
  const canExport = Boolean(actions?.can_export);
  const { fields: moduleFields, isLoading: fieldsLoading, error: fieldsError, refresh: refreshFields } = useModuleFieldConfigs(moduleKey);
  const enabledFieldKeys = useMemo(
    () => new Map(moduleFields.map((field) => [field.field_key, field.is_protected || field.is_enabled])),
    [moduleFields],
  );
  const fields = useMemo(
    () => (schema.data?.fields ?? [])
      .filter((field) => field.is_active && (enabledFieldKeys.get(field.key) ?? true))
      .sort((a, b) => a.sort_order - b.sort_order),
    [enabledFieldKeys, schema.data],
  );
  const viewDefinition = useMemo(
    () => (schema.data ? buildCustomModuleViewDefinition(schema.data, moduleFields) : null),
    [moduleFields, schema.data],
  );
  const defaultViewConfig = viewDefinition?.defaultConfig ?? {
    visible_columns: ["title"],
    filters: { search: "", logic: "all" as const, conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  };
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews(
    moduleKey,
    defaultViewConfig,
    Boolean(viewDefinition),
  );
  const visibleColumns = resolveVisibleColumns(viewDefinition, draftConfig, defaultViewConfig);
  const search = typeof draftConfig.filters.search === "string" ? draftConfig.filters.search : "";
  const sort = useMemo<CustomModuleRecordSortState>(() => {
    const rawSort = draftConfig.sort;
    if (!rawSort) return null;
    const key =
      typeof rawSort.key === "string"
        ? rawSort.key
        : typeof rawSort.column === "string"
          ? rawSort.column
          : null;
    if (!key || !SORTABLE_RECORD_COLUMNS.has(key)) return null;
    return { key, direction: rawSort.direction === "desc" ? "desc" : "asc" };
  }, [draftConfig.sort]);
  const records = useCustomModuleRecords(moduleKey, page, pageSize, search, sort);
  const fieldsByKey = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);
  const tableColumns = visibleColumns
    .map((column) => (
      SORTABLE_RECORD_COLUMNS.has(column)
        ? { key: column, label: column === "title" ? "Title" : column === "created_at" ? "Created" : "Updated", field: null }
        : { key: column, label: fieldsByKey.get(column)?.label ?? column, field: fieldsByKey.get(column) ?? null }
    ))
    .filter((column) => SORTABLE_RECORD_COLUMNS.has(column.key) || column.field);
  const actionColumnCount = canDelete ? 1 : 0;
  const columnCount = Math.max(1, tableColumns.length + actionColumnCount);
  const hasSearch = Boolean(search.trim());
  const rangeStart = records.totalCount ? (records.page - 1) * records.pageSize + 1 : 0;
  const rangeEnd = records.totalCount ? Math.min(records.page * records.pageSize, records.totalCount) : 0;

  function handleSortChange(nextSort: CustomModuleTableSortState) {
    setDraftConfig((current) => ({
      ...current,
      sort: nextSort ? { key: nextSort.column, direction: nextSort.direction } : null,
    }));
    setPage(1);
  }

  function toggleSort(column: string) {
    const nextSort: CustomModuleTableSortState =
      sort?.key === column
        ? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" };
    handleSortChange(nextSort);
  }

  async function handleDelete(record: CustomModuleRecord) {
    if (!canDelete) return;
    const confirmed = await confirm({
      title: "Delete record?",
      description: `Move "${record.title}" to the Recycle Bin? An administrator can restore it later.`,
      confirmLabel: "Move to Recycle Bin",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      await records.deleteRecord(record.id);
      if (records.records.length === 1 && page > 1) setPage((current) => current - 1);
      toast.success("Record moved to the Recycle Bin.");
    } catch {
      toast.error("We could not delete this record. Try again.");
    }
  }

  if (modulesLoading || schema.isLoading || fieldsLoading) {
    return <RouteLoadingState label="custom module records" />;
  }

  if (!accessibleModule?.actions?.can_view) {
    return <PermissionDeniedState />;
  }

  if (schema.error || fieldsError || !schema.data) {
    return (
      <RouteErrorState
        title="Unable to load this custom module"
        description="The module configuration could not be loaded. Try again or return to the dashboard."
        reset={() => void Promise.all([schema.refetch(), refreshFields()])}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={schema.data.name}
        description={schema.data.description ?? "Tenant custom module records."}
        eyebrow={records.totalCount ? `${records.totalCount} record${records.totalCount === 1 ? "" : "s"}` : undefined}
        actions={
          <>
            {viewDefinition ? (
              <SavedViewSelector
                moduleKey={moduleKey}
                views={views}
                selectedViewId={selectedViewId}
                onSelect={(viewId) => {
                  setSelectedViewId(viewId);
                  setPage(1);
                }}
              />
            ) : null}
            {canCreate ? (
              <Button asChild>
                <Link href={`/dashboard/custom/${moduleKey}/new`}>
                  <Plus />
                  New record
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          value={search}
          onChange={(event) => {
            setDraftConfig((current) => ({
              ...current,
              filters: { ...current.filters, search: event.target.value },
            }));
            setPage(1);
          }}
          placeholder="Search records"
          aria-label="Search custom module records"
          className="max-w-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          {viewDefinition ? (
            <ColumnPicker
              options={viewDefinition.columns}
              visibleColumns={visibleColumns}
              onChange={(nextColumns) =>
                setDraftConfig((current) => ({
                  ...current,
                  visible_columns: nextColumns,
                }))
              }
            />
          ) : null}
          {canCreate || canExport ? (
            <ModuleImportExportControls
              importEndpoint={canCreate ? `/custom-modules/${moduleKey}/import` : undefined}
              exportEndpoint={canExport ? `/custom-modules/${moduleKey}/export` : undefined}
              importLabel="Import CSV"
              exportLabel="Export CSV"
              onImportSuccess={() => records.refresh()}
            />
          ) : null}
        </div>
      </div>

      {records.error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          <span>Records could not be loaded. Check your connection and try again.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void records.refresh()}>Try again</Button>
        </div>
      ) : null}

      <ModuleTableShell isRefreshing={records.isFetching && !records.isLoading}>
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableHeaderRow>
              {tableColumns.map((column) => (
                SORTABLE_RECORD_COLUMNS.has(column.key) ? (
                  <SortableHead
                    key={column.key}
                    sorted={sort?.key === column.key}
                    direction={sort?.key === column.key ? sort.direction : "asc"}
                    onClick={() => toggleSort(column.key)}
                  >
                    {column.label}
                  </SortableHead>
                ) : (
                  <TableHead key={column.key}>{column.label}</TableHead>
                )
              ))}
              {canDelete ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {records.isLoading ? (
              <ModuleTableLoading columnCount={columnCount} withCheckbox={false} />
            ) : records.error ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-12">
                  <EmptyState
                    title="Records unavailable"
                    description="Use Try again above to reload this custom module."
                  />
                </TableCell>
              </TableRow>
            ) : records.records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-12">
                  <EmptyState
                    title={hasSearch ? "No records match this search" : "No records yet"}
                    description={hasSearch
                      ? "Clear the search or try another term."
                      : canCreate
                        ? "Create the first record for this custom module."
                        : "Records will appear here when a teammate creates one."}
                    action={hasSearch
                      ? <Button type="button" variant="outline" onClick={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: "" } }))}>Clear search</Button>
                      : canCreate
                        ? <Button asChild><Link href={`/dashboard/custom/${moduleKey}/new`}>Create record</Link></Button>
                        : undefined}
                  />
                </TableCell>
              </TableRow>
            ) : (
              records.records.map((record) => (
                <TableRow key={record.id} className="cursor-pointer" onClick={() => router.push(`/dashboard/custom/${moduleKey}/${record.id}`)}>
                  {tableColumns.map((column) => (
                    <TableCell key={column.key} className={column.key === "title" ? "font-medium text-copy-primary" : "text-copy-secondary"}>
                      <Link
                        href={`/dashboard/custom/${moduleKey}/${record.id}`}
                        onClick={(event) => event.stopPropagation()}
                        className="block max-w-[320px] truncate rounded-[var(--radius-control-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {renderRecordColumn(record, column.key)}
                      </Link>
                    </TableCell>
                  ))}
                  {canDelete ? (
                    <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => void handleDelete(record)}
                        disabled={records.isSaving}
                        className="text-state-danger hover:bg-state-danger-muted hover:text-state-danger"
                        aria-label={`Delete ${record.title}`}
                        title="Delete record"
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ModuleTableShell>

      <Pagination
        page={records.page}
        totalPages={records.totalPages}
        totalCount={records.totalCount}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        pageSize={records.pageSize}
        isRefreshing={records.isFetching && !records.isLoading}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </div>
  );
}
