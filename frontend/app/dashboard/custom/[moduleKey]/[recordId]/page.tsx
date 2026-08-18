"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  CustomModuleFieldInput,
  getInitialCustomModuleValues,
} from "@/components/customModules/CustomModuleFieldInput";
import { FormSection } from "@/components/forms/RecordFormLayout";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecordTabs } from "@/components/ui/RecordTabs";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { RouteErrorState, RouteLoadingState, RouteNotFoundState } from "@/components/ui/RouteStates";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import {
  useCustomModuleRecord,
  useCustomModuleSchema,
  type CustomModuleField,
  type CustomModuleRecord,
} from "@/hooks/useModuleBuilder";

function isMissingRequiredValue(field: CustomModuleField, value: unknown) {
  if (!field.is_required || field.field_type === "boolean") return false;
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

function CustomModuleRecordOverview({
  fields,
  record,
  canEdit,
  isSaving,
  onSave,
}: {
  fields: CustomModuleField[];
  record: CustomModuleRecord;
  canEdit: boolean;
  isSaving: boolean;
  onSave: (payload: { title?: string; values: Record<string, unknown> }) => Promise<CustomModuleRecord>;
}) {
  const [title, setTitle] = useState(record.title);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    getInitialCustomModuleValues(fields, record),
  );
  const [initialSnapshot, setInitialSnapshot] = useState(() =>
    JSON.stringify([record.title, getInitialCustomModuleValues(fields, record)]),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState(false);
  const currentSnapshot = useMemo(() => JSON.stringify([title, values]), [title, values]);
  const isDirty = canEdit && currentSnapshot !== initialSnapshot;

  useUnsavedChangesGuard(isDirty, isSaving);

  function validateRequiredFields() {
    const nextErrors: Record<string, string> = {};
    for (const field of fields) {
      if (isMissingRequiredValue(field, values[field.key])) {
        nextErrors[field.key] = `${field.label} is required.`;
      }
    }
    setFieldErrors(nextErrors);
    const firstInvalidKey = Object.keys(nextErrors)[0];
    if (firstInvalidKey) {
      document.getElementById(`custom-field-${firstInvalidKey}`)?.focus();
      return false;
    }
    return true;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !validateRequiredFields()) return;
    setSubmitError(false);
    try {
      const updated = await onSave({ title: title.trim() || record.title, values });
      const nextValues = getInitialCustomModuleValues(fields, updated);
      setTitle(updated.title);
      setValues(nextValues);
      setInitialSnapshot(JSON.stringify([updated.title, nextValues]));
      toast.success("Record saved.");
    } catch {
      setSubmitError(true);
    }
  }

  // The field inputs carry the native required attribute, so without noValidate the browser
  // blocks submit and validateRequiredFields never runs.
  return (
    <form id="custom-module-record-form" onSubmit={handleSubmit} noValidate>
      {submitError ? (
        <div role="alert" className="mb-4 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          <div className="font-medium">We could not save this record.</div>
          <div className="mt-1 text-copy-secondary">Review the fields and try again.</div>
        </div>
      ) : null}

      {!canEdit ? (
        <div className="mb-4 rounded-[var(--radius-card)] border border-line-default bg-surface-muted px-4 py-3 text-sm text-copy-secondary">
          You have view-only access to this record.
        </div>
      ) : null}

      <FormSection
        title="Record details"
        description={canEdit
          ? "Required fields are controlled by the current module configuration."
          : "These values are read-only for your current role."}
      >
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="custom-record-title">Record title</FieldLabel>
            <Input
              id="custom-record-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={!canEdit}
            />
          </Field>
          {fields.map((field) => {
            const error = fieldErrors[field.key];
            return (
              <Field
                key={field.id}
                data-invalid={Boolean(error)}
                className={
                  field.field_type === "textarea" || field.field_type === "multi_select"
                    ? "sm:col-span-2"
                    : undefined
                }
              >
                {field.field_type !== "boolean" ? (
                  <FieldLabel htmlFor={`custom-field-${field.key}`}>
                    {field.label}
                    {field.is_required ? <RequiredMark /> : null}
                  </FieldLabel>
                ) : null}
                <CustomModuleFieldInput
                  field={field}
                  value={values[field.key]}
                  invalid={Boolean(error)}
                  disabled={!canEdit}
                  onChange={(next) => {
                    setValues((current) => ({ ...current, [field.key]: next }));
                    setFieldErrors((current) => {
                      if (!current[field.key]) return current;
                      const nextErrors = { ...current };
                      delete nextErrors[field.key];
                      return nextErrors;
                    });
                  }}
                />
                {field.help_text ? <FieldDescription>{field.help_text}</FieldDescription> : null}
                <FieldError>{error}</FieldError>
              </Field>
            );
          })}
        </FieldGroup>
      </FormSection>
    </form>
  );
}

