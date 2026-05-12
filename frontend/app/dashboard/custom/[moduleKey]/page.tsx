"use client";

import { FormEvent, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { useParams } from "next/navigation";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { ColumnPicker } from "@/components/ui/ColumnPicker";
import { Input } from "@/components/ui/input";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { Textarea } from "@/components/ui/textarea";
import { useCustomModuleRecords, useCustomModuleSchema, type CustomModuleField, type CustomModuleRecord } from "@/hooks/useModuleBuilder";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildCustomModuleViewDefinition } from "@/lib/moduleViewConfigs";

function renderValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value == null || value === "" ? "-" : String(value);
}

function FieldInput({ field, value, onChange }: { field: CustomModuleField; value: unknown; onChange: (value: unknown) => void }) {
  const options = field.validation_json?.options ?? [];
  if (field.field_type === "single_select" && options.length) {
    return (
      <select value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} required={field.is_required} className="h-9 rounded-md border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-200">
        <option value="">Select...</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (field.field_type === "multi_select" && options.length) {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <div className="flex flex-wrap gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...selected, option]
                  : selected.filter((item) => item !== option);
                onChange(next);
              }}
            />
            {option}
          </label>
        ))}
      </div>
    );
  }
  const common = {
    value: typeof value === "string" || typeof value === "number" ? String(value) : "",
    onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    placeholder: field.placeholder ?? field.label,
    required: field.is_required,
    className: "bg-neutral-950",
  };
  if (field.field_type === "textarea") {
    return <Textarea value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder ?? field.label} required={field.is_required} className="bg-neutral-950" />;
  }
  if (field.field_type === "boolean") {
    return (
      <label className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        {field.label}
      </label>
    );
  }
  const type = field.field_type === "number" || field.field_type === "currency" ? "number" : field.field_type === "date" ? "date" : field.field_type === "datetime" ? "datetime-local" : field.field_type === "email" ? "email" : field.field_type === "url" ? "url" : "text";
  return <Input {...common} type={type} />;
}

