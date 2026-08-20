"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  CustomModuleFieldInput,
  getInitialCustomModuleValues,
} from "@/components/customModules/CustomModuleFieldInput";
import { FormErrorBanner } from "@/components/forms/FormErrorBanner";
import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { useRecordTabHref } from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { RouteErrorState, RouteLoadingState, RouteNotFoundState } from "@/components/ui/RouteStates";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
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

/**
 * `/dashboard/custom/[moduleKey]/[recordId]/edit` — archetype 3, and the other half of
 * rebuilding the custom record page onto archetype 2.
 *
 * The detail page used to *be* this form, with `Save` in its header and four tabs above it
 * (three of them empty states). R2 sends a record's content fields to `/[id]/edit`, so this
 * route had to exist before the detail page could stop being a form — every other module in
 * batch 4 already had one. It is deliberately the create page with a loaded record behind it:
 * same layout, same validation, same guard.
 */
export default function CustomModuleRecordEditPage({
  moduleKey,
  recordId,
}: {
  moduleKey: string;
  recordId: string;
}) {
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const schema = useCustomModuleSchema(moduleKey);
  const recordQuery = useCustomModuleRecord(moduleKey, recordId);
  const moduleFields = useModuleFieldConfigs(moduleKey);
  const accessibleModule = modules.find((module) => module.id === schema.data?.module_id);
  const listHref = `/dashboard/custom/${moduleKey}`;

  const enabledFieldKeys = useMemo(
    () => new Map(moduleFields.fields.map((field) => [field.field_key, field.is_protected || field.is_enabled])),
    [moduleFields.fields],
  );
  const fields = useMemo(
    () =>
      (schema.data?.fields ?? [])
        .filter((field) => field.is_active && (enabledFieldKeys.get(field.key) ?? true))
        .sort((a, b) => a.sort_order - b.sort_order),
    [enabledFieldKeys, schema.data],
  );

  if (modulesLoading || schema.isLoading || recordQuery.isLoading || moduleFields.isLoading) {
    return <RouteLoadingState label="custom module record" />;
  }

  if (!accessibleModule?.actions?.can_edit) {
    return <PermissionDeniedState />;
  }

  if (
    (schema.error instanceof Error && schema.error.message === "not-found") ||
    (recordQuery.error instanceof Error && recordQuery.error.message === "not-found")
  ) {
    return <RouteNotFoundState recordLabel="Record" backHref={listHref} backLabel="Back to records" />;
  }

  if (schema.error || recordQuery.error || moduleFields.error || !schema.data) {
    return (
      <RouteErrorState
        title="Unable to load this record"
        description="The record or its module configuration could not be loaded. Try again or return to the record list."
        reset={() => void Promise.all([schema.refetch(), recordQuery.refresh(), moduleFields.refresh()])}
        backHref={listHref}
        backLabel="Back to records"
      />
    );
  }

  if (!recordQuery.record) {
    return <RouteNotFoundState recordLabel="Record" backHref={listHref} backLabel="Back to records" />;
  }

  if (!fields.length) {
    return (
      <EmptyState
        title="No fields are available"
        description="An administrator must configure at least one active field before records can be edited."
        action={
          <Button asChild variant="outline">
            <Link href={listHref}>Back to records</Link>
          </Button>
        }
      />
    );
  }

  return (
    <CustomModuleRecordEditor
      key={`${recordQuery.record.id}:${recordQuery.record.updated_at ?? ""}`}
      moduleKey={moduleKey}
      moduleName={schema.data.name}
      moduleDescription={schema.data.description}
      fields={fields}
      record={recordQuery.record}
      isSaving={recordQuery.isSaving}
      onSave={recordQuery.updateRecord}
    />
  );
}

function CustomModuleRecordEditor({
  moduleKey,
  moduleName,
  moduleDescription,
  fields,
  record,
  isSaving,
  onSave,
}: {
  moduleKey: string;
  moduleName: string;
  moduleDescription?: string | null;
  fields: CustomModuleField[];
  record: CustomModuleRecord;
  isSaving: boolean;
  onSave: (payload: { title?: string; values: Record<string, unknown> }) => Promise<CustomModuleRecord>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(record.title);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    getInitialCustomModuleValues(fields, record),
  );
  const [initialSnapshot] = useState(() =>
    JSON.stringify([record.title, getInitialCustomModuleValues(fields, record)]),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState(false);
  const currentSnapshot = useMemo(() => JSON.stringify([title, values]), [title, values]);
  const isDirty = currentSnapshot !== initialSnapshot;
  // R2's round trip: editing from the record's Files tab returns to Files.
  const recordHref = useRecordTabHref(`/dashboard/custom/${moduleKey}/${record.id}`);
  const requiredCount = fields.filter((field) => field.is_required).length;

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
    if (!validateRequiredFields()) return;
    setSubmitError(false);
    try {
      await onSave({ title: title.trim() || record.title, values });
      toast.success("Record saved.");
      router.push(recordHref);
    } catch {
      setSubmitError(true);
    }
  }

  return (
    <PageShell
      title="Edit record"
      eyebrow={moduleName}
      description={`Update this record using the fields configured for ${moduleName}.`}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href={recordHref}>
            <ArrowLeft />
            Back to record
          </Link>
        </Button>
      }
    >
      {submitError ? (
        <FormErrorBanner title="We could not save this record.">Review the fields and try again.</FormErrorBanner>
      ) : null}

      {/* The field inputs carry the native required attribute, so without noValidate the
          browser blocks submit and validateRequiredFields never runs. */}
      <form id="custom-module-record-form" onSubmit={handleSubmit} noValidate>
        <RecordFormLayout
          title={title.trim() || record.title || "Record"}
          sidebar={
            <FormSection title="Module context" description="This record uses your tenant-configured module schema.">
              <dl className="grid gap-4 text-sm">
                <div>
                  <dt className="text-copy-muted">Module</dt>
                  <dd className="mt-1 font-medium text-copy-primary">{moduleName}</dd>
                </div>
                {moduleDescription ? (
                  <div>
                    <dt className="text-copy-muted">Description</dt>
                    <dd className="mt-1 leading-6 text-copy-secondary">{moduleDescription}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-copy-muted">Configured fields</dt>
                  <dd className="mt-1 text-copy-primary">{fields.length}</dd>
                </div>
                <div>
                  <dt className="text-copy-muted">Required fields</dt>
                  <dd className="mt-1 text-copy-primary">{requiredCount}</dd>
                </div>
              </dl>
            </FormSection>
          }
          status={isDirty ? "Unsaved changes" : "No unsaved changes"}
          actions={(
            <>
              <Button asChild variant="outline">
                <Link href={recordHref}>Cancel</Link>
              </Button>
              <Button type="submit" disabled={isSaving}>
                <Save />
                {isSaving ? "Saving…" : "Save record"}
              </Button>
            </>
          )}
        >
          <FormSection
            title="Record details"
            description="Required fields are controlled by the current module configuration."
          >
            <FieldGroup columns={2}>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="custom-record-title">Record title</FieldLabel>
                <Input
                  id="custom-record-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
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
        </RecordFormLayout>
      </form>
    </PageShell>
  );
}
