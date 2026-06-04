"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

import { CustomModuleRecordDialog } from "@/components/customModules/CustomModuleRecordDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { ColumnPicker } from "@/components/ui/ColumnPicker";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { SortableHead, Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useCustomModuleRecords, useCustomModuleSchema, type CustomModuleRecord, type CustomModuleRecordSortState } from "@/hooks/useModuleBuilder";
import { useSavedViews } from "@/hooks/useSavedViews";
import { formatDateTime } from "@/lib/datetime";
import { buildCustomModuleViewDefinition, resolveVisibleColumns } from "@/lib/moduleViewConfigs";

function renderValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value == null || value === "" ? "-" : String(value);
}

type CustomModuleTableSortState = { column: string; direction: "asc" | "desc" } | null;

const SORTABLE_RECORD_COLUMNS = new Set(["title", "created_at", "updated_at"]);

function renderRecordColumn(record: CustomModuleRecord, column: string) {
  if (column === "title") {
    return record.title;
  }
  if (column === "created_at") {
    return record.created_at ? formatDateTime(record.created_at, { hour: "numeric", minute: "2-digit" }) : "-";
  }
  if (column === "updated_at") {
    return record.updated_at ? formatDateTime(record.updated_at, { hour: "numeric", minute: "2-digit" }) : "-";
  }
  return renderValue(record.values[column]);
}

export default function CustomModulePage() {
  const params = useParams<{ moduleKey: string }>();
  const router = useRouter();
  const moduleKey = params.moduleKey;
  const [page, setPage] = useState(1);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schema = useCustomModuleSchema(moduleKey);
  const { fields: moduleFields } = useModuleFieldConfigs(moduleKey);
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
  const viewDefinition = useMemo(() => (schema.data ? buildCustomModuleViewDefinition(schema.data, moduleFields) : null), [moduleFields, schema.data]);
  const defaultViewConfig = viewDefinition?.defaultConfig ?? {
    visible_columns: ["title"],
    filters: { search: "", logic: "all" as const, conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  };
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews(moduleKey, defaultViewConfig, Boolean(viewDefinition));
  const visibleColumns = resolveVisibleColumns(viewDefinition, draftConfig, defaultViewConfig);
  const search = typeof draftConfig.filters.search === "string" ? draftConfig.filters.search : "";
  const sort = useMemo<CustomModuleRecordSortState>(() => {
    const rawSort = draftConfig.sort;
    if (!rawSort) {
      return null;
    }
    const key =
      typeof rawSort.key === "string"
        ? rawSort.key
        : typeof rawSort.column === "string"
          ? rawSort.column
          : null;
    if (!key || !SORTABLE_RECORD_COLUMNS.has(key)) {
      return null;
    }
    return { key, direction: rawSort.direction === "desc" ? "desc" : "asc" };
  }, [draftConfig.sort]);
  const records = useCustomModuleRecords(moduleKey, page, search, sort);
  const fieldsByKey = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);
  const tableColumns = visibleColumns
    .map((column) => (
      SORTABLE_RECORD_COLUMNS.has(column)
        ? { key: column, label: column === "title" ? "Title" : column === "created_at" ? "Created" : "Updated", field: null }
        : { key: column, label: fieldsByKey.get(column)?.label ?? column, field: fieldsByKey.get(column) ?? null }
    ))
    .filter((column) => SORTABLE_RECORD_COLUMNS.has(column.key) || column.field);

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

  async function createRecord(payload: { title?: string; values: Record<string, unknown> }) {
    setError(null);
    try {
      await records.saveRecord(payload);
      setIsCreateOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save record");
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title={schema.data?.name ?? "Custom Module"}
        description={schema.data?.description ?? "Tenant custom module records."}
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
            <Button type="button" onClick={() => { setError(null); setIsCreateOpen(true); }} disabled={fields.length === 0}>
              <Plus size={15} />
              New Record
            </Button>
          </>
        }
      />

      {error && !isCreateOpen ? <div className="rounded-md border border-red-900/70 bg-red-950/30 px-4 py-3 text-sm text-red-100">{error}</div> : null}

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
          className="max-w-sm bg-neutral-950"
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
          <ModuleImportExportControls
            importEndpoint={`/custom-modules/${moduleKey}/import`}
            exportEndpoint={`/custom-modules/${moduleKey}/export`}
            importLabel="Import CSV"
            exportLabel="Export CSV"
            onImportSuccess={() => records.refresh()}
          />
        </div>
      </div>

      <ModuleTableShell>
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
              <TableHead className="text-right">Actions</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {records.isLoading || schema.isLoading ? (
              <TableRow><TableCell colSpan={tableColumns.length + 1} className="py-10 text-center text-neutral-500">Loading records...</TableCell></TableRow>
            ) : records.records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={tableColumns.length + 1}>
                  <EmptyState
                    title="No records yet"
                    description="Create the first record for this custom module."
                    action={
                      <Button type="button" onClick={() => { setError(null); setIsCreateOpen(true); }} disabled={fields.length === 0}>
                        <Plus size={15} />
                        New Record
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              records.records.map((record) => (
                <TableRow key={record.id} className="cursor-pointer" onClick={() => router.push(`/dashboard/custom/${moduleKey}/${record.id}`)}>
                  {tableColumns.map((column) => (
                    <TableCell key={column.key} className={column.key === "title" ? "font-medium text-neutral-100" : "text-neutral-400"}>
                      {column.key === "title" ? (
                        <Link href={`/dashboard/custom/${moduleKey}/${record.id}`} className="text-neutral-100 hover:underline">
                          {record.title}
                        </Link>
                      ) : (
                        <Link href={`/dashboard/custom/${moduleKey}/${record.id}`} className="block text-neutral-400">
                          {renderRecordColumn(record, column.key)}
                        </Link>
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          if (window.confirm("Delete this custom module record?")) {
                            void records.deleteRecord(record.id);
                          }
                        }}
                        className="text-neutral-500 hover:bg-red-950/30 hover:text-red-200"
                        aria-label="Delete record"
                        title="Delete"
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ModuleTableShell>

      <div className="flex items-center justify-between text-sm text-neutral-500">
        <span>{records.totalCount} records</span>
        <div className="flex gap-2">
          <Button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="border border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800">Previous</Button>
          <Button type="button" disabled={page >= records.totalPages} onClick={() => setPage((value) => value + 1)} className="border border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800">Next</Button>
        </div>
      </div>

      {isCreateOpen ? (
        <CustomModuleRecordDialog
          open={isCreateOpen}
          mode="create"
          fields={fields}
          isSaving={records.isSaving}
          error={error}
          onClose={() => {
            setIsCreateOpen(false);
            setError(null);
          }}
          onSubmit={createRecord}
        />
      ) : null}
    </div>
  );
}
