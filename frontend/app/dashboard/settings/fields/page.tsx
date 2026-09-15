"use client";

import { useMemo, useState } from "react";
import { Filter, Lock, Plus, Sparkles } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ActionBar } from "@/components/ui/ActionBar";
import { Chip } from "@/components/ui/Chip";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { EmptyValue } from "@/components/ui/EmptyValue";
import { StatusValue } from "@/components/ui/StatusValue";
import { SegmentedBoolean, SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { RequiredMark } from "@/components/ui/RequiredMark";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isProtectedFieldKey, useModuleFieldConfigs, type ModuleFieldSource } from "@/hooks/useModuleFieldConfigs";
import type { CustomFieldDefinition } from "@/hooks/useModuleCustomFields";
import { useModuleBuilder, type CustomModuleDefinition, type CustomModuleField } from "@/hooks/useModuleBuilder";
import { useConfirm } from "@/hooks/useConfirm";
import { usePageAddress } from "@/hooks/usePageAddress";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { ApiError, apiFetch, isForbiddenError } from "@/lib/api";
import { SETTINGS_ROUTES } from "@/lib/routes";
import { formatSnakeCaseLabel, getModuleDisplayName } from "@/lib/module-display";
import {
  CUSTOM_FIELD_SUPPORTED_MODULES,
  MODULE_VIEW_DEFINITIONS,
  getCustomFieldColumnKey,
  getModuleViewDefinition,
} from "@/lib/moduleViewConfigs";

const FIELD_TYPE_OPTIONS: Array<CustomFieldDefinition["field_type"]> = ["text", "long_text", "number", "date", "boolean"];
const FILTERS = ["all", "system", "custom", "required", "disabled"] as const;

type FieldFilter = typeof FILTERS[number];
type PanelMode = "create" | "inspect";

type DraftField = {
  field_key: string;
  label: string;
  field_type: CustomFieldDefinition["field_type"];
  placeholder: string;
  help_text: string;
  is_required: boolean;
};

type InspectorDraft = {
  label: string;
  placeholder: string;
  help_text: string;
  is_required: boolean;
  is_enabled: boolean;
};

type FieldCatalogItem = {
  field_key: string;
  label: string;
  field_type?: string | null;
  field_source: ModuleFieldSource;
  sort_order: number;
  is_enabled: boolean;
  is_required: boolean;
  is_protected: boolean;
  placeholder?: string | null;
  help_text?: string | null;
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

const emptyInspectorDraft: InspectorDraft = {
  label: "",
  placeholder: "",
  help_text: "",
  is_required: false,
  is_enabled: true,
};

function makeFieldKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function friendlyFieldType(value?: string | null) {
  return (value || "field").replaceAll("_", " ");
}

function fieldSourceLabel(source: ModuleFieldSource) {
  if (source === "custom_field") return "Custom";
  if (source === "custom_module") return "Module builder";
  return "System";
}

function inspectorFromField(field: FieldCatalogItem | null): InspectorDraft {
  if (!field) return emptyInspectorDraft;
  return {
    label: field.label,
    placeholder: field.placeholder ?? "",
    help_text: field.help_text ?? "",
    is_required: field.is_required,
    is_enabled: field.is_enabled,
  };
}

function inspectorSignature(value: InspectorDraft) {
  return JSON.stringify(value);
}

async function fetchAdminCustomFields(moduleKey: string): Promise<CustomFieldDefinition[]> {
  const res = await apiFetch(`/admin/custom-fields/${moduleKey}`);
  if (!res.ok) throw new ApiError(res.status, "Custom fields could not be loaded.");
  return res.json();
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
    is_required: false,
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
      sort_order: field.sort_order ?? offset + index,
      is_enabled: field.is_active,
      is_required: field.is_required,
      is_protected: isProtectedFieldKey(fieldKey, moduleKey),
      placeholder: field.placeholder,
      help_text: field.help_text,
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
    is_required: field.is_required,
    is_protected: field.is_protected || isProtectedFieldKey(field.key, module.key),
    placeholder: field.placeholder,
    help_text: field.help_text,
    custom_module_id: module.id,
    custom_module_field: field,
  }));
}

const DEFAULT_MODULE_KEY = "sales_contacts";

