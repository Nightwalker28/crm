"use client";

import { type FormEvent, useMemo, useState } from "react";
import { Filter, Lock, MoreHorizontal, Plus, Settings2, Sparkles, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Chip } from "@/components/ui/Chip";
import { StatusValue } from "@/components/ui/StatusValue";
import { SegmentedBoolean, SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { RouteLoadingState } from "@/components/ui/RouteStates";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
} from "@/components/ui/sheet";
import { isProtectedFieldKey, useModuleFieldConfigs, type ModuleFieldSource } from "@/hooks/useModuleFieldConfigs";
import type { CustomFieldDefinition } from "@/hooks/useModuleCustomFields";
import { useModuleBuilder, type CustomModuleDefinition, type CustomModuleField } from "@/hooks/useModuleBuilder";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api";
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
  if (!res.ok) throw new Error("Custom fields could not be loaded.");
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

  const [moduleKey, setModuleKey] = useState("sales_contacts");
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
  const hasLoadError = Boolean(customModulesError || moduleFieldsError || customFieldsQuery.error);
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
    setModuleKey(nextModuleKey);
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

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        <>
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
            <Plus />New Field
          </Button>
        </div>
        </>
      )}
    >
      {hasLoadError ? (
        <Card className="p-6" role="alert">
          <h2 className="font-semibold text-copy-primary">Fields could not be loaded</h2>
          <p className="mt-1 text-sm text-copy-secondary">Try the request again. Existing field settings have not been changed.</p>
          <Button className="mt-4" variant="outline" onClick={() => void retryAll()}>Try again</Button>
        </Card>
      ) : (
        <>
          <Card>
            <div className="border-b border-line-subtle p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <SearchBar value={search} onChange={setSearch} placeholder="Search fields" className="md:w-72" />
                <SegmentedControl aria-label="Field filters" value={filter} onValueChange={setFilter} className="scrollbar-hide max-w-full overflow-x-auto">
                  {FILTERS.map((value) => (
                    <SegmentedItem key={value} value={value}>
                      {value === "all" ? <Filter /> : null}
                      {formatSnakeCaseLabel(value)}
                    </SegmentedItem>
                  ))}
                </SegmentedControl>
              </div>
              <p className="mt-3 text-xs text-copy-muted">{filteredCatalog.length} of {catalog.length} fields shown</p>
            </div>

            {isLoading ? (
              <div className="p-5"><RouteLoadingState label="module fields" /></div>
            ) : filteredCatalog.length ? (
              <div className="divide-y divide-line-subtle">
                {filteredCatalog.map((field) => (
                  <div
                    key={field.field_key}
                    className={`group flex items-start gap-3 px-4 py-4 transition-colors hover:bg-surface-muted ${selectedField?.field_key === field.field_key && panelMode === "inspect" ? "bg-action-primary-muted" : ""}`}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      aria-pressed={selectedField?.field_key === field.field_key && panelMode === "inspect"}
                      onClick={() => void selectField(field.field_key)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-copy-primary">{field.label}</span>
                        <Chip>{fieldSourceLabel(field.field_source)}</Chip>
                        {field.is_required ? <StatusValue status={{ tone: "attention", label: "Required" }} /> : null}
                        {!field.is_enabled ? <StatusValue status={{ tone: "critical", label: "Disabled" }} /> : null}
                        {field.is_protected ? <Chip><Lock />Protected</Chip> : null}
                      </div>
                      <div className="mt-1 text-xs text-copy-muted">{field.field_key} · {friendlyFieldType(field.field_type)}</div>
                      {field.is_protected ? <p className="mt-2 text-xs text-copy-secondary">Required by this module and cannot be disabled.</p> : null}
                    </button>

                    <div className="flex items-center gap-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button type="button" size="icon-sm" variant="ghost" aria-label={`More actions for ${field.label}`}><MoreHorizontal /></Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-52 border-line-default bg-surface-raised p-2 text-copy-primary">
                          <Button className="w-full justify-start" variant="ghost" onClick={() => void selectField(field.field_key)}><Settings2 />Inspect field</Button>
                          <Button
                            className="mt-1 w-full justify-start"
                            variant="ghost"
                            disabled={field.is_protected || isSaving}
                            title={field.is_protected ? "Protected fields cannot be disabled." : undefined}
                            onClick={() => void toggleField(field)}
                          >
                            {field.is_enabled ? "Disable field" : "Enable field"}
                          </Button>
                          {field.is_protected ? <p className="px-2 pb-1 pt-2 text-xs text-copy-muted">This field is locked because module records depend on it.</p> : null}
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                className="py-16"
                icon={Sparkles}
                title={catalog.length ? "No fields match these filters" : "No fields found"}
                description={catalog.length ? "Clear the search or choose another field filter." : "Select another module or create a custom field where supported."}
                action={catalog.length ? <Button variant="outline" onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</Button> : undefined}
              />
            )}
          </Card>

          <Sheet open={panelOpen} onOpenChange={handlePanelOpenChange}>
            <SheetPortal>
              <SheetOverlay className="fixed inset-0 z-40 bg-overlay" />
              <SheetContent
                side="right"
                className="z-50 flex h-full w-full max-w-[32rem] flex-col border-l border-line-default bg-surface-raised outline-none"
              >
                {panelMode === "create" ? (
                  <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleCreate}>
                    <SheetHeader className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
                      <div>
                        <SheetTitle className="text-lg font-semibold text-copy-primary">Create custom field</SheetTitle>
                        <SheetDescription className="mt-1 text-sm text-copy-secondary">
                          Add a field to this built-in module. Its key cannot be changed after creation.
                        </SheetDescription>
                      </div>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Close field editor" onClick={() => void closePanel()}>
                        <X />
                      </Button>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                      <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="create-field-label">Label <RequiredMark /></FieldLabel>
                    <Input id="create-field-label" value={draft.label} onChange={(event) => handleLabelChange(event.target.value)} placeholder="Contract Term" disabled={createMutation.isPending} required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="create-field-key">Field Key <RequiredMark /></FieldLabel>
                    <Input id="create-field-key" value={draft.field_key} onChange={(event) => { setFieldKeyEdited(true); setDraft((current) => ({ ...current, field_key: makeFieldKey(event.target.value) })); }} placeholder="contract_term" disabled={createMutation.isPending} required />
                    <FieldDescription>Auto-generated from the label unless edited.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Field Type</FieldLabel>
                    <Select value={draft.field_type} onValueChange={(value) => setDraft((current) => ({ ...current, field_type: value as DraftField["field_type"] }))} disabled={createMutation.isPending}>
                      <SelectTrigger aria-label="Field Type"><SelectValue /></SelectTrigger>
                      <SelectContent>{FIELD_TYPE_OPTIONS.map((option) => <SelectItem key={option} value={option}>{friendlyFieldType(option)}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="create-field-placeholder">Placeholder</FieldLabel>
                    <Input id="create-field-placeholder" value={draft.placeholder} onChange={(event) => setDraft((current) => ({ ...current, placeholder: event.target.value }))} disabled={createMutation.isPending} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="create-field-help">Help Text</FieldLabel>
                    <Input id="create-field-help" value={draft.help_text} onChange={(event) => setDraft((current) => ({ ...current, help_text: event.target.value }))} disabled={createMutation.isPending} />
                  </Field>
                  <Field orientation="horizontal" className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3">
                    <Checkbox id="create-field-required" checked={draft.is_required} onCheckedChange={(checked) => setDraft((current) => ({ ...current, is_required: checked === true }))} />
                    <FieldLabel htmlFor="create-field-required">Require a value when records are saved</FieldLabel>
                  </Field>
                      </FieldGroup>
                      {createError ? <p className="mt-4 text-sm text-state-danger" role="alert">{createError}</p> : null}
                    </div>
                    <SheetFooter className="flex justify-end gap-2 border-t border-line-subtle bg-surface px-5 py-4">
                      <Button type="button" variant="outline" onClick={() => void closePanel()} disabled={createMutation.isPending}>Cancel</Button>
                      <Button type="submit" disabled={!canCreate}>{createMutation.isPending ? "Creating…" : "Create Field"}</Button>
                    </SheetFooter>
                  </form>
                ) : selectedField ? (
                  <>
                    <SheetHeader className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <SheetTitle className="text-lg font-semibold text-copy-primary">Edit field</SheetTitle>
                          {selectedField.is_protected ? <Lock className="h-4 w-4 text-primary" aria-label="Protected field" /> : null}
                        </div>
                        <SheetDescription className="mt-1 break-all text-sm text-copy-muted">{selectedField.field_key}</SheetDescription>
                      </div>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Close field editor" onClick={() => void closePanel()}>
                        <X />
                      </Button>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                      {selectedField.is_protected ? (
                        <div className="mb-4 rounded-[var(--radius-control)] border border-primary/30 bg-action-primary-muted p-3 text-sm text-copy-secondary">
                          This protected field stays enabled because module records, relationships, or routing depend on it.
                        </div>
                      ) : null}
                      <FieldGroup>
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
                        <FieldLabel htmlFor="inspector-field-help">Help Text</FieldLabel>
                        <Input id="inspector-field-help" value={inspectorDraft.help_text} onChange={(event) => updateInspectorDraft((current) => ({ ...current, help_text: event.target.value }))} disabled={isSaving} />
                      </Field>
                      <Field orientation="horizontal" className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3">
                        <Checkbox id="inspector-field-required" checked={inspectorDraft.is_required} onCheckedChange={(checked) => updateInspectorDraft((current) => ({ ...current, is_required: checked === true }))} disabled={isSaving} />
                        <FieldLabel htmlFor="inspector-field-required">Required</FieldLabel>
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
                      {inspectorError ? <p className="mt-4 text-sm text-state-danger" role="alert">{inspectorError}</p> : null}
                    </div>
                    <SheetFooter className="flex flex-col gap-3 border-t border-line-subtle bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <span className={`text-sm ${inspectorDirty ? "text-state-warning" : "text-state-success"}`}>{inspectorDirty ? "Unsaved changes" : "All changes saved"}</span>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" disabled={!inspectorDirty || isSaving} onClick={() => setInspectorEdit(null)}>Discard</Button>
                        <Button type="button" disabled={!inspectorDirty || isSaving || !inspectorDraft.label.trim()} onClick={() => void saveInspector()}>{isSaving ? "Saving…" : "Save Field"}</Button>
                      </div>
                    </SheetFooter>
                  </>
                ) : null}
              </SheetContent>
            </SheetPortal>
          </Sheet>
        </>
      )}
    </PageShell>
  );
}