export default function CustomModulePage() {
  const params = useParams<{ moduleKey: string }>();
  const moduleKey = params.moduleKey;
  const [page, setPage] = useState(1);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [title, setTitle] = useState("");
  const [editingRecord, setEditingRecord] = useState<CustomModuleRecord | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const schema = useCustomModuleSchema(moduleKey);
  const fields = useMemo(() => (schema.data?.fields ?? []).filter((field) => field.is_active).sort((a, b) => a.sort_order - b.sort_order), [schema.data]);
  const viewDefinition = useMemo(() => (schema.data ? buildCustomModuleViewDefinition(schema.data) : null), [schema.data]);
  const defaultViewConfig = viewDefinition?.defaultConfig ?? {
    visible_columns: ["title"],
    filters: { search: "", logic: "all" as const, conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  };
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews(moduleKey, defaultViewConfig, Boolean(viewDefinition));
  const visibleColumns = draftConfig.visible_columns?.length ? draftConfig.visible_columns : defaultViewConfig.visible_columns;
  const search = typeof draftConfig.filters.search === "string" ? draftConfig.filters.search : "";
  const records = useCustomModuleRecords(moduleKey, page, search);
  const fieldsByKey = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);
  const tableColumns = visibleColumns
    .map((column) => (column === "title" ? { key: "title", label: "Title", field: null } : { key: column, label: fieldsByKey.get(column)?.label ?? column, field: fieldsByKey.get(column) ?? null }))
    .filter((column) => column.key === "title" || column.field);

  async function createRecord(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await records.saveRecord({ title: title.trim() || undefined, values });
      setTitle("");
      setValues({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save record");
    }
  }

  function beginEdit(record: CustomModuleRecord) {
    setEditingRecord(record);
    setEditTitle(record.title);
    setEditValues(record.values ?? {});
    setError(null);
  }

  async function updateRecord(event: FormEvent) {
    event.preventDefault();
    if (!editingRecord) return;
    setError(null);
    try {
      await records.updateRecord({
        recordId: editingRecord.id,
        payload: { title: editTitle.trim() || editingRecord.title, values: editValues },
      });
      setEditingRecord(null);
      setEditTitle("");
      setEditValues({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update record");
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title={schema.data?.name ?? "Custom Module"}
        description={schema.data?.description ?? "Tenant custom module records."}
        actions={
          viewDefinition ? (
            <SavedViewSelector
              moduleKey={moduleKey}
              views={views}
              selectedViewId={selectedViewId}
              onSelect={(viewId) => {
                setSelectedViewId(viewId);
                setPage(1);
              }}
            />
          ) : null
        }
      />

      {error ? <div className="rounded-md border border-red-900/70 bg-red-950/30 px-4 py-3 text-sm text-red-100">{error}</div> : null}

      <form onSubmit={createRecord} className="rounded-md border border-neutral-800 bg-neutral-950/70 p-4">
        <div className="mb-3 grid gap-3 md:grid-cols-2">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Record title" className="bg-neutral-950" />
          {fields.map((field) => (
            <div key={field.id} className="flex flex-col gap-1.5">
              {field.field_type !== "boolean" ? <label className="text-xs font-medium text-neutral-400">{field.label}</label> : null}
              <FieldInput field={field} value={values[field.key]} onChange={(next) => setValues((current) => ({ ...current, [field.key]: next }))} />
            </div>
          ))}
        </div>
        <Button type="submit" disabled={records.isSaving || fields.length === 0} className="border border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800">
          <Plus size={15} />
          Add Record
        </Button>
      </form>

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

      {editingRecord ? (
        <form onSubmit={updateRecord} className="rounded-md border border-neutral-800 bg-neutral-950/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-neutral-100">Edit Record</div>
              <div className="text-xs text-neutral-500">#{editingRecord.id}</div>
            </div>
            <button type="button" onClick={() => setEditingRecord(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-900 hover:text-neutral-100" aria-label="Close editor">
              <X size={15} />
            </button>
          </div>
          <div className="mb-3 grid gap-3 md:grid-cols-2">
            <Input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} placeholder="Record title" className="bg-neutral-950" />
            {fields.map((field) => (
              <div key={field.id} className="flex flex-col gap-1.5">
                {field.field_type !== "boolean" ? <label className="text-xs font-medium text-neutral-400">{field.label}</label> : null}
                <FieldInput field={field} value={editValues[field.key]} onChange={(next) => setEditValues((current) => ({ ...current, [field.key]: next }))} />
              </div>
            ))}
          </div>
          <Button type="submit" disabled={records.isSaving} className="border border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800">
            <Save size={15} />
            Save Changes
          </Button>
        </form>
      ) : null}

      <ModuleTableShell>
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableHeaderRow>
              {tableColumns.map((column) => <TableHead key={column.key}>{column.label}</TableHead>)}
              <TableHead className="text-right">Actions</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {records.isLoading || schema.isLoading ? (
              <TableRow><TableCell colSpan={tableColumns.length + 1} className="py-10 text-center text-neutral-500">Loading records...</TableCell></TableRow>
            ) : records.records.length === 0 ? (
              <TableRow><TableCell colSpan={tableColumns.length + 1} className="py-10 text-center text-neutral-500">No records yet.</TableCell></TableRow>
            ) : (
              records.records.map((record) => (
                <TableRow key={record.id}>
                  {tableColumns.map((column) => (
                    <TableCell key={column.key} className={column.key === "title" ? "font-medium text-neutral-100" : "text-neutral-400"}>
                      {column.key === "title" ? record.title : renderValue(record.values[column.key])}
                    </TableCell>
                  ))}
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => beginEdit(record)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-900 hover:text-neutral-100" aria-label="Edit record">
                        <Pencil size={15} />
                      </button>
                      <button type="button" onClick={() => records.deleteRecord(record.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-red-950/30 hover:text-red-200" aria-label="Delete record">
                        <Trash2 size={15} />
                      </button>
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
    </div>
  );
}
