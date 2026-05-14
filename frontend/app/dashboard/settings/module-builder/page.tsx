"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Boxes, Plus, RotateCcw, Save, Settings2, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { Textarea } from "@/components/ui/textarea";
import {
  useModuleBuilder,
  type CustomFieldType,
  type CustomModuleDefinition,
  type CustomModuleField,
  type CustomModuleFieldPayload,
} from "@/hooks/useModuleBuilder";
import { useSidebarTabsAdmin, type SidebarTab } from "@/hooks/admin/useModulesAdmin";

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

const FIELD_TYPE_BADGES: Record<CustomFieldType, string> = {
  text: "T",
  textarea: "¶",
  number: "#",
  currency: "$",
  date: "D",
  datetime: "DT",
  boolean: "⊙",
  email: "@",
  phone: "☎",
  url: "↗",
  single_select: "▼",
  multi_select: "☰",
};

type FieldDraft = CustomModuleFieldPayload & {
  options_text: string;
};

const emptyFieldDraft: FieldDraft = {
  label: "",
  field_type: "text",
  help_text: "",
  placeholder: "",
  is_required: false,
  is_unique: false,
  display_in_list: true,
  default_value: "",
  validation_json: null,
  sort_order: 0,
  is_active: true,
  options_text: "",
};

function fieldTypeLabel(value: string) {
  return value.replaceAll("_", " ");
}

function optionsFromText(value: string) {
  const options = value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  return options.length ? { options } : null;
}

function fieldPayloadFromDraft(draft: FieldDraft): CustomModuleFieldPayload {
  const supportsOptions = draft.field_type === "single_select" || draft.field_type === "multi_select";
  return {
    label: draft.label.trim(),
    field_type: draft.field_type,
    help_text: draft.help_text?.trim() || null,
    placeholder: draft.placeholder?.trim() || null,
    is_required: Boolean(draft.is_required),
    is_unique: draft.field_type === "multi_select" ? false : Boolean(draft.is_unique),
    display_in_list: Boolean(draft.display_in_list),
    default_value: draft.default_value === "" ? null : draft.default_value,
    validation_json: supportsOptions ? optionsFromText(draft.options_text) : null,
    sort_order: draft.sort_order,
    is_active: Boolean(draft.is_active),
  };
}

