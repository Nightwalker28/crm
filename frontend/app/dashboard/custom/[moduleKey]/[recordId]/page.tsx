"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useParams } from "next/navigation";
import { Save } from "lucide-react";

import { CustomModuleFieldInput } from "@/components/customModules/CustomModuleRecordDialog";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecordTabs } from "@/components/ui/RecordTabs";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useCustomModuleRecord, useCustomModuleSchema, type CustomModuleField, type CustomModuleRecord } from "@/hooks/useModuleBuilder";

function getInitialValues(fields: CustomModuleField[], record: CustomModuleRecord) {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    values[field.key] = record.values?.[field.key] ?? field.default_value ?? (field.field_type === "boolean" ? false : "");
  }
  return values;
}

function CustomModuleRecordOverview({
  fields,
  record,
  isSaving,
  onSave,
}: {
  fields: CustomModuleField[];
  record: CustomModuleRecord;
  isSaving: boolean;
  onSave: (payload: { title?: string; values: Record<string, unknown> }) => Promise<unknown>;
}) {
  const [title, setTitle] = useState(record.title);
  const [values, setValues] = useState<Record<string, unknown>>(() => getInitialValues(fields, record));
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSave({ title: title.trim() || record.title, values });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save record");
    }
  }

  return (
    <form id="custom-module-record-form" onSubmit={handleSubmit} className="rounded-md border border-neutral-800 bg-neutral-950/70 p-5">
      <div className="mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Record Details</h2>
        {error ? <div className="mt-3 rounded-md border border-red-900/70 bg-red-950/30 px-4 py-3 text-sm text-red-100">{error}</div> : null}
      </div>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field className="sm:col-span-2">
          <FieldLabel>Record Title</FieldLabel>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} className="bg-neutral-950" />
        </Field>
        {fields.map((field) => (
          <Field key={field.id} className={field.field_type === "textarea" || field.field_type === "multi_select" ? "sm:col-span-2" : undefined}>
            {field.field_type !== "boolean" ? (
              <FieldLabel>
                {field.label}
                {field.is_required ? <RequiredMark /> : null}
              </FieldLabel>
            ) : null}
            <CustomModuleFieldInput
              field={field}
              value={values[field.key]}
              onChange={(next) => setValues((current) => ({ ...current, [field.key]: next }))}
            />
          </Field>
        ))}
      </FieldGroup>
      <div className="mt-5 flex justify-end">
        <Button type="submit" disabled={isSaving}>
          <Save size={15} />
          {isSaving ? "Saving..." : "Save Record"}
        </Button>
      </div>
    </form>
  );
}

export default function CustomModuleRecordDetailPage() {
  const params = useParams<{ moduleKey: string; recordId: string }>();
  const moduleKey = params.moduleKey;
  const recordId = params.recordId;
  const schema = useCustomModuleSchema(moduleKey);
  const recordQuery = useCustomModuleRecord(moduleKey, recordId);
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
  const backHref = `/dashboard/custom/${moduleKey}`;
  const description = schema.data?.name ? `${schema.data.name} record` : "Custom module record";

  if (schema.isLoading || recordQuery.isLoading) {
    return <div className="rounded-md border border-neutral-800 bg-neutral-950/70 px-4 py-6 text-sm text-neutral-500">Loading record...</div>;
  }

  if (!recordQuery.record) {
    return (
      <EmptyState
        title="Record not found"
        description="This custom module record may have been deleted or you may not have access to it."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <RecordPageHeader
        backHref={backHref}
        backLabel="Back to records"
        title={recordQuery.record.title}
        description={description}
        primaryAction={
          <Button type="submit" form="custom-module-record-form" disabled={recordQuery.isSaving}>
            <Save size={15} />
            {recordQuery.isSaving ? "Saving..." : "Save"}
          </Button>
        }
      />

      <RecordTabs
        tabs={[
          {
            id: "overview",
            label: "Overview",
            content: (
              <CustomModuleRecordOverview
                key={recordQuery.record.id}
                fields={fields}
                record={recordQuery.record}
                isSaving={recordQuery.isSaving}
                onSave={recordQuery.updateRecord}
              />
            ),
          },
          {
            id: "activity",
            label: "Activity",
            content: <EmptyState title="Activity timeline unavailable" description="Custom module record activity needs shared backend timeline support for dynamic module keys." />,
          },
          {
            id: "notes",
            label: "Notes",
            content: <EmptyState title="Notes unavailable" description="Record comments are currently enabled for core sales records only." />,
          },
          {
            id: "documents",
            label: "Documents",
            content: <EmptyState title="Documents unavailable" description="Document linking for dynamic custom module records needs shared backend record-reference support." />,
          },
        ]}
      />
    </div>
  );
}
