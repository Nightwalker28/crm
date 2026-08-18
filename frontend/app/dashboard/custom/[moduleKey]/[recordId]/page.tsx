"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ReadOnlyFieldSection } from "@/components/forms/ReadOnlyRecordLayout";
import {
  RecordWorkspace,
  recordEditHref,
} from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineFieldEdit, type InlineFieldEditOption } from "@/components/ui/InlineFieldEdit";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
import {
  RecordSpine,
  RecordSpineBlock,
  RecordSpineField,
  RecordSpineMeta,
} from "@/components/ui/RecordSpine";
import { RouteNotFoundState } from "@/components/ui/RouteStates";
import { StatusValue } from "@/components/ui/StatusValue";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import {
  useCustomModuleRecord,
  useCustomModuleSchema,
  type CustomModuleField,
  type CustomModuleRecord,
} from "@/hooks/useModuleBuilder";
import { formatDateTime } from "@/lib/datetime";

/**
 * The field types the rail edits (design.md §4.7).
 *
 * `single_select` is R2's shape rule read literally, and `boolean` is the two-value closed
 * set the same rule covers once you read it as "a set the operator picks from" — the catalog
 * record's `Active` / `Inactive` in a tenant-defined form. Everything else is content and
 * lives read-only in `Details` until `/[id]/edit`.
 */
const STATE_FIELD_TYPES = new Set(["single_select", "boolean"]);

const BOOLEAN_OPTIONS: InlineFieldEditOption[] = [
  { value: "true", tone: null, label: "Yes" },
  { value: "false", tone: null, label: "No" },
];

function selectOptions(field: CustomModuleField): InlineFieldEditOption[] {
  if (field.field_type === "boolean") return BOOLEAN_OPTIONS;
  // A tenant's option list is a category, never a status: nothing here can be classified as
  // an outcome or a deviation from the outside, so no value takes a tone (R5).
  return (field.validation_json?.options ?? []).map((option) => ({
    value: option,
    tone: null,
    label: option,
  }));
}

function currentValue(field: CustomModuleField, values: Record<string, unknown>): string {
  const raw = values[field.key];
  if (field.field_type === "boolean") return String(raw === true);
  return raw == null ? "" : String(raw);
}

