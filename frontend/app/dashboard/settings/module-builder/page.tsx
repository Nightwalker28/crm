"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  ChevronDown,
  ChevronUp,
  GripVertical,
  LockKeyhole,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RequiredMark } from "@/components/ui/RequiredMark";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsSwitchRow } from "@/components/ui/SettingsSwitchRow";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  useModuleBuilder,
  type CustomFieldType,
  type CustomModuleDefinition,
  type CustomModuleField,
  type CustomModuleFieldPayload,
} from "@/hooks/useModuleBuilder";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useConfirm } from "@/hooks/useConfirm";
import { useSidebarTabsAdmin, type SidebarTab } from "@/hooks/admin/useModulesAdmin";
import { cn } from "@/lib/utils";

const FIELD_TYPES: CustomFieldType[] = [
  "text",
  "textarea",
  "number",
  "currency",
  "date",
  "datetime",
  "boolean",
  "email",
  "phone",
  "url",
  "single_select",
  "multi_select",
];

const HIDDEN_SIDEBAR_TAB: SidebarTab = {
  id: null,
  key: "none",
  label: "None",
  sort_order: -1,
  is_system: true,
};

const EDITOR_TABS = ["general", "fields", "layout"] as const;
type EditorTab = typeof EDITOR_TABS[number];

type EditableField = {
  clientId: string;
  serverId?: number;
  key?: string;
  label: string;
  field_type: CustomFieldType;
  help_text: string;
  placeholder: string;
  is_required: boolean;
  is_unique: boolean;
  display_in_list: boolean;
  default_value: string;
  options_text: string;
  is_active: boolean;
  is_protected: boolean;
};

type ModuleDraft = {
  name: string;
  display_name: string;
  description: string;
  sidebar_tab_key: string;
  is_active: boolean;
};

const EMPTY_FIELD: EditableField = {
  clientId: "new",
  label: "",
  field_type: "text",
  help_text: "",
  placeholder: "",
  is_required: false,
  is_unique: false,
  display_in_list: true,
  default_value: "",
  options_text: "",
  is_active: true,
  is_protected: false,
};

function fieldTypeLabel(value: string) {
  return value.replaceAll("_", " ");
}

function editableField(field: CustomModuleField): EditableField {
  return {
    clientId: `field-${field.id}`,
    serverId: field.id,
    key: field.key,
    label: field.label,
    field_type: field.field_type,
    help_text: field.help_text ?? "",
    placeholder: field.placeholder ?? "",
    is_required: field.is_required,
    is_unique: field.is_unique,
    display_in_list: field.display_in_list,
    default_value: field.default_value == null ? "" : String(field.default_value),
    options_text: (field.validation_json?.options ?? []).join("\n"),
    is_active: field.is_active,
    is_protected: field.is_protected,
  };
}

function fieldPayload(field: EditableField, sortOrder: number): CustomModuleFieldPayload {
  const supportsOptions = field.field_type === "single_select" || field.field_type === "multi_select";
  const options = field.options_text.split("\n").map((option) => option.trim()).filter(Boolean);
  return {
    label: field.label.trim(),
    field_type: field.field_type,
    help_text: field.help_text.trim() || null,
    placeholder: field.placeholder.trim() || null,
    is_required: field.is_required,
    is_unique: field.field_type === "multi_select" ? false : field.is_unique,
    display_in_list: field.display_in_list,
    default_value: field.default_value === "" ? null : field.default_value,
    validation_json: supportsOptions && options.length ? { options } : null,
    sort_order: sortOrder,
    is_active: field.is_active,
  };
}

function draftFor(module: CustomModuleDefinition): ModuleDraft {
  return {
    name: module.name,
    display_name: module.display_name ?? "",
    description: module.description ?? "",
    sidebar_tab_key: module.sidebar_tab_key ?? "other",
    is_active: module.is_active,
  };
}

function snapshot(draft: ModuleDraft, fields: EditableField[], deletedIds: number[]) {
  return JSON.stringify({ draft, fields, deletedIds });
}

