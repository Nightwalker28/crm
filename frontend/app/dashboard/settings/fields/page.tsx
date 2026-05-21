"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { getModuleDisplayName } from "@/lib/module-display";
import {
  CUSTOM_FIELD_SUPPORTED_MODULES,
  MODULE_VIEW_DEFINITIONS,
  getCustomFieldColumnKey,
  getModuleViewDefinition,
} from "@/lib/moduleViewConfigs";
import { isProtectedFieldKey, useModuleFieldConfigs, type ModuleFieldSource } from "@/hooks/useModuleFieldConfigs";
import type { CustomFieldDefinition } from "@/hooks/useModuleCustomFields";
import { useModuleBuilder, type CustomModuleDefinition, type CustomModuleField } from "@/hooks/useModuleBuilder";

const FIELD_TYPE_OPTIONS: Array<CustomFieldDefinition["field_type"]> = ["text", "long_text", "number", "date", "boolean"];

type DraftField = {
  field_key: string;
  label: string;
  field_type: CustomFieldDefinition["field_type"];
  placeholder: string;
  help_text: string;
  is_required: boolean;
};

type FieldCatalogItem = {
  field_key: string;
  label: string;
  field_type?: string | null;
  field_source: ModuleFieldSource;
  sort_order: number;
  is_enabled: boolean;
  is_protected: boolean;
  custom_field_id?: number;
  custom_module_field?: CustomModuleField;
  custom_module_id?: number;
};

const emptyDraft: DraftField = {
  field_key: "",
  label: "",
  field_type: "text",
  placeholder: "",
  help_text: "",
  is_required: false,
};

function makeFieldKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function fetchAdminCustomFields(moduleKey: string): Promise<CustomFieldDefinition[]> {
  const res = await apiFetch(`/admin/custom-fields/${moduleKey}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
  return res.json();
}

function fieldSourceLabel(source: ModuleFieldSource) {
  if (source === "custom_field") return "custom";
  if (source === "custom_module") return "module builder";
  return "system";
}

function buildSystemCatalog(moduleKey: string): FieldCatalogItem[] {
  const definition = getModuleViewDefinition(moduleKey);
  if (!definition) return [];
  const filterTypes = new Map(definition.filterFields.map((field) => [field.key, field.type]));
  return definition.columns.map((column, index) => ({
    field_key: column.key,
    label: column.label,
    field_type: filterTypes.get(column.key) ?? "text",
    field_source: "system",
    sort_order: index,
    is_enabled: true,
    is_protected: isProtectedFieldKey(column.key, moduleKey),
  }));
}

function buildCustomFieldCatalog(moduleKey: string, fields: CustomFieldDefinition[], offset: number): FieldCatalogItem[] {
  return fields.map((field, index) => {
    const fieldKey = getCustomFieldColumnKey(field.field_key);
    return {
      field_key: fieldKey,
      label: field.label,
      field_type: field.field_type,
      field_source: "custom_field",
      sort_order: offset + index,
      is_enabled: field.is_active,
      is_protected: isProtectedFieldKey(fieldKey, moduleKey),
      custom_field_id: field.id,
    };
  });
}

function buildCustomModuleCatalog(module: CustomModuleDefinition | null): FieldCatalogItem[] {
  if (!module) return [];
  return module.fields.map((field, index) => ({
    field_key: field.key,
    label: field.label,
    field_type: field.field_type,
    field_source: "custom_module",
    sort_order: field.sort_order ?? index,
    is_enabled: field.is_active,
    is_protected: field.is_protected || isProtectedFieldKey(field.key, module.key),
    custom_module_id: module.id,
    custom_module_field: field,
  }));
}

export default function FieldsPage() {
  const queryClient = useQueryClient();
  const { modules: customModules, updateField: updateCustomModuleField, isSaving: isSavingCustomModule } = useModuleBuilder();
  const builtInOptions = useMemo(
    () => Object.values(MODULE_VIEW_DEFINITIONS).map((definition) => ({ key: definition.key, label: definition.label })),
    [],
  );
  const moduleOptions = useMemo(
    () => [
      ...builtInOptions,
      ...customModules
        .filter((module) => !module.deleted_at)
        .map((module) => ({ key: module.key, label: module.display_name ?? getModuleDisplayName(module.key, module.name) })),
    ],
    [builtInOptions, customModules],
  );
  const [moduleKey, setModuleKey] = useState("sales_contacts");
  const [draft, setDraft] = useState<DraftField>(emptyDraft);
  const [fieldKeyEdited, setFieldKeyEdited] = useState(false);
  const selectedCustomModule = customModules.find((module) => module.key === moduleKey && !module.deleted_at) ?? null;
  const supportsCustomFields = CUSTOM_FIELD_SUPPORTED_MODULES.has(moduleKey);
  const { fields: moduleFieldConfigs, updateField: updateModuleField, isSaving: isSavingModuleFields } = useModuleFieldConfigs(moduleKey, true);

  const customFieldsQuery = useQuery({
    queryKey: ["admin-custom-fields", moduleKey],
    queryFn: () => fetchAdminCustomFields(moduleKey),
    enabled: supportsCustomFields,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/admin/custom-fields/${moduleKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      return body as CustomFieldDefinition;
    },
    onSuccess: async () => {
      setDraft(emptyDraft);
      setFieldKeyEdited(false);
      await Promise.all([
        customFieldsQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["custom-fields", moduleKey] }),
      ]);
      toast.success("Custom field created.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create custom field.");
    },
  });

  const updateCustomFieldMutation = useMutation({
    mutationFn: async ({ fieldId, payload }: { fieldId: number; payload: Partial<CustomFieldDefinition> }) => {
      const res = await apiFetch(`/admin/custom-fields/${fieldId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      return body as CustomFieldDefinition;
    },
    onSuccess: async () => {
      await Promise.all([
        customFieldsQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["custom-fields", moduleKey] }),
      ]);
    },
  });

  const catalog = useMemo(() => {
    const base = selectedCustomModule
      ? buildCustomModuleCatalog(selectedCustomModule)
      : [
          ...buildSystemCatalog(moduleKey),
          ...buildCustomFieldCatalog(moduleKey, customFieldsQuery.data ?? [], buildSystemCatalog(moduleKey).length),
        ];
    const configMap = new Map(moduleFieldConfigs.map((config) => [config.field_key, config]));
    return base
      .map((field) => {
        const config = configMap.get(field.field_key);
        const isProtected = field.is_protected || config?.is_protected || isProtectedFieldKey(field.field_key, moduleKey);
        return {
          ...field,
          label: config?.label ?? field.label,
          is_enabled: isProtected ? true : (config?.is_enabled ?? field.is_enabled),
          is_protected: isProtected,
        };
      })
      .sort((left, right) => left.sort_order - right.sort_order || left.label.localeCompare(right.label));
  }, [customFieldsQuery.data, moduleFieldConfigs, moduleKey, selectedCustomModule]);

  function handleLabelChange(value: string) {
    setDraft((current) => ({
      ...current,
      label: value,
      field_key: fieldKeyEdited ? current.field_key : makeFieldKey(value),
    }));
  }

  function handleFieldKeyChange(value: string) {
    setFieldKeyEdited(true);
    setDraft((current) => ({ ...current, field_key: makeFieldKey(value) }));
  }

  function handleModuleChange(nextModuleKey: string) {
    setModuleKey(nextModuleKey);
    setDraft(emptyDraft);
    setFieldKeyEdited(false);
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.field_key.trim() || !draft.label.trim() || createMutation.isPending || !supportsCustomFields) return;
    createMutation.mutate();
  }

  async function toggleField(field: FieldCatalogItem) {
    if (field.is_protected) return;
    const nextEnabled = !field.is_enabled;
    try {
      await updateModuleField({
        fieldKey: field.field_key,
        payload: {
          label: field.label,
          field_type: field.field_type ?? null,
          field_source: field.field_source,
          is_enabled: nextEnabled,
          is_protected: field.is_protected,
          sort_order: field.sort_order,
        },
      });
      if (field.field_source === "custom_field" && field.custom_field_id) {
        await updateCustomFieldMutation.mutateAsync({
          fieldId: field.custom_field_id,
          payload: { is_active: nextEnabled },
        });
      }
      if (field.field_source === "custom_module" && field.custom_module_id && field.custom_module_field) {
        await updateCustomModuleField({
          moduleId: field.custom_module_id,
          fieldId: field.custom_module_field.id,
          payload: { is_active: nextEnabled },
        });
      }
      toast.success(nextEnabled ? "Field enabled." : "Field disabled.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update field.");
    }
  }

  const canCreate = supportsCustomFields && Boolean(draft.field_key.trim() && draft.label.trim()) && !createMutation.isPending;

  return (
    <div className="flex flex-col gap-5 text-neutral-200">
      <PageHeader
        title="Field Config"
        description="Enable or disable fields for each module. Protected identifiers stay locked so records keep working."
        actions={
          <Select value={moduleKey} onValueChange={handleModuleChange}>
            <SelectTrigger className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {moduleOptions.map((moduleName) => (
                <SelectItem key={moduleName.key} value={moduleName.key}>
                  {moduleName.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <Card className="px-5 py-5">
          <h2 className="text-lg font-semibold text-neutral-100">Add Custom Field</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Add fields to supported built-in modules. Custom module fields are added from Module Builder.
          </p>

          <form className="mt-4 grid gap-4" onSubmit={handleCreate}>
            <Field>
              <FieldLabel>Label <RequiredMark /></FieldLabel>
              <Input value={draft.label} onChange={(event) => handleLabelChange(event.target.value)} placeholder="Contract Term" disabled={!supportsCustomFields} />
            </Field>
            <Field>
              <FieldLabel>Field Key <RequiredMark /></FieldLabel>
              <Input value={draft.field_key} onChange={(event) => handleFieldKeyChange(event.target.value)} placeholder="contract_term" disabled={!supportsCustomFields} />
              <FieldDescription>Auto-generated from the label unless edited.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Field Type</FieldLabel>
              <Select
                value={draft.field_type}
                onValueChange={(value) => setDraft((current) => ({ ...current, field_type: value as DraftField["field_type"] }))}
                disabled={!supportsCustomFields}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Placeholder</FieldLabel>
              <Input value={draft.placeholder} onChange={(event) => setDraft((current) => ({ ...current, placeholder: event.target.value }))} disabled={!supportsCustomFields} />
            </Field>
            <Field>
              <FieldLabel>Help Text</FieldLabel>
              <Input value={draft.help_text} onChange={(event) => setDraft((current) => ({ ...current, help_text: event.target.value }))} disabled={!supportsCustomFields} />
            </Field>
            <Field>
              <FieldLabel>Required</FieldLabel>
              <div className="flex items-center gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2">
                <Checkbox
                  checked={draft.is_required}
                  onCheckedChange={(checked) => setDraft((current) => ({ ...current, is_required: checked === true }))}
                  disabled={!supportsCustomFields}
                  className="h-4 w-4 rounded border border-neutral-700 bg-neutral-900"
                >
                  <CheckboxIndicator className="h-3 w-3" />
                </Checkbox>
                <span className="text-sm text-neutral-300">Require this value on save</span>
              </div>
            </Field>

            <Button type="submit" disabled={!canCreate}>
              <Plus className="h-4 w-4" />
              {createMutation.isPending ? "Creating..." : "Create Field"}
            </Button>
            {!supportsCustomFields ? (
              <p className="text-sm text-neutral-500">This module does not support adding fields here, but its existing fields can still be enabled or disabled.</p>
            ) : null}
          </form>
        </Card>

        <Card className="overflow-hidden px-0 py-0">
          <div className="border-b border-neutral-800 px-5 py-4">
            <h2 className="text-lg font-semibold text-neutral-100">Module Fields</h2>
            <p className="mt-1 text-sm text-neutral-500">Disabled fields are removed from module columns, saved-view column choices, and filters.</p>
          </div>

          {customFieldsQuery.isLoading ? (
            <div className="px-5 py-5 text-sm text-neutral-500">Loading fields...</div>
          ) : !catalog.length ? (
            <div className="px-5 py-8">
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-800 bg-neutral-950/50 px-6 py-10 text-center">
                <Sparkles className="h-8 w-8 text-neutral-600" />
                <div className="mt-3 text-sm font-medium text-neutral-200">No fields found</div>
                <div className="mt-1 text-sm text-neutral-500">Select another module or add a field where supported.</div>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-neutral-800">
              {catalog.map((field) => (
                <div key={field.field_key} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-neutral-100">{field.label}</div>
                      {field.is_protected ? <Lock className="h-3.5 w-3.5 text-neutral-500" aria-label="Protected field" /> : null}
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {field.field_key} · {field.field_type ?? "field"} · {fieldSourceLabel(field.field_source)}
                      {field.is_enabled ? " · enabled" : " · disabled"}
                      {field.is_protected ? " · protected" : ""}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => void toggleField(field)}
                    disabled={field.is_protected || isSavingModuleFields || updateCustomFieldMutation.isPending || isSavingCustomModule}
                  >
                    {field.is_enabled ? "Disable" : "Enable"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