export default function CustomModuleRecordDetailPage() {
  const params = useParams<{ moduleKey: string; recordId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { confirm } = useConfirm();
  const moduleKey = params.moduleKey;
  const recordId = params.recordId;
  const activeTab = searchParams.get("tab");

  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const schema = useCustomModuleSchema(moduleKey);
  const recordQuery = useCustomModuleRecord(moduleKey, recordId);
  const moduleFields = useModuleFieldConfigs(moduleKey);
  const accessibleModule = modules.find((module) => module.id === schema.data?.module_id);
  const canEdit = Boolean(accessibleModule?.actions?.can_edit);
  const canDelete = Boolean(accessibleModule?.actions?.can_delete);

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
  const stateFields = fields.filter((field) => STATE_FIELD_TYPES.has(field.field_type));
  const contentFields = fields.filter((field) => !STATE_FIELD_TYPES.has(field.field_type));

  const record = recordQuery.record;
  const backHref = `/dashboard/custom/${moduleKey}`;
  const recordHref = `${backHref}/${recordId}`;
  const notFound =
    (schema.error instanceof Error && schema.error.message === "not-found") ||
    (recordQuery.error instanceof Error && recordQuery.error.message === "not-found") ||
    (!recordQuery.isLoading && !recordQuery.error && !record);
  const hasError = Boolean(schema.error || recordQuery.error || moduleFields.error) || notFound;

  async function commitStateField(field: CustomModuleField, next: InlineFieldEditOption) {
    const value = field.field_type === "boolean" ? next.value === "true" : next.value;
    await recordQuery.updateRecord({ values: { [field.key]: value } });
  }

  async function handleDelete() {
    if (!record) return;
    const confirmed = await confirm({
      title: "Delete record?",
      description: `Move "${record.title}" to the Recycle Bin? An administrator can restore it later.`,
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

  if (!modulesLoading && !schema.isLoading && schema.data && !accessibleModule?.actions?.can_view) {
    return <PermissionDeniedState />;
  }

  return (
    <RecordWorkspace
      title={record?.title ?? "Record"}
      description={schema.data?.name ? `${schema.data.name} record` : "Custom module record"}
      backHref={backHref}
      backLabel="Records"
      isLoading={modulesLoading || schema.isLoading || recordQuery.isLoading || moduleFields.isLoading}
      hasError={hasError}
      onRetry={() => void Promise.all([schema.refetch(), recordQuery.refresh(), moduleFields.refresh()])}
      errorState={notFound ? (
        <RouteNotFoundState
          titleAs="p"
          recordLabel="Record"
          backHref={backHref}
          backLabel="Back to records"
        />
      ) : undefined}
      subtitle={schema.data ? <span>{schema.data.name}</span> : null}
      /*
       * No filled button: a custom module has no workflow the product knows about, so there
       * is no primary action to spend §2.2's one fill on. Delete is destructive and goes to
       * the overflow, which is what keeps it from setting a second fill beside `Edit`.
       */
      actions={record && canEdit ? (
        <Button asChild variant="outline">
          <Link href={recordEditHref(`${recordHref}/edit`, activeTab)}>
            <Pencil />
            Edit
          </Link>
        </Button>
      ) : null}
      overflowActions={record && canDelete ? (
        <DropdownMenuItem
          // Radix closes the menu on select and would steal focus from the confirmation the
          // handler is about to open, so the close is prevented and the dialog owns focus.
          onSelect={(event) => {
            event.preventDefault();
            void handleDelete();
          }}
          disabled={recordQuery.isDeleting}
          className="text-state-danger focus:bg-state-danger-muted focus:text-state-danger"
        >
          <Trash2 />
          {recordQuery.isDeleting ? "Deleting…" : "Delete record"}
        </DropdownMenuItem>
      ) : null}
      spine={
        <RecordSpine>
          {record ? (
            <>
              {/*
                No `Connected` block: a custom module's field types are all scalars, so the
                schema has no relationship to draw and a heading over nothing would promise a
                link the data model does not have (§4.7).
              */}
              {stateFields.length ? (
                <RecordSpineBlock title="State">
                  {stateFields.map((field) => (
                    <RecordSpineField key={field.id} label={field.label}>
                      {canEdit ? (
                        <InlineFieldEdit
                          fieldLabel={field.label}
                          value={currentValue(field, record.values)}
                          options={selectOptions(field)}
                          onCommit={(next) => commitStateField(field, next)}
                        />
                      ) : (
                        <StatusValue
                          status={{
                            tone: null,
                            label:
                              selectOptions(field).find(
                                (option) => option.value === currentValue(field, record.values),
                              )?.label ?? "—",
                          }}
                          context="record"
                        />
                      )}
                    </RecordSpineField>
                  ))}
                </RecordSpineBlock>
              ) : null}

              {/*
                No History sheet. `activity_logs` is written for custom module records, but
                `/activity/record` gates on `TIMELINE_ALLOWED_MODULES` and a tenant-defined key
                is not in it — opening that up is the deferred user-created-modules slice, not
                a migration's call. The same is why there is no Timeline, Tasks or Files tab:
                `RECORD_COMMENT_MODULES` is what those three resolve a record through.
              */}
              <RecordSpineMeta
                createdLabel={record.created_at ? `Created ${formatDateTime(record.created_at)}` : undefined}
                updatedLabel={record.updated_at ? `Updated ${formatDateTime(record.updated_at)}` : undefined}
              />
            </>
          ) : null}
        </RecordSpine>
      }
      details={record ? (
        <CustomRecordOverview record={record} fields={contentFields} canEdit={canEdit} />
      ) : null}
    />
  );
}

/**
 * `Details` for a record with no server-side layout.
 *
 * `record_layouts.py` describes modules the product ships; a custom module's schema is the
 * tenant's, so there is nothing to resolve. It still renders through `ReadOnlyField` rather
 * than a private grid — the field renderer is the shared one, only the section it sits in is
 * built from the module schema instead of a layout.
 */
function CustomRecordOverview({
  record,
  fields,
  canEdit,
}: {
  record: CustomModuleRecord;
  fields: CustomModuleField[];
  canEdit: boolean;
}) {
  if (!fields.length) {
    return (
      <EmptyState
        title="No fields to show"
        description={
          canEdit
            ? "Every configured field on this module is a state field, and those are in the rail."
            : "An administrator has not configured any fields you can view on this module."
        }
      />
    );
  }

  return (
    <ReadOnlyFieldSection
      title="Record details"
      fields={fields.map((field) => ({
        key: field.key,
        label: field.label,
        fieldType: field.field_type,
        value: record.values[field.key],
        width: field.field_type === "textarea" || field.field_type === "multi_select" ? "full" : "half",
      }))}
    />
  );
}