export default function FieldsPage() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const {
    modules: customModules,
    updateField: updateCustomModuleField,
    isSaving: isSavingCustomModule,
    isLoading: isLoadingCustomModules,
    error: customModulesError,
    refresh: refreshCustomModules,
  } = useModuleBuilder();
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

  /*
   * A10: the module lives in `?module=`, not in local state (rebuild.md 5.6 batch 5). Every
   * visit used to start on `sales_contacts`, so a link to a module's field config could not
   * be sent and Back from a field's module lost it.
   *
   * An unknown key falls back to the default rather than showing an empty catalogue — but
   * only once the custom modules have resolved, since a deep link to a custom module is
   * unrecognisable while the list is still loading. The stale param is left in the address:
   * rewriting the URL on mount is what replaces a shared link's state with the defaults.
   */
  const { params, updateAddress } = usePageAddress();
  const addressedModuleKey = params.get("module")?.trim() || null;
  const moduleKey = addressedModuleKey && (isLoadingCustomModules || moduleOptions.some((option) => option.key === addressedModuleKey))
    ? addressedModuleKey
    : DEFAULT_MODULE_KEY;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FieldFilter>("all");
  const [panelMode, setPanelMode] = useState<PanelMode>("inspect");
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftField>(emptyDraft);
  const [inspectorEdit, setInspectorEdit] = useState<{ fieldKey: string; value: InspectorDraft } | null>(null);
  const [fieldKeyEdited, setFieldKeyEdited] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [inspectorError, setInspectorError] = useState<string | null>(null);

  const selectedCustomModule = customModules.find((module) => module.key === moduleKey && !module.deleted_at) ?? null;
  const supportsCustomFields = CUSTOM_FIELD_SUPPORTED_MODULES.has(moduleKey);
  const {
    fields: moduleFieldConfigs,
    updateField: updateModuleField,
    isSaving: isSavingModuleFields,
    isLoading: isLoadingModuleFields,
    error: moduleFieldsError,
    refresh: refreshModuleFields,
  } = useModuleFieldConfigs(moduleKey, true);

  const customFieldsQuery = useQuery({
    queryKey: ["admin-custom-fields", moduleKey],
    queryFn: () => fetchAdminCustomFields(moduleKey),
    enabled: supportsCustomFields,
    refetchOnWindowFocus: false,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/admin/custom-fields/${moduleKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        throw new Error(res.status === 400 ? "Check that the field key is unique and the values are valid." : "The custom field could not be created.");
      }
      return res.json() as Promise<CustomFieldDefinition>;
    },
    onSuccess: async (created) => {
      setDraft(emptyDraft);
      setFieldKeyEdited(false);
      setCreateError(null);
      await Promise.all([
        customFieldsQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["custom-fields", moduleKey] }),
      ]);
      setSelectedFieldKey(getCustomFieldColumnKey(created.field_key));
      setPanelMode("inspect");
      setPanelOpen(true);
      toast.success("Custom field created.");
    },
    onError: (error) => {
      setCreateError(error instanceof Error ? error.message : "The custom field could not be created.");
    },
  });

  const updateCustomFieldMutation = useMutation({
    mutationFn: async ({ fieldId, payload }: { fieldId: number; payload: Partial<CustomFieldDefinition> }) => {
      const res = await apiFetch(`/admin/custom-fields/${fieldId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("The custom field could not be updated.");
      return res.json() as Promise<CustomFieldDefinition>;
    },
    onSuccess: async () => {
      await Promise.all([
        customFieldsQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["custom-fields", moduleKey] }),
      ]);
    },
  });

  const systemCatalog = useMemo(() => buildSystemCatalog(moduleKey), [moduleKey]);
  const catalog = useMemo(() => {
    const base = selectedCustomModule
      ? buildCustomModuleCatalog(selectedCustomModule)
      : [...systemCatalog, ...buildCustomFieldCatalog(moduleKey, customFieldsQuery.data ?? [], systemCatalog.length)];
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
  }, [customFieldsQuery.data, moduleFieldConfigs, moduleKey, selectedCustomModule, systemCatalog]);

  const selectedField = catalog.find((field) => field.field_key === selectedFieldKey) ?? catalog[0] ?? null;
  const inspectorDraft = selectedField && inspectorEdit?.fieldKey === selectedField.field_key
    ? inspectorEdit.value
    : inspectorFromField(selectedField);
  const inspectorDirty = panelMode === "inspect" && selectedField != null
    && inspectorSignature(inspectorDraft) !== inspectorSignature(inspectorFromField(selectedField));
  const createDirty = panelMode === "create" && JSON.stringify(draft) !== JSON.stringify(emptyDraft);
  const hasUnsavedChanges = inspectorDirty || createDirty;
  useUnsavedChangesGuard(hasUnsavedChanges, createMutation.isPending || isSavingModuleFields || isSavingCustomModule);

  const filteredCatalog = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return catalog.filter((field) => {
      const matchesQuery = !query || [field.label, field.field_key, field.field_type, fieldSourceLabel(field.field_source)]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(query));
      const matchesFilter = filter === "all"
        || (filter === "system" && field.field_source === "system")
        || (filter === "custom" && field.field_source !== "system")
        || (filter === "required" && field.is_required)
        || (filter === "disabled" && !field.is_enabled);
      return matchesQuery && matchesFilter;
    });
  }, [catalog, filter, search]);

  const isLoading = isLoadingCustomModules || isLoadingModuleFields || (supportsCustomFields && customFieldsQuery.isLoading);
  const loadError = customModulesError || moduleFieldsError || customFieldsQuery.error;
  const hasLoadError = Boolean(loadError);
  const isSaving = isSavingModuleFields || updateCustomFieldMutation.isPending || isSavingCustomModule;

  async function confirmDiscard(description: string) {
    if (!hasUnsavedChanges) return true;
    return confirm({
      title: "Discard field changes?",
      description,
      confirmLabel: "Discard changes",
      variant: "destructive",
    });
  }

  function handleLabelChange(value: string) {
    setDraft((current) => ({
      ...current,
      label: value,
      field_key: fieldKeyEdited ? current.field_key : makeFieldKey(value),
    }));
  }

  async function handleModuleChange(nextModuleKey: string) {
    if (!await confirmDiscard("Your unsaved field changes will be lost when you switch modules.")) return;
    updateAddress((next) => {
      if (nextModuleKey === DEFAULT_MODULE_KEY) next.delete("module");
      else next.set("module", nextModuleKey);
    });
    setSearch("");
    setFilter("all");
    setPanelMode("inspect");
    setPanelOpen(false);
    setSelectedFieldKey(null);
    setInspectorEdit(null);
    setDraft(emptyDraft);
    setFieldKeyEdited(false);
    setCreateError(null);
  }

  async function selectField(fieldKey: string) {
    if (fieldKey === selectedField?.field_key && panelMode === "inspect") {
      setPanelOpen(true);
      return;
    }
    if (!await confirmDiscard("Your unsaved changes will be lost when you open another field.")) return;
    setPanelMode("inspect");
    setSelectedFieldKey(fieldKey);
    setInspectorEdit(null);
    setInspectorError(null);
    setPanelOpen(true);
  }

  async function showCreatePanel() {
    if (!supportsCustomFields) return;
    if (!await confirmDiscard("Your unsaved changes will be lost when you create another field.")) return;
    setDraft(emptyDraft);
    setFieldKeyEdited(false);
    setPanelMode("create");
    setCreateError(null);
    setPanelOpen(true);
  }

  function discardPanelChanges() {
    if (panelMode === "create") {
      setDraft(emptyDraft);
      setFieldKeyEdited(false);
      setCreateError(null);
    } else {
      setInspectorEdit(null);
      setInspectorError(null);
    }
  }

  async function closePanel() {
    if (!await confirmDiscard("Your unsaved field changes will be lost when you close the editor.")) return;
    discardPanelChanges();
    setPanelOpen(false);
  }

  function handlePanelOpenChange(open: boolean) {
    if (open) {
      setPanelOpen(true);
      return;
    }
    void closePanel();
  }

  function updateInspectorDraft(update: (current: InspectorDraft) => InspectorDraft) {
    if (!selectedField) return;
    setInspectorEdit({ fieldKey: selectedField.field_key, value: update(inspectorDraft) });
  }

  function submitCreate() {
    if (!draft.field_key.trim() || !draft.label.trim() || createMutation.isPending || !supportsCustomFields) return;
    setCreateError(null);
    createMutation.mutate();
  }

  async function persistEnabledState(field: FieldCatalogItem, isEnabled: boolean) {
    if (field.field_source === "custom_field" && field.custom_field_id) {
      await updateCustomFieldMutation.mutateAsync({ fieldId: field.custom_field_id, payload: { is_active: isEnabled } });
    }
    if (field.field_source === "custom_module" && field.custom_module_id && field.custom_module_field) {
      await updateCustomModuleField({
        moduleId: field.custom_module_id,
        fieldId: field.custom_module_field.id,
        payload: { is_active: isEnabled },
      });
    }
    await updateModuleField({
      fieldKey: field.field_key,
      payload: {
        label: field.label,
        field_type: field.field_type ?? null,
        field_source: field.field_source,
        is_enabled: isEnabled,
        is_protected: field.is_protected,
        sort_order: field.sort_order,
      },
    });
  }

  async function toggleField(field: FieldCatalogItem) {
    if (field.is_protected || isSaving) return;
    const nextEnabled = !field.is_enabled;
    try {
      await persistEnabledState(field, nextEnabled);
      toast.success(nextEnabled ? "Field enabled." : "Field disabled.");
    } catch {
      toast.error("The field status could not be updated. Please try again.");
    }
  }

  async function saveInspector() {
    if (!selectedField || selectedField.is_protected && !inspectorDraft.is_enabled || !inspectorDraft.label.trim()) return;
    setInspectorError(null);
    try {
      if (selectedField.field_source === "custom_field" && selectedField.custom_field_id) {
        await updateCustomFieldMutation.mutateAsync({
          fieldId: selectedField.custom_field_id,
          payload: {
            label: inspectorDraft.label.trim(),
            placeholder: inspectorDraft.placeholder.trim() || null,
            help_text: inspectorDraft.help_text.trim() || null,
            is_required: inspectorDraft.is_required,
            is_active: inspectorDraft.is_enabled,
          },
        });
      }
      if (selectedField.field_source === "custom_module" && selectedField.custom_module_id && selectedField.custom_module_field) {
        await updateCustomModuleField({
          moduleId: selectedField.custom_module_id,
          fieldId: selectedField.custom_module_field.id,
          payload: {
            label: inspectorDraft.label.trim(),
            placeholder: inspectorDraft.placeholder.trim() || null,
            help_text: inspectorDraft.help_text.trim() || null,
            is_required: inspectorDraft.is_required,
            is_active: inspectorDraft.is_enabled,
          },
        });
      }
      await updateModuleField({
        fieldKey: selectedField.field_key,
        payload: {
          label: inspectorDraft.label.trim(),
          field_type: selectedField.field_type ?? null,
          field_source: selectedField.field_source,
          is_enabled: selectedField.is_protected ? true : inspectorDraft.is_enabled,
          is_protected: selectedField.is_protected,
          sort_order: selectedField.sort_order,
        },
      });
      setInspectorEdit(null);
      toast.success("Field configuration saved.");
    } catch {
      setInspectorError("The field configuration could not be saved. Please try again.");
    }
  }

  async function retryAll() {
    await Promise.all([
      refreshCustomModules(),
      refreshModuleFields(),
      supportsCustomFields ? customFieldsQuery.refetch() : Promise.resolve(),
    ]);
  }

  const canCreate = supportsCustomFields && Boolean(draft.field_key.trim() && draft.label.trim()) && !createMutation.isPending;

  return (
    <PageShell
      variant="settings"
      title="Field Config"
      description="Choose which fields each module shows, and add your own."
      actions={(
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Select value={moduleKey} onValueChange={(value) => void handleModuleChange(value)}>
            <SelectTrigger className="w-full sm:w-72" aria-label="Select module">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {moduleOptions.map((moduleName) => <SelectItem key={moduleName.key} value={moduleName.key}>{moduleName.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => void showCreatePanel()} disabled={!supportsCustomFields} title={supportsCustomFields ? undefined : "Custom fields for this module are managed in Module Builder."}>
            <Plus />New field
          </Button>
        </div>
      )}
      // One of settings' three competing error idioms — a hand-rolled card inside the
      // content, where `PageShell` has supplied the §7.4 states all along. A 403 here means
      // an admin without `configure` on the module, which is a wall and not a fault.
      isPermissionDenied={isForbiddenError(loadError)}
      hasError={hasLoadError}
      errorDescription="Try the request again. Existing field settings have not been changed."
      onRetry={() => void retryAll()}
      backHref={SETTINGS_ROUTES.root}
      backLabel="Back to Settings"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
          <SearchBar value={search} onChange={setSearch} placeholder="Search fields" className="sm:w-72" />
          <SegmentedControl aria-label="Field filters" value={filter} onValueChange={setFilter} className="scrollbar-hide max-w-full overflow-x-auto">
            {FILTERS.map((value) => (
              <SegmentedItem key={value} value={value}>
                {value === "all" ? <Filter /> : null}
                {formatSnakeCaseLabel(value)}
              </SegmentedItem>
            ))}
          </SegmentedControl>
        </div>
        <span className="text-sm text-copy-muted">{isLoading ? "Loading…" : `${filteredCatalog.length} of ${catalog.length} fields`}</span>
      </div>

      {/* R10: the catalogue was a `divide-y` of hand-rolled rows with the whole row as a
          `<button aria-pressed>`, a page-local loading state, and a `Popover` of two ghost
          buttons standing in for a menu. Every one of those is `RecordTable`'s, including
          the highlight on the row the editor is open over. */}
      <RecordTable
        label="Module fields"
        columns={[
          {
            key: "label",
            label: "Field",
            size: "lg",
            render: (field) => (
              <>
                <div className="font-medium text-copy-primary">{field.label}</div>
                <div className="mt-1 break-all text-xs text-copy-muted">{field.field_key}</div>
              </>
            ),
          },
          { key: "source", label: "Source", size: "sm", render: (field) => <Chip>{fieldSourceLabel(field.field_source)}</Chip> },
          { key: "field_type", label: "Type", size: "sm", render: (field) => <span className="text-copy-secondary">{friendlyFieldType(field.field_type)}</span> },
          {
            key: "is_required",
            label: "Required",
            size: "sm",
            render: (field) => (field.is_required ? <StatusValue status={{ tone: "attention", label: "Required" }} /> : <EmptyValue context="cell" />),
          },
          {
            key: "is_enabled",
            label: "Status",
            size: "sm",
            render: (field) => (
              field.is_protected
                ? <Chip><Lock />Protected</Chip>
                : <StatusValue status={{ tone: field.is_enabled ? "neutral" : "critical", label: field.is_enabled ? "Enabled" : "Disabled" }} />
            ),
          },
        ]}
        rows={filteredCatalog}
        rowKey={(field) => field.field_key}
        onOpenRow={(field) => void selectField(field.field_key)}
        rowLabel={(field) => `Edit ${field.label}`}
        isRowHighlighted={(field) => panelOpen && panelMode === "inspect" && field.field_key === selectedField?.field_key}
        isLoading={isLoading}
        emptyState={{
          icon: Sparkles,
          title: "No fields found",
          description: "Select another module or create a custom field where supported.",
        }}
        hasActiveFilters={Boolean(search.trim()) || filter !== "all"}
        onClearFilters={() => { setSearch(""); setFilter("all"); }}
        filteredEmptyState={{
          icon: Sparkles,
          title: "No fields match these filters",
          description: "Clear the search or choose another field filter.",
        }}
        rowActions={(field) => (
          <ActionBar size="sm">
            <Button
              type="button"
              variant="ghost"
              disabled={field.is_protected || isSaving}
              title={field.is_protected ? "Protected fields cannot be disabled." : undefined}
              onClick={() => void toggleField(field)}
            >
              {field.is_enabled ? "Disable" : "Enable"}
            </Button>
          </ActionBar>
        )}
      />

      {/* One panel, two modes. It was two full copies of the sheet recipe in one file
          (§7.11), which is also why only one of them committed on Enter. */}
      <EditorPanel
        open={panelOpen}
        onOpenChange={handlePanelOpenChange}
        title={panelMode === "create" ? "Create custom field" : "Edit field"}
        description={panelMode === "create"
          ? "Add a field to this built-in module. Its key cannot be changed after creation."
          : selectedField?.field_key}
        closeLabel="Close field editor"
        onSubmit={panelMode === "create" ? () => submitCreate() : () => void saveInspector()}
        status={panelMode === "create"
          ? (createError ? <span role="alert" className="text-state-danger">{createError}</span> : null)
          : (inspectorError
            ? <span role="alert" className="text-state-danger">{inspectorError}</span>
            : inspectorDirty ? "Unsaved changes" : "All changes saved")}
        footer={panelMode === "create" ? (
          <>
            <Button type="button" variant="outline" onClick={() => handlePanelOpenChange(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button type="submit" disabled={!canCreate}>{createMutation.isPending ? "Creating…" : "Create field"}</Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" disabled={!inspectorDirty || isSaving} onClick={() => setInspectorEdit(null)}>Discard</Button>
            <Button type="submit" disabled={!inspectorDirty || isSaving || !inspectorDraft.label.trim()}>{isSaving ? "Saving…" : "Save field"}</Button>
          </>
        )}
      >
        {panelMode === "create" ? (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="create-field-label">Label <RequiredMark /></FieldLabel>
              <Input id="create-field-label" value={draft.label} onChange={(event) => handleLabelChange(event.target.value)} placeholder="Contract Term" disabled={createMutation.isPending} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="create-field-key">Field key <RequiredMark /></FieldLabel>
              <Input id="create-field-key" value={draft.field_key} onChange={(event) => { setFieldKeyEdited(true); setDraft((current) => ({ ...current, field_key: makeFieldKey(event.target.value) })); }} placeholder="contract_term" disabled={createMutation.isPending} required />
              <FieldDescription>Auto-generated from the label unless edited.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Field type</FieldLabel>
              <Select value={draft.field_type} onValueChange={(value) => setDraft((current) => ({ ...current, field_type: value as DraftField["field_type"] }))} disabled={createMutation.isPending}>
                <SelectTrigger aria-label="Field type"><SelectValue /></SelectTrigger>
                <SelectContent>{FIELD_TYPE_OPTIONS.map((option) => <SelectItem key={option} value={option}>{friendlyFieldType(option)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="create-field-placeholder">Placeholder</FieldLabel>
              <Input id="create-field-placeholder" value={draft.placeholder} onChange={(event) => setDraft((current) => ({ ...current, placeholder: event.target.value }))} disabled={createMutation.isPending} />
            </Field>
            <Field>
              <FieldLabel htmlFor="create-field-help">Help text</FieldLabel>
              <Input id="create-field-help" value={draft.help_text} onChange={(event) => setDraft((current) => ({ ...current, help_text: event.target.value }))} disabled={createMutation.isPending} />
            </Field>
            {/* Ruling 4: a lone `Checkbox` standing in for one on/off setting is the drift.
                `Checkbox` keeps *many from a set*. */}
            <Field>
              <FieldLabel>Value required</FieldLabel>
              <SegmentedBoolean
                aria-label="Value required"
                value={draft.is_required}
                onValueChange={(is_required) => setDraft((current) => ({ ...current, is_required }))}
                trueLabel="Required"
                falseLabel="Optional"
                disabled={createMutation.isPending}
              />
              <FieldDescription>A required field must carry a value before a record can be saved.</FieldDescription>
            </Field>
          </FieldGroup>
        ) : selectedField ? (
          <FieldGroup>
            {selectedField.is_protected ? (
              <p className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3 text-p-sm text-copy-secondary">
                This field stays enabled because module records, relationships, or routing depend on it.
              </p>
            ) : null}
            <Field>
              <FieldLabel htmlFor="inspector-field-label">Label <RequiredMark /></FieldLabel>
              <Input id="inspector-field-label" value={inspectorDraft.label} onChange={(event) => updateInspectorDraft((current) => ({ ...current, label: event.target.value }))} disabled={isSaving} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="inspector-field-type">Type</FieldLabel>
              <Input id="inspector-field-type" value={friendlyFieldType(selectedField.field_type)} disabled />
              <FieldDescription>Field type is fixed after records may contain values.</FieldDescription>
            </Field>
            {selectedField.field_source !== "system" ? (
              <>
                <Field>
                  <FieldLabel htmlFor="inspector-field-placeholder">Placeholder</FieldLabel>
                  <Input id="inspector-field-placeholder" value={inspectorDraft.placeholder} onChange={(event) => updateInspectorDraft((current) => ({ ...current, placeholder: event.target.value }))} disabled={isSaving} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="inspector-field-help">Help text</FieldLabel>
                  <Input id="inspector-field-help" value={inspectorDraft.help_text} onChange={(event) => updateInspectorDraft((current) => ({ ...current, help_text: event.target.value }))} disabled={isSaving} />
                </Field>
                <Field>
                  <FieldLabel>Value required</FieldLabel>
                  <SegmentedBoolean
                    aria-label="Value required"
                    value={inspectorDraft.is_required}
                    onValueChange={(is_required) => updateInspectorDraft((current) => ({ ...current, is_required }))}
                    trueLabel="Required"
                    falseLabel="Optional"
                    disabled={isSaving}
                  />
                </Field>
              </>
            ) : null}
            <Field>
              <FieldLabel>Field availability</FieldLabel>
              <SegmentedBoolean
                aria-label="Field availability"
                value={inspectorDraft.is_enabled}
                onValueChange={(is_enabled) => updateInspectorDraft((current) => ({ ...current, is_enabled }))}
                trueLabel="Enabled"
                falseLabel="Disabled"
                disabled={selectedField.is_protected || isSaving}
              />
              <FieldDescription>
                {selectedField.is_protected ? "Locked on for record safety." : "Disabled fields are removed from lists, filters, and supported forms."}
              </FieldDescription>
            </Field>
          </FieldGroup>
        ) : null}
      </EditorPanel>
    </PageShell>
  );
}