function FieldEditor({
  module,
  field,
  index,
  fieldCount,
  disabled,
  onUpdate,
  onDelete,
}: {
  module: CustomModuleDefinition;
  field: CustomModuleField;
  index: number;
  fieldCount: number;
  disabled: boolean;
  onUpdate: (moduleId: number, fieldId: number, payload: Partial<CustomModuleFieldPayload>) => Promise<unknown>;
  onDelete: (moduleId: number, fieldId: number) => Promise<unknown>;
}) {
  const [label, setLabel] = useState(field.label);
  const [helpText, setHelpText] = useState(field.help_text ?? "");
  const [placeholder, setPlaceholder] = useState(field.placeholder ?? "");
  const [defaultValue, setDefaultValue] = useState(field.default_value == null ? "" : String(field.default_value));
  const [optionsText, setOptionsText] = useState((field.validation_json?.options ?? []).join("\n"));
  const supportsOptions = field.field_type === "single_select" || field.field_type === "multi_select";

  async function save() {
    await onUpdate(module.id, field.id, {
      label: label.trim(),
      help_text: helpText.trim() || null,
      placeholder: placeholder.trim() || null,
      default_value: defaultValue === "" ? null : defaultValue,
      validation_json: supportsOptions ? optionsFromText(optionsText) : null,
    });
  }

  async function move(direction: -1 | 1) {
    const orderedFields = [...module.fields].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const nextIndex = index + direction;
    const target = orderedFields[nextIndex];
    if (!target) return;
    await Promise.all([
      onUpdate(module.id, field.id, { sort_order: target.sort_order }),
      onUpdate(module.id, target.id, { sort_order: field.sort_order }),
    ]);
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/80 p-3">
      <div className="grid gap-2 xl:grid-cols-[1fr_150px_120px]">
        <Input value={label} onChange={(event) => setLabel(event.target.value)} className="bg-neutral-950" />
        <div className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-300">
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-neutral-700 bg-neutral-950 px-1 font-mono text-[11px] text-neutral-200">
            {FIELD_TYPE_BADGES[field.field_type]}
          </span>
          {fieldTypeLabel(field.field_type)}
        </div>
        <div className="flex gap-1">
          <button type="button" disabled={disabled || index === 0} onClick={() => move(-1)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-neutral-800 text-neutral-400 hover:bg-neutral-900 disabled:opacity-40" aria-label="Move field up">
            <ArrowUp size={15} />
          </button>
          <button type="button" disabled={disabled || index === fieldCount - 1} onClick={() => move(1)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-neutral-800 text-neutral-400 hover:bg-neutral-900 disabled:opacity-40" aria-label="Move field down">
            <ArrowDown size={15} />
          </button>
          <button type="button" disabled={disabled} onClick={() => onDelete(module.id, field.id)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-900/70 text-red-200 hover:bg-red-950/30" aria-label="Delete field">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <Input value={placeholder} onChange={(event) => setPlaceholder(event.target.value)} placeholder="Placeholder" className="bg-neutral-950" />
        <Input value={helpText} onChange={(event) => setHelpText(event.target.value)} placeholder="Help text" className="bg-neutral-950" />
        <Input value={defaultValue} onChange={(event) => setDefaultValue(event.target.value)} placeholder="Default value" className="bg-neutral-950" />
      </div>

      {supportsOptions ? (
        <Textarea value={optionsText} onChange={(event) => setOptionsText(event.target.value)} placeholder="One option per line" className="mt-2 min-h-20 bg-neutral-950" />
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-neutral-300">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={field.is_required} disabled={disabled} onChange={(event) => onUpdate(module.id, field.id, { is_required: event.target.checked })} />
          Required
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={field.is_unique} disabled={disabled || field.field_type === "multi_select"} onChange={(event) => onUpdate(module.id, field.id, { is_unique: event.target.checked })} />
          Unique
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={field.display_in_list} disabled={disabled} onChange={(event) => onUpdate(module.id, field.id, { display_in_list: event.target.checked })} />
          List
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={field.is_active} disabled={disabled} onChange={(event) => onUpdate(module.id, field.id, { is_active: event.target.checked })} />
          Active
        </label>
        <Button type="button" size="sm" disabled={disabled || !label.trim()} onClick={save} className="ml-auto border border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800">
          <Save size={14} />
          Save
        </Button>
      </div>
    </div>
  );
}

function ModuleEditor({
  module,
  sidebarTabs,
  disabled,
  onUpdateModule,
  onDeleteModule,
  onRestoreModule,
  onAddField,
  onUpdateField,
  onDeleteField,
}: {
  module: CustomModuleDefinition;
  sidebarTabs: SidebarTab[];
  disabled: boolean;
  onUpdateModule: (moduleId: number, payload: Partial<Pick<CustomModuleDefinition, "name" | "description" | "is_active" | "sidebar_tab_key" | "display_name">>) => Promise<unknown>;
  onDeleteModule: (moduleId: number) => Promise<unknown>;
  onRestoreModule: (moduleId: number) => Promise<unknown>;
  onAddField: (moduleId: number, payload: CustomModuleFieldPayload) => Promise<unknown>;
  onUpdateField: (moduleId: number, fieldId: number, payload: Partial<CustomModuleFieldPayload>) => Promise<unknown>;
  onDeleteField: (moduleId: number, fieldId: number) => Promise<unknown>;
}) {
  const [name, setName] = useState(module.name);
  const [displayName, setDisplayName] = useState(module.display_name ?? "");
  const [description, setDescription] = useState(module.description ?? "");
  const [sidebarTabKey, setSidebarTabKey] = useState(module.sidebar_tab_key ?? "other");
  const [draft, setDraft] = useState<FieldDraft>(emptyFieldDraft);
  const placementOptions = useMemo(() => [HIDDEN_SIDEBAR_TAB, ...sidebarTabs], [sidebarTabs]);
  const orderedFields = useMemo(
    () => [...module.fields].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    [module.fields],
  );
  const deleted = Boolean(module.deleted_at);

  async function saveMetadata() {
    await onUpdateModule(module.id, {
      name: name.trim(),
      display_name: displayName.trim() || null,
      description: description.trim() || null,
      sidebar_tab_key: sidebarTabKey,
      is_active: module.is_active,
    });
  }

  async function addField(event: FormEvent) {
    event.preventDefault();
    if (!draft.label.trim()) return;
    await onAddField(module.id, {
      ...fieldPayloadFromDraft(draft),
      sort_order: orderedFields.length,
    });
    setDraft(emptyFieldDraft);
  }

  return (
    <div className={`rounded-md border p-4 ${deleted ? "border-red-900/70 bg-red-950/10" : "border-neutral-800 bg-neutral-950/70"}`}>
      <div className="grid gap-3 xl:grid-cols-[1fr_1fr_180px_auto]">
        <Input value={name} onChange={(event) => setName(event.target.value)} className="bg-neutral-950" disabled={deleted} />
        <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Sidebar display name" className="bg-neutral-950" disabled={deleted} />
        <Select value={sidebarTabKey} onValueChange={setSidebarTabKey} disabled={deleted}>
          <SelectTrigger className="bg-neutral-950">
            <SelectValue placeholder="Module group" />
          </SelectTrigger>
          <SelectContent>
            {placementOptions.map((tab) => (
              <SelectItem key={tab.key} value={tab.key}>
                {tab.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-10 bg-neutral-950" disabled={deleted} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={disabled || deleted || !name.trim()} onClick={saveMetadata} className="border border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800">
            <Save size={15} />
            Save
          </Button>
          {deleted ? (
            <Button type="button" disabled={disabled} onClick={() => onRestoreModule(module.id)} className="border border-emerald-800 bg-emerald-950/40 text-emerald-100 hover:bg-emerald-950/60">
              <RotateCcw size={15} />
              Restore
            </Button>
          ) : (
            <Button type="button" disabled={disabled} onClick={() => onDeleteModule(module.id)} className="border border-red-900/70 bg-red-950/30 text-red-100 hover:bg-red-950/50">
              <Trash2 size={15} />
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        <span>{module.key}</span>
        <span>{module.is_active && !deleted ? "Active" : "Inactive"}</span>
        {deleted ? <span className="text-red-200">Deleted</span> : null}
        {!deleted ? (
          <Link href={`/dashboard/custom/${module.key}`} className="ml-auto inline-flex items-center gap-1 text-neutral-200 underline-offset-4 hover:underline">
            <Settings2 size={13} />
            Open runtime
          </Link>
        ) : null}
      </div>

      {!deleted ? (
        <>
          <div className="mt-4 flex flex-col gap-3">
            {orderedFields.length ? (
              orderedFields.map((field, index) => (
                <FieldEditor
                  key={field.id}
                  module={module}
                  field={field}
                  index={index}
                  fieldCount={orderedFields.length}
                  disabled={disabled}
                  onUpdate={onUpdateField}
                  onDelete={onDeleteField}
                />
              ))
            ) : (
              <div className="rounded-md border border-dashed border-neutral-800 bg-neutral-950/50 px-4 py-8 text-center text-sm text-neutral-500">
                Add at least one field before using this module.
              </div>
            )}
          </div>

          <form onSubmit={addField} className="mt-4 grid gap-2 rounded-md border border-neutral-800 bg-neutral-950/60 p-3 lg:grid-cols-[1fr_170px_1fr_auto]">
            <Input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Field label" className="bg-neutral-950" />
            <Select value={draft.field_type} onValueChange={(value) => setDraft((current) => ({ ...current, field_type: value as CustomFieldType, is_unique: value === "multi_select" ? false : current.is_unique }))}>
              <SelectTrigger className="bg-neutral-950">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {FIELD_TYPE_BADGES[type]} {fieldTypeLabel(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input value={draft.placeholder ?? ""} onChange={(event) => setDraft((current) => ({ ...current, placeholder: event.target.value }))} placeholder="Placeholder" className="bg-neutral-950" />
            <Button type="submit" disabled={disabled || !draft.label.trim()} className="border border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800">
              <Plus size={15} />
              Add Field
            </Button>
            <Input value={draft.help_text ?? ""} onChange={(event) => setDraft((current) => ({ ...current, help_text: event.target.value }))} placeholder="Help text" className="bg-neutral-950" />
            <Input value={String(draft.default_value ?? "")} onChange={(event) => setDraft((current) => ({ ...current, default_value: event.target.value }))} placeholder="Default value" className="bg-neutral-950" />
            <Textarea value={draft.options_text} onChange={(event) => setDraft((current) => ({ ...current, options_text: event.target.value }))} placeholder="Select options, one per line" className="min-h-10 bg-neutral-950 lg:col-span-2" disabled={draft.field_type !== "single_select" && draft.field_type !== "multi_select"} />
            <div className="flex flex-wrap gap-3 text-sm text-neutral-300 lg:col-span-4">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.is_required} onChange={(event) => setDraft((current) => ({ ...current, is_required: event.target.checked }))} />
                Required
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.is_unique} disabled={draft.field_type === "multi_select"} onChange={(event) => setDraft((current) => ({ ...current, is_unique: event.target.checked }))} />
                Unique
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.display_in_list} onChange={(event) => setDraft((current) => ({ ...current, display_in_list: event.target.checked }))} />
                Show in list
              </label>
            </div>
          </form>
        </>
      ) : null}
    </div>
  );
}

function SidebarTabManager({
  tabs,
  disabled,
  onCreate,
  onRename,
}: {
  tabs: SidebarTab[];
  disabled: boolean;
  onCreate: (payload: { label: string }) => Promise<unknown>;
  onRename: (tabKey: string, payload: { label: string }) => Promise<unknown>;
}) {
  const [newLabel, setNewLabel] = useState("");
  const customTabs = tabs.filter((tab) => !tab.is_system);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!newLabel.trim()) return;
    await onCreate({ label: newLabel.trim() });
    setNewLabel("");
  }

  return (
    <section className="rounded-md border border-neutral-800 bg-neutral-950/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">Sidebar Groups</h2>
          <p className="mt-1 text-sm text-neutral-500">Create custom groups, then assign modules to them without changing internal module routes.</p>
        </div>
      </div>
      <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row">
        <Input value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder="New group name" className="bg-neutral-950" />
        <Button type="submit" disabled={disabled || !newLabel.trim()} className="border border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800">
          <Plus size={15} />
          Add Group
        </Button>
      </form>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {customTabs.length ? (
          customTabs.map((tab) => (
            <div key={tab.key} className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2">
              <Input
                defaultValue={tab.label}
                className="h-8 bg-neutral-950"
                onBlur={(event) => {
                  const label = event.target.value.trim();
                  if (label && label !== tab.label) {
                    void onRename(tab.key, { label });
                  }
                }}
              />
              <span className="shrink-0 text-xs text-neutral-600">{tab.key}</span>
            </div>
          ))
        ) : (
          <div className="rounded-md border border-dashed border-neutral-800 bg-neutral-950/50 px-4 py-5 text-sm text-neutral-500">
            No custom groups yet.
          </div>
        )}
      </div>
    </section>
  );
}

export default function ModuleBuilderPage() {
  const {
    modules,
    isLoading,
    createModule,
    updateModule,
    deleteModule,
    restoreModule,
    addField,
    updateField,
    deleteField,
    isSaving,
  } = useModuleBuilder();
  const {
    tabs: sidebarTabs,
    createTab,
    updateTab,
    isSaving: isSavingTabs,
  } = useSidebarTabsAdmin();
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [sidebarTabKey, setSidebarTabKey] = useState("other");
  const [error, setError] = useState<string | null>(null);
  const placementOptions = useMemo(() => [HIDDEN_SIDEBAR_TAB, ...sidebarTabs], [sidebarTabs]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Module builder action failed");
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await createModule({
        name: name.trim(),
        display_name: displayName.trim() || undefined,
        description: description.trim() || undefined,
        sidebar_tab_key: sidebarTabKey,
        fields: [{ label: "Name", field_type: "text", is_required: true, display_in_list: true }],
      });
      setName("");
      setDisplayName("");
      setDescription("");
      setSidebarTabKey("other");
    });
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Module Builder"
        description="Create tenant-specific modules, configure fields, and manage runtime availability through Lynk module controls."
      />

      <SidebarTabManager
        tabs={sidebarTabs}
        disabled={isSavingTabs}
        onCreate={(payload) => run(() => createTab(payload))}
        onRename={(tabKey, payload) => run(() => updateTab(tabKey, payload))}
      />

      <form onSubmit={create} className="grid gap-3 rounded-md border border-neutral-800 bg-neutral-950/70 p-4 xl:grid-cols-[1fr_1fr_180px_auto]">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Module name" className="bg-neutral-950" required />
        <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Sidebar display name" className="bg-neutral-950" />
        <Select value={sidebarTabKey} onValueChange={setSidebarTabKey}>
          <SelectTrigger className="bg-neutral-950">
            <SelectValue placeholder="Module group" />
          </SelectTrigger>
          <SelectContent>
            {placementOptions.map((tab) => (
              <SelectItem key={tab.key} value={tab.key}>
                {tab.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={isSaving || !name.trim()} className="border border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800">
          <Boxes size={15} />
          Create
        </Button>
        <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" className="min-h-10 bg-neutral-950 xl:col-span-4" />
      </form>

      {error ? <div className="rounded-md border border-red-900/70 bg-red-950/30 px-4 py-3 text-sm text-red-100">{error}</div> : null}

      <div className="rounded-md border border-neutral-800 bg-neutral-950/60">
        <Table>
          <TableHeader>
            <TableHeaderRow>
              <TableHead>Modules</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell className="py-10 text-center text-neutral-500">Loading modules...</TableCell>
              </TableRow>
            ) : modules.length === 0 ? (
              <TableRow>
                <TableCell className="py-10 text-center text-neutral-500">No custom modules yet.</TableCell>
              </TableRow>
            ) : (
              modules.map((module) => (
                <TableRow key={module.id}>
                  <TableCell>
                    <ModuleEditor
                      module={module}
                      sidebarTabs={sidebarTabs}
                      disabled={isSaving}
                      onUpdateModule={(moduleId, payload) => run(() => updateModule({ moduleId, payload }))}
                      onDeleteModule={(moduleId) => run(() => deleteModule(moduleId))}
                      onRestoreModule={(moduleId) => run(() => restoreModule(moduleId))}
                      onAddField={(moduleId, payload) => run(() => addField({ moduleId, payload }))}
                      onUpdateField={(moduleId, fieldId, payload) => run(() => updateField({ moduleId, fieldId, payload }))}
                      onDeleteField={(moduleId, fieldId) => run(() => deleteField({ moduleId, fieldId }))}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
