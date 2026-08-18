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
import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import {
  useCreateCustomModuleRecord,
  useCustomModuleSchema,
  type CustomModuleField,
} from "@/hooks/useModuleBuilder";

function isMissingRequiredValue(field: CustomModuleField, value: unknown) {
  if (!field.is_required || field.field_type === "boolean") return false;
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

export default function CustomModuleRecordCreatePage({ moduleKey }: { moduleKey: string }) {
  const schema = useCustomModuleSchema(moduleKey);
  const moduleFields = useModuleFieldConfigs(moduleKey);
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const accessibleModule = modules.find((module) => module.id === schema.data?.module_id);
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

  if (modulesLoading || schema.isLoading || moduleFields.isLoading) {
    return <RouteLoadingState label="custom module record form" />;
  }

  if (!accessibleModule?.actions?.can_create) {
    return <PermissionDeniedState />;
  }

  if (schema.error || moduleFields.error || !schema.data) {
    return (
      <RouteErrorState
        title="Unable to prepare this record"
        description="The module configuration could not be loaded. Try again or return to the record list."
        reset={() => void Promise.all([schema.refetch(), moduleFields.refresh()])}
        backHref={`/dashboard/custom/${moduleKey}`}
        backLabel="Back to records"
      />
    );
  }

  if (!fields.length) {
    return (
      <EmptyState
        title="No fields are available"
        description="An administrator must configure at least one active field before records can be created."
        action={
          <Button asChild variant="outline">
            <Link href={`/dashboard/custom/${moduleKey}`}>Back to records</Link>
          </Button>
        }
      />
    );
  }

  return (
    <CustomModuleRecordCreateEditor
      key={`${schema.data.id}:${fields.map((field) => `${field.id}:${field.sort_order}`).join(",")}`}
      moduleKey={moduleKey}
      moduleName={schema.data.name}
      moduleDescription={schema.data.description}
      fields={fields}
    />
  );
}

function CustomModuleRecordCreateEditor({
  moduleKey,
  moduleName,
  moduleDescription,
  fields,
}: {
  moduleKey: string;
  moduleName: string;
  moduleDescription?: string | null;
  fields: CustomModuleField[];
}) {
  const router = useRouter();
  const { createRecord, isSaving } = useCreateCustomModuleRecord(moduleKey);
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    getInitialCustomModuleValues(fields),
  );
  const [initialSnapshot] = useState(() =>
    JSON.stringify(["", getInitialCustomModuleValues(fields)]),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState(false);
  const currentSnapshot = useMemo(() => JSON.stringify([title, values]), [title, values]);
  const isDirty = currentSnapshot !== initialSnapshot;
  const backHref = `/dashboard/custom/${moduleKey}`;
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
      const record = await createRecord({
        title: title.trim() || undefined,
        values,
      });
      toast.success("Record created.");
      router.push(`/dashboard/custom/${moduleKey}/${record.id}`);
    } catch {
      setSubmitError(true);
    }
  }

  return (
    <PageShell
      title="Create record"
      eyebrow={moduleName}
      description={`Add a record using the fields configured for ${moduleName}.`}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}>
            <ArrowLeft />
            Back to records
          </Link>
        </Button>
      }
    >
      {submitError ? (
        <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          <div className="font-medium">We could not create this record.</div>
          <div className="mt-1 text-copy-secondary">Review the fields and try again.</div>
        </div>
      ) : null}

      {/* The field inputs carry the native required attribute, so without noValidate the
          browser blocks submit and validateRequiredFields never runs: the form's own message
          and focus handling would never be reached. */}
      <form id="custom-module-create-form" onSubmit={handleSubmit} noValidate>
        <RecordFormLayout
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
          footer={
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-copy-muted">
                {isDirty ? "You have unsaved changes." : "Complete the configured fields to create this record."}
              </span>
              <div className="flex items-center gap-2">
                <Button asChild variant="outline">
                  <Link href={backHref}>Cancel</Link>
                </Button>
                <Button type="submit" disabled={isSaving}>
                  <Save />
                  {isSaving ? "Creating…" : "Create record"}
                </Button>
              </div>
            </div>
          }
        >
          <FormSection
            title="Record details"
            description="Required fields are controlled by the current module configuration."
          >
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="custom-record-title">Record title</FieldLabel>
                <Input
                  id="custom-record-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Record title"
                />
                <FieldDescription>
                  Optional. When omitted, the module derives a title from configured name or title fields.
                </FieldDescription>
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