export default function CustomModuleRecordDetailPage() {
  const params = useParams<{ moduleKey: string; recordId: string }>();
  const router = useRouter();
  const { confirm } = useConfirm();
  const moduleKey = params.moduleKey;
  const recordId = params.recordId;
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const schema = useCustomModuleSchema(moduleKey);
  const accessibleModule = modules.find((module) => module.id === schema.data?.module_id);
  const canEdit = Boolean(accessibleModule?.actions?.can_edit);
  const canDelete = Boolean(accessibleModule?.actions?.can_delete);
  const recordQuery = useCustomModuleRecord(moduleKey, recordId);
  const moduleFields = useModuleFieldConfigs(moduleKey);
  const enabledFieldKeys = useMemo(
    () => new Map(moduleFields.fields.map((field) => [field.field_key, field.is_protected || field.is_enabled])),
    [moduleFields.fields],
  );
  const fields = useMemo(
    () => (schema.data?.fields ?? [])
      .filter((field) => field.is_active && (enabledFieldKeys.get(field.key) ?? true))
      .sort((a, b) => a.sort_order - b.sort_order),
    [enabledFieldKeys, schema.data],
  );
  const backHref = `/dashboard/custom/${moduleKey}`;
  const description = schema.data?.name ? `${schema.data.name} record` : "Custom module record";

  async function handleDelete() {
    if (!canDelete || !recordQuery.record) return;
    const confirmed = await confirm({
      title: "Delete record?",
      description: `Move "${recordQuery.record.title}" to the Recycle Bin? An administrator can restore it later.`,
      confirmLabel: "Move to Recycle Bin",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      await recordQuery.deleteRecord();
      toast.success("Record moved to the Recycle Bin.");
      router.push(backHref);
    } catch {
      toast.error("We could not delete this record. Try again.");
    }
  }

  if (modulesLoading || schema.isLoading || recordQuery.isLoading || moduleFields.isLoading) {
    return <RouteLoadingState label="custom module record" />;
  }

  if (!accessibleModule?.actions?.can_view) {
    return <PermissionDeniedState />;
  }

  if (
    (schema.error instanceof Error && schema.error.message === "not-found") ||
    (recordQuery.error instanceof Error && recordQuery.error.message === "not-found")
  ) {
    return <RouteNotFoundState recordLabel="Record" backHref={backHref} backLabel="Back to records" />;
  }

  if (schema.error || recordQuery.error || moduleFields.error || !schema.data) {
    return (
      <RouteErrorState
        title="Unable to load this record"
        description="The record or its module configuration could not be loaded. Try again or return to the record list."
        reset={() => void Promise.all([schema.refetch(), recordQuery.refresh(), moduleFields.refresh()])}
        backHref={backHref}
        backLabel="Back to records"
      />
    );
  }

  if (!recordQuery.record) {
    return <RouteNotFoundState recordLabel="Record" backHref={backHref} backLabel="Back to records" />;
  }

  const record = recordQuery.record;

  return (
    <PageShell
      title={record.title}
      description={description}
    >
      <RecordPageHeader
        backHref={backHref}
        backLabel="Back to records"
        primaryAction={
          <>
            {canDelete ? (
              <Button
                type="button"
                variant="destructiveGhost"
                onClick={() => void handleDelete()}
                disabled={recordQuery.isDeleting}
              >
                <Trash2 />
                {recordQuery.isDeleting ? "Deleting…" : "Delete"}
              </Button>
            ) : null}
            {canEdit ? (
              <Button type="submit" form="custom-module-record-form" disabled={recordQuery.isSaving}>
                <Save />
                {recordQuery.isSaving ? "Saving…" : "Save"}
              </Button>
            ) : null}
          </>
        }
      />

      <RecordTabs
        tabs={[
          {
            id: "overview",
            label: "Overview",
            content: (
              <CustomModuleRecordOverview
                key={`${record.id}:${record.updated_at ?? ""}`}
                fields={fields}
                record={record}
                canEdit={canEdit}
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
    </PageShell>
  );
}
