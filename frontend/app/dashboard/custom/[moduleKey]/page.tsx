"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import CustomModuleRecordsTable from "@/components/customModules/CustomModuleRecordsTable";
import { ColumnPicker } from "@/components/ui/ColumnPicker";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { PageShell } from "@/components/ui/PageShell";
import Pagination from "@/components/ui/Pagination";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import type { RecordTableSort } from "@/components/ui/RecordTable";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useCustomModuleRecords, useCustomModuleSchema, type CustomModuleRecord, type CustomModuleRecordSortState } from "@/hooks/useModuleBuilder";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildCustomModuleViewDefinition, resolveVisibleColumns } from "@/lib/moduleViewConfigs";

const SORTABLE_RECORD_COLUMNS = new Set(["title", "created_at", "updated_at"]);

export default function CustomModulePage() {
  const params = useParams<{ moduleKey: string }>();
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
  const hasSearch = Boolean(search.trim());
  const { allConditions, anyConditions } = getConditionGroups(draftConfig.filters);
  const activeFilterCount = allConditions.length + anyConditions.length;
  const hasActiveFilters = hasSearch || activeFilterCount > 0;
  const rangeStart = records.totalCount ? (records.page - 1) * records.pageSize + 1 : 0;
  const rangeEnd = records.totalCount ? Math.min(records.page * records.pageSize, records.totalCount) : 0;

  function handleSortChange(nextSort: RecordTableSort) {
    setDraftConfig((current) => ({
      ...current,
      sort: { key: nextSort.column, direction: nextSort.direction },
    }));
    setPage(1);
  }

  function clearFilters() {
    setDraftConfig((current) => ({
      ...current,
      filters: {
        ...current.filters,
        search: "",
        conditions: [],
        all_conditions: [],
        any_conditions: [],
      },
    }));
    setPage(1);
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

  const isResolving = modulesLoading || schema.isLoading || fieldsLoading;
  const schemaFailed = !isResolving && Boolean(schema.error || fieldsError || !schema.data);

  if (isResolving || schemaFailed || !accessibleModule?.actions?.can_view || !schema.data) {
    return (
      <PageShell
        variant="list"
        title={schema.data?.name ?? "Records"}
        isLoading={isResolving}
        isPermissionDenied={!isResolving && !accessibleModule?.actions?.can_view}
        hasError={schemaFailed}
        errorDescription="The module configuration could not be loaded. Try again or return to the dashboard."
        onRetry={() => void Promise.all([schema.refetch(), refreshFields()])}
      >
        {null}
      </PageShell>
    );
  }

  return (
    <PageShell variant="list" title={schema.data.name}>
      <ModuleListToolbar
        searchValue={search}
        onSearchChange={(value) => {
            setDraftConfig((current) => ({
              ...current,
              filters: { ...current.filters, search: value },
            }));
            setPage(1);
          }}
        searchPlaceholder="Search records"
        filtersOpen={Boolean(draftConfig.filters.filtersOpen)}
        activeFilterCount={activeFilterCount}
        onToggleFilters={() =>
          setDraftConfig((current) => ({
            ...current,
            filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen },
          }))
        }
        onClearFilters={clearFilters}
        viewControls={viewDefinition ? (
          <SavedViewSelector
            moduleKey={moduleKey}
            views={views}
            selectedViewId={selectedViewId}
            onSelect={(viewId) => {
              setSelectedViewId(viewId);
              setPage(1);
            }}
          />
        ) : undefined}
        primaryAction={canCreate ? <Button asChild><Link href={`/dashboard/custom/${moduleKey}/new`}><Plus />New record</Link></Button> : undefined}
        actionControls={
          <>
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
          </>
        }
      />

      {viewDefinition ? (
        <InlineSavedViewFilters
          filterFields={viewDefinition.filterFields}
          filters={draftConfig.filters}
          onChange={(filters) => {
            setDraftConfig((current) => ({ ...current, filters }));
            setPage(1);
          }}
          hideHeader
        />
      ) : null}

      <CustomModuleRecordsTable
        moduleKey={moduleKey}
        moduleLabel={schema.data.name}
        records={records.records}
        columns={tableColumns}
        isLoading={records.isLoading}
        isRefreshing={records.isFetching && !records.isLoading}
        hasError={Boolean(records.error)}
        onRetry={() => void records.refresh()}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        sort={sort ? { column: sort.key, direction: sort.direction } : null}
        onSortChange={handleSortChange}
        canCreate={canCreate}
        canDelete={canDelete}
        isDeleting={records.isSaving}
        onDelete={(record) => void handleDelete(record)}
      />

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
    </PageShell>
  );
}