function FieldInspector({
  field,
  disabled,
  onChange,
}: {
  field: EditableField | null;
  disabled: boolean;
  onChange: (update: Partial<EditableField>) => void;
}) {
  if (!field) return null;

  const isNew = !field.serverId;
  const supportsOptions = field.field_type === "single_select" || field.field_type === "multi_select";

  return (
    <>
      <SheetHeader className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-base font-semibold text-copy-primary">Edit field</SheetTitle>
            {field.is_protected ? <LockKeyhole className="h-4 w-4 text-primary" aria-label="Protected field" /> : null}
            <Chip>{isNew ? "Draft" : fieldTypeLabel(field.field_type)}</Chip>
          </div>
          <SheetDescription className="mt-1 break-all text-sm text-copy-muted">
            {field.key ?? "Configure the new field before saving the module."}
          </SheetDescription>
        </div>
        <SheetClose asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close field editor">
            <X />
          </Button>
        </SheetClose>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {field.is_protected ? (
          <div className="mb-4 rounded-[var(--radius-control)] border border-primary/30 bg-action-primary-muted p-3 text-sm text-copy-secondary">
            This identifier field is protected because module records and routing depend on it. It cannot be disabled or deleted.
          </div>
        ) : null}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="builder-field-label">Label <RequiredMark /></FieldLabel>
            <Input
              id="builder-field-label"
              value={field.label}
              onChange={(event) => onChange({ label: event.target.value })}
              disabled={disabled}
              required
            />
          </Field>
          <Field>
            <FieldLabel>Field type</FieldLabel>
            {isNew ? (
              <Select
                value={field.field_type}
                onValueChange={(value) => onChange({
                  field_type: value as CustomFieldType,
                  is_unique: value === "multi_select" ? false : field.is_unique,
                })}
                disabled={disabled}
              >
                <SelectTrigger aria-label="Field type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((type) => <SelectItem key={type} value={type}>{fieldTypeLabel(type)}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <>
                <Input value={fieldTypeLabel(field.field_type)} disabled />
                <FieldDescription>Type is fixed after the field is created so stored values remain valid.</FieldDescription>
              </>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="builder-field-placeholder">Placeholder</FieldLabel>
            <Input id="builder-field-placeholder" value={field.placeholder} onChange={(event) => onChange({ placeholder: event.target.value })} disabled={disabled} />
          </Field>
          <Field>
            <FieldLabel htmlFor="builder-field-help">Help text</FieldLabel>
            <Input id="builder-field-help" value={field.help_text} onChange={(event) => onChange({ help_text: event.target.value })} disabled={disabled} />
          </Field>
          <Field>
            <FieldLabel htmlFor="builder-field-default">Default value</FieldLabel>
            <Input id="builder-field-default" value={field.default_value} onChange={(event) => onChange({ default_value: event.target.value })} disabled={disabled} />
          </Field>
          {supportsOptions ? (
            <Field>
              <FieldLabel htmlFor="builder-field-options">Options</FieldLabel>
              <Textarea id="builder-field-options" value={field.options_text} onChange={(event) => onChange({ options_text: event.target.value })} placeholder="One option per line" disabled={disabled} />
            </Field>
          ) : null}
          <SettingsSwitchRow id="builder-field-required" label="Required" description="Require a value when records are saved." checked={field.is_required} onCheckedChange={(checked) => onChange({ is_required: checked })} disabled={disabled} />
          <SettingsSwitchRow id="builder-field-unique" label="Unique values" description="Prevent two records from using the same value." checked={field.is_unique} onCheckedChange={(checked) => onChange({ is_unique: checked })} disabled={disabled || field.field_type === "multi_select"} />
          <SettingsSwitchRow
            id="builder-field-list"
            label="Include in initial system default view"
            description="Used only when the system default view is first created. Saved Views controls each user's ongoing column visibility and ordering."
            checked={field.display_in_list}
            onCheckedChange={(checked) => onChange({ display_in_list: checked })}
            disabled={disabled}
          />
          <SettingsSwitchRow id="builder-field-active" label="Enabled" description={field.is_protected ? "Protected fields must remain enabled." : "Make this field available in records, lists, and filters."} checked={field.is_active} onCheckedChange={(checked) => onChange({ is_active: checked })} disabled={disabled || field.is_protected} />
        </FieldGroup>
      </div>
      <SheetFooter className="flex items-center justify-between gap-3 border-t border-line-subtle bg-surface px-5 py-4">
        <p className="text-xs text-copy-muted">Changes are saved with the module.</p>
        <SheetClose asChild>
          <Button type="button">Done editing field</Button>
        </SheetClose>
      </SheetFooter>
    </>
  );
}

function SidebarGroupManager({
  tabs,
  disabled,
  onCreate,
  onRename,
}: {
  tabs: SidebarTab[];
  disabled: boolean;
  onCreate: (label: string) => Promise<void>;
  onRename: (key: string, label: string) => Promise<void>;
}) {
  const [newLabel, setNewLabel] = useState("");
  const customTabs = tabs.filter((tab) => !tab.is_system);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!newLabel.trim()) return;
    try {
      await onCreate(newLabel.trim());
      setNewLabel("");
    } catch {
      // The parent action already provides a user-facing failure message.
    }
  }

  return (
    <div className="border-t border-line-subtle pt-5">
      <h3 className="text-sm font-semibold text-copy-primary">Custom sidebar groups</h3>
      <p className="mt-1 text-sm text-copy-secondary">Groups organize modules without changing their routes.</p>
      <form onSubmit={create} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input aria-label="New sidebar group" value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder="Group name" />
        <Button type="submit" variant="outline" disabled={disabled || !newLabel.trim()}><Plus />Add group</Button>
      </form>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {customTabs.map((tab) => (
          <Input
            key={tab.key}
            aria-label={`Rename ${tab.label}`}
            defaultValue={tab.label}
            disabled={disabled}
            onBlur={(event) => {
              const label = event.target.value.trim();
              if (label && label !== tab.label) void onRename(tab.key, label).catch(() => undefined);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ModuleWorkspace({
  module,
  sidebarTabs,
  disabled,
  onDirtyChange,
  onSave,
  onDelete,
  onRestore,
  onCreateTab,
  onRenameTab,
}: {
  module: CustomModuleDefinition;
  sidebarTabs: SidebarTab[];
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (input: {
    draft: ModuleDraft;
    fields: EditableField[];
    deletedIds: number[];
  }) => Promise<void>;
  onDelete: () => Promise<void>;
  onRestore: () => Promise<void>;
  onCreateTab: (label: string) => Promise<void>;
  onRenameTab: (key: string, label: string) => Promise<void>;
}) {
  const initialDraft = draftFor(module);
  const initialFields = [...module.fields]
    .sort((left, right) => left.sort_order - right.sort_order || left.id - right.id)
    .map(editableField);
  const initialSnapshot = snapshot(initialDraft, initialFields, []);
  const [tab, setTab] = useState<EditorTab>("fields");
  const [draft, setDraft] = useState(initialDraft);
  const [fields, setFields] = useState(initialFields);
  const [deletedIds, setDeletedIds] = useState<number[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(initialFields[0]?.clientId ?? null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [baseline, setBaseline] = useState(initialSnapshot);
  const [saveError, setSaveError] = useState<string | null>(null);
  const deleted = Boolean(module.deleted_at);
  const isDirty = snapshot(draft, fields, deletedIds) !== baseline;
  const selectedField = fields.find((field) => field.clientId === selectedFieldId) ?? null;
  const placementOptions = useMemo(() => [HIDDEN_SIDEBAR_TAB, ...sidebarTabs], [sidebarTabs]);

  useUnsavedChangesGuard(isDirty, disabled);
  useEffect(() => {
    onDirtyChange(isDirty);
    return () => onDirtyChange(false);
  }, [isDirty, onDirtyChange]);

  function updateField(clientId: string, update: Partial<EditableField>) {
    setFields((current) => current.map((field) => field.clientId === clientId ? { ...field, ...update } : field));
  }

  function addField() {
    const field = { ...EMPTY_FIELD, clientId: `new-${Date.now()}` };
    setFields((current) => [...current, field]);
    setSelectedFieldId(field.clientId);
    setTab("fields");
    setInspectorOpen(true);
  }

  function removeField(field: EditableField) {
    if (field.is_protected) return;
    if (!window.confirm(`Remove ${field.label || "this field"} when the module is saved?`)) return;
    setFields((current) => current.filter((candidate) => candidate.clientId !== field.clientId));
    if (field.serverId) setDeletedIds((current) => [...current, field.serverId as number]);
    setSelectedFieldId((current) => current === field.clientId ? null : current);
    if (selectedFieldId === field.clientId) setInspectorOpen(false);
  }

  function moveField(clientId: string, direction: -1 | 1) {
    setFields((current) => {
      const index = current.findIndex((field) => field.clientId === clientId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function dropField(sourceId: string, targetId: string) {
    if (!sourceId || sourceId === targetId) return;
    setFields((current) => {
      const sourceIndex = current.findIndex((field) => field.clientId === sourceId);
      const targetIndex = current.findIndex((field) => field.clientId === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  function discard() {
    setDraft(initialDraft);
    setFields(initialFields);
    setDeletedIds([]);
    setSelectedFieldId(initialFields[0]?.clientId ?? null);
    setBaseline(initialSnapshot);
    setSaveError(null);
  }

  async function save() {
    if (!draft.name.trim() || fields.some((field) => !field.label.trim())) {
      setSaveError("Add a name for the module and every field before saving.");
      return;
    }
    setSaveError(null);
    try {
      await onSave({ draft, fields, deletedIds });
      setBaseline(snapshot(draft, fields, deletedIds));
      toast.success("Module changes saved");
    } catch {
      setSaveError("We couldn't save this module. Review the fields and try again.");
    }
  }

  const tabLabel = (value: EditorTab) => value.charAt(0).toUpperCase() + value.slice(1);

  return (
    <div className="grid min-w-0 gap-4">
      <Card className="min-w-0">
        <CardHeader className="flex-col gap-4 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-copy-primary">{module.display_name || module.name}</h2>
              <Chip>{deleted ? "Deleted" : draft.is_active ? "Active" : "Inactive"}</Chip>
            </div>
            <p className="mt-1 truncate text-sm text-copy-muted">{module.key}</p>
          </div>
          {!deleted ? (
            <Button asChild variant="outline" size="sm" className="sm:ml-auto">
              <Link href={`/dashboard/custom/${module.key}`}><Settings2 />Open runtime</Link>
            </Button>
          ) : null}
        </CardHeader>

        <div className="overflow-x-auto border-y border-line-subtle px-3" role="tablist" aria-label="Module editor">
          <div className="flex min-w-max gap-1 py-2">
            {EDITOR_TABS.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => {
                  setTab(value);
                  if (value !== "fields") setInspectorOpen(false);
                }}
                className={cn(
                  "rounded-[var(--radius-control-sm)] px-3 py-2 text-sm font-medium text-copy-secondary hover:bg-surface-muted hover:text-copy-primary",
                  tab === value && "bg-action-primary-muted text-primary",
                )}
              >
                {tabLabel(value)}
              </button>
            ))}
          </div>
        </div>

        <CardBody>
          {deleted ? (
            <EmptyState icon={Trash2} title="Module is deleted" description="Restore it before editing fields or runtime settings." />
          ) : tab === "general" ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="builder-module-name">Module name <RequiredMark /></FieldLabel>
                <Input id="builder-module-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} disabled={disabled} />
              </Field>
              <Field>
                <FieldLabel htmlFor="builder-module-display">Display name</FieldLabel>
                <Input id="builder-module-display" value={draft.display_name} onChange={(event) => setDraft((current) => ({ ...current, display_name: event.target.value }))} disabled={disabled} />
                <FieldDescription>Used in the sidebar while the stable module key and route remain unchanged.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="builder-module-description">Description</FieldLabel>
                <Textarea id="builder-module-description" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} disabled={disabled} />
              </Field>
              <SettingsSwitchRow id="builder-module-active" label="Module enabled" description="Make this module available to users who have access to it." checked={draft.is_active} onCheckedChange={(checked) => setDraft((current) => ({ ...current, is_active: checked }))} disabled={disabled} />
            </FieldGroup>
          ) : tab === "fields" ? (
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-copy-primary">Fields</h3>
                  <p className="text-sm text-copy-secondary">Drag rows or use the arrow controls to set record and list order.</p>
                </div>
                <Button type="button" size="sm" onClick={addField} disabled={disabled}><Plus />Add field</Button>
              </div>
              <div className="grid gap-2">
                {fields.length ? fields.map((field, index) => (
                  <div
                    key={field.clientId}
                    data-testid={`module-field-${field.clientId}`}
                    draggable={!disabled}
                    onDragStart={(event) => event.dataTransfer.setData("text/plain", field.clientId)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => dropField(event.dataTransfer.getData("text/plain"), field.clientId)}
                    className={cn(
                      "flex items-center gap-2 rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-2",
                      selectedFieldId === field.clientId && "border-primary bg-action-primary-muted",
                    )}
                  >
                    <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-copy-muted" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFieldId(field.clientId);
                        setInspectorOpen(true);
                      }}
                      className="min-w-0 flex-1 text-left"
                      aria-label={`Edit ${field.label || "untitled field"}`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-copy-primary">{field.label || "Untitled field"}</span>
                        {field.is_protected ? <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Protected" /> : null}
                        {!field.serverId ? <Chip>Draft</Chip> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-copy-muted">{field.key ?? fieldTypeLabel(field.field_type)}</span>
                    </button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${field.label} up`} onClick={() => moveField(field.clientId, -1)} disabled={disabled || index === 0}><ChevronUp /></Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${field.label} down`} onClick={() => moveField(field.clientId, 1)} disabled={disabled || index === fields.length - 1}><ChevronDown /></Button>
                    <Button type="button" variant="destructiveGhost" size="icon-sm" aria-label={`Delete ${field.label}`} onClick={() => removeField(field)} disabled={disabled || field.is_protected}><Trash2 /></Button>
                  </div>
                )) : (
                  <EmptyState icon={Boxes} title="No fields configured" description="Add at least one field before using this module." />
                )}
              </div>
            </div>
          ) : tab === "layout" ? (
            <FieldGroup>
              <Field>
                <FieldLabel>Sidebar group</FieldLabel>
                <Select value={draft.sidebar_tab_key} onValueChange={(value) => setDraft((current) => ({ ...current, sidebar_tab_key: value }))} disabled={disabled}>
                  <SelectTrigger aria-label="Sidebar group"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {placementOptions.map((option) => <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FieldDescription>Choose where the module appears. “None” keeps the runtime available without a sidebar link.</FieldDescription>
              </Field>
              <SidebarGroupManager tabs={sidebarTabs} disabled={disabled} onCreate={onCreateTab} onRename={onRenameTab} />
            </FieldGroup>
          ) : null}
        </CardBody>

        <CardFooter className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 bg-surface/95 backdrop-blur">
          {deleted ? (
            <Button type="button" onClick={() => void onRestore().catch(() => undefined)} disabled={disabled}><RotateCcw />Restore module</Button>
          ) : (
            <>
              <div className="mr-auto">
                <p className={cn("text-sm font-medium", isDirty ? "text-state-warning" : "text-state-success")}>{isDirty ? "Unsaved changes" : "All changes saved"}</p>
                {saveError ? <p role="alert" className="mt-1 text-sm text-state-danger">{saveError}</p> : null}
              </div>
              <Button type="button" variant="outline" onClick={discard} disabled={disabled || !isDirty}>Discard</Button>
              <Button type="button" onClick={save} disabled={disabled || !isDirty}><Save />{disabled ? "Saving…" : "Save changes"}</Button>
              <Button type="button" variant="destructiveGhost" onClick={() => void onDelete().catch(() => undefined)} disabled={disabled}><Trash2 />Delete</Button>
            </>
          )}
        </CardFooter>
      </Card>

      <Sheet
        open={tab === "fields" && !deleted && Boolean(selectedField) && inspectorOpen}
        onOpenChange={setInspectorOpen}
      >
        <SheetPortal>
          <SheetOverlay className="fixed inset-0 z-40 bg-overlay" />
          <SheetContent
            side="right"
            className="z-50 flex h-full w-full max-w-[32rem] flex-col border-l border-line-default bg-surface-raised outline-none"
          >
            <FieldInspector
              field={selectedField}
              disabled={disabled}
              onChange={(update) => selectedFieldId && updateField(selectedFieldId, update)}
            />
          </SheetContent>
        </SheetPortal>
      </Sheet>
    </div>
  );
}

function CreateModulePanel({
  sidebarTabs,
  disabled,
  onCreate,
  onCancel,
}: {
  sidebarTabs: SidebarTab[];
  disabled: boolean;
  onCreate: (payload: { name: string; display_name?: string; description?: string; sidebar_tab_key: string; fields: CustomModuleFieldPayload[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [sidebarTabKey, setSidebarTabKey] = useState("other");
  const [error, setError] = useState<string | null>(null);
  const placementOptions = [HIDDEN_SIDEBAR_TAB, ...sidebarTabs];
  const isDirty = Boolean(name || displayName || description);
  useUnsavedChangesGuard(isDirty, disabled);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        display_name: displayName.trim() || undefined,
        description: description.trim() || undefined,
        sidebar_tab_key: sidebarTabKey,
        fields: [{ label: "Name", field_type: "text", is_required: true, display_in_list: true }],
      });
      toast.success("Module created");
    } catch {
      setError("We couldn't create this module. Check the name and try again.");
    }
  }

  return (
    <Card>
      <form onSubmit={submit}>
        <CardHeader>
          <div>
            <h2 className="text-lg font-semibold text-copy-primary">New module</h2>
            <p className="mt-1 text-sm text-copy-secondary">Create the module shell first, then configure its fields in the inspector.</p>
          </div>
        </CardHeader>
        <CardBody>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-module-name">Module name <RequiredMark /></FieldLabel>
              <Input id="new-module-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Service Requests" disabled={disabled} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-module-display">Display name</FieldLabel>
              <Input id="new-module-display" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Requests" disabled={disabled} />
            </Field>
            <Field>
              <FieldLabel>Sidebar group</FieldLabel>
              <Select value={sidebarTabKey} onValueChange={setSidebarTabKey} disabled={disabled}>
                <SelectTrigger aria-label="New module sidebar group"><SelectValue /></SelectTrigger>
                <SelectContent>{placementOptions.map((option) => <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="new-module-description">Description</FieldLabel>
              <Textarea id="new-module-description" value={description} onChange={(event) => setDescription(event.target.value)} disabled={disabled} />
            </Field>
          </FieldGroup>
          {error ? <p role="alert" className="mt-4 text-sm text-state-danger">{error}</p> : null}
        </CardBody>
        <CardFooter className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={disabled}>Cancel</Button>
          <Button type="submit" disabled={disabled || !name.trim()}><Boxes />{disabled ? "Creating…" : "Create module"}</Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function ModuleBuilderPage() {
  const { confirm } = useConfirm();
  const {
    modules,
    isLoading,
    error: queryError,
    refresh,
    createModule,
    updateModule,
    deleteModule,
    restoreModule,
    addField,
    updateField,
    deleteField,
    isSaving,
  } = useModuleBuilder();
  const { tabs: sidebarTabs, createTab, updateTab, isSaving: isSavingTabs } = useSidebarTabsAdmin();
  const [search, setSearch] = useState("");
  const [selectedModuleId, setSelectedModuleId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);

  const selectedModule = modules.find((module) => module.id === selectedModuleId)
    ?? modules.find((module) => !module.deleted_at)
    ?? modules[0]
    ?? null;
  const selectableModules = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return modules;
    const matches = modules.filter((module) => [module.name, module.display_name, module.key].some((value) => value?.toLowerCase().includes(query)));
    return selectedModule && !matches.some((module) => module.id === selectedModule.id) ? [selectedModule, ...matches] : matches;
  }, [modules, search, selectedModule]);

  async function canLeaveWorkspace() {
    if (!workspaceDirty) return true;
    return confirm({
      title: "Discard module changes?",
      description: "Switching modules will discard the unsaved configuration and field changes in this workspace.",
      confirmLabel: "Discard and switch",
      variant: "destructive",
    });
  }

  async function selectModule(moduleId: number) {
    if (moduleId === selectedModule?.id && !creating) return;
    if (!(await canLeaveWorkspace())) return;
    setWorkspaceDirty(false);
    setCreating(false);
    setSearch("");
    setSelectedModuleId(moduleId);
  }

  async function startCreating() {
    if (!(await canLeaveWorkspace())) return;
    setWorkspaceDirty(false);
    setSearch("");
    setCreating(true);
  }

  async function run(action: () => Promise<unknown>, failureMessage: string) {
    try {
      await action();
    } catch {
      toast.error(failureMessage);
      throw new Error(failureMessage);
    }
  }

  return (
    <PageShell
      variant="settings"
      title="Module Builder"
      description="Create custom modules and shape the fields their records carry."
      isLoading={isLoading}
      hasError={Boolean(queryError)}
      errorDescription="Your module configuration is unchanged. Try loading it again."
      onRetry={() => void refresh()}
      backHref="/dashboard/settings"
      backLabel="Return to settings"
      actions={(
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            <SearchBar value={search} onChange={setSearch} placeholder="Search modules" className="sm:w-56" />
            {modules.length ? (
              <Select value={creating || !selectedModule ? "" : String(selectedModule.id)} onValueChange={(value) => void selectModule(Number(value))}>
                <SelectTrigger className="w-full sm:w-72" aria-label="Module"><SelectValue placeholder={creating ? "New module" : "Select module"} /></SelectTrigger>
                <SelectContent>
                  {selectableModules.map((module) => (
                    <SelectItem key={module.id} value={String(module.id)}>
                      {module.display_name || module.name}{module.deleted_at ? " · Deleted" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button type="button" onClick={() => void startCreating()}><Plus />New module</Button>
            {!creating && selectedModule && !selectedModule.deleted_at ? (
              <>
                <Button asChild type="button" variant="ghost"><Link href={`/dashboard/views/${selectedModule.key}`}>Saved views</Link></Button>
                <Button asChild type="button" variant="ghost"><Link href="/dashboard/settings/permissions">Permissions</Link></Button>
                <Button asChild type="button" variant="ghost"><Link href="/dashboard/settings/automation">Automation</Link></Button>
              </>
            ) : null}
          </div>
      )}
    >
      <div className="min-w-0">
          {creating || !selectedModule ? (
            <CreateModulePanel
              sidebarTabs={sidebarTabs}
              disabled={isSaving}
              onCancel={() => setCreating(false)}
              onCreate={async (payload) => {
                const created = await createModule(payload);
                setSelectedModuleId(created.id);
                setCreating(false);
              }}
            />
          ) : (
            <ModuleWorkspace
              key={`${selectedModule.id}-${workspaceRevision}`}
              module={selectedModule}
              sidebarTabs={sidebarTabs}
              disabled={isSaving || isSavingTabs}
              onDirtyChange={setWorkspaceDirty}
              onSave={async ({ draft, fields, deletedIds }) => {
                await updateModule({
                  moduleId: selectedModule.id,
                  payload: {
                    name: draft.name.trim(),
                    display_name: draft.display_name.trim() || null,
                    description: draft.description.trim() || null,
                    sidebar_tab_key: draft.sidebar_tab_key,
                    is_active: draft.is_active,
                  },
                });
                for (const fieldId of deletedIds) await deleteField({ moduleId: selectedModule.id, fieldId });
                for (const [index, field] of fields.entries()) {
                  if (field.serverId) {
                    await updateField({ moduleId: selectedModule.id, fieldId: field.serverId, payload: fieldPayload(field, index) });
                  } else {
                    await addField({ moduleId: selectedModule.id, payload: fieldPayload(field, index) });
                  }
                }
                await refresh();
                setWorkspaceDirty(false);
                setWorkspaceRevision((current) => current + 1);
              }}
              onDelete={async () => {
                if (!window.confirm(`Delete ${selectedModule.display_name || selectedModule.name}? Records remain recoverable.`)) return;
                await run(() => deleteModule(selectedModule.id), "The module could not be deleted.");
                setWorkspaceRevision((current) => current + 1);
              }}
              onRestore={async () => {
                await run(() => restoreModule(selectedModule.id), "The module could not be restored.");
                setWorkspaceRevision((current) => current + 1);
              }}
              onCreateTab={async (label) => {
                await run(() => createTab({ label }), "The sidebar group could not be created.");
              }}
              onRenameTab={async (key, label) => {
                await run(() => updateTab(key, { label }), "The sidebar group could not be renamed.");
              }}
            />
          )}
      </div>
    </PageShell>
  );
}
