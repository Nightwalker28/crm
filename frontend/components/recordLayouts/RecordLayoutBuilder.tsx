"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Lock,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { RecordLayoutPreview } from "@/components/recordLayouts/RecordLayoutPreview";
import { RecordLayoutValidationPanel } from "@/components/recordLayouts/RecordLayoutValidationPanel";
import {
  addFieldToSection,
  addSection,
  definitionsEqual,
  moveField,
  moveFieldToSection,
  moveSection,
  placedFieldKeys,
  removeField,
  removeSection,
  setFieldRequiredOverride,
  setFieldVisible,
  setFieldWidth,
  updateSection,
} from "@/components/recordLayouts/recordLayoutDraft";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { PageToolbar } from "@/components/ui/PageToolbar";
import { Pill } from "@/components/ui/Pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/hooks/useConfirm";
import {
  RecordLayoutAdminError,
  previewRecordLayout,
  useRecordLayoutMutations,
  type RecordLayoutAdminState,
  type RecordLayoutCatalogField,
  type RecordLayoutDefinition,
  type RecordLayoutFieldDefinition,
  type RecordLayoutSectionDefinition,
} from "@/hooks/useRecordLayoutAdmin";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import type { RecordLayoutRegion, RecordLayoutWidth } from "@/lib/contracts/recordLayouts";

/** Long enough that typing a section name is one request, short enough to feel immediate. */
const PREVIEW_DEBOUNCE_MS = 400;

function friendlyFieldType(value: string) {
  return value.replaceAll("_", " ");
}

function orderedSections(definition: RecordLayoutDefinition) {
  return definition.sections.slice().sort((left, right) => left.position - right.position);
}

function orderedFields(section: RecordLayoutSectionDefinition) {
  return section.fields.slice().sort((left, right) => left.position - right.position);
}

function FieldRow({
  field,
  catalogField,
  index,
  fieldCount,
  section,
  sections,
  onChange,
}: {
  field: RecordLayoutFieldDefinition;
  catalogField: RecordLayoutCatalogField | undefined;
  index: number;
  fieldCount: number;
  section: RecordLayoutSectionDefinition;
  sections: RecordLayoutSectionDefinition[];
  onChange: (update: (definition: RecordLayoutDefinition) => RecordLayoutDefinition) => void;
}) {
  const label = catalogField?.label ?? field.field_key;
  // A field the tenant removed from Field Config, or a stale key, still has to be editable
  // here so the administrator can take it out of the layout.
  const isUnknown = !catalogField;
  const isRequired = Boolean(catalogField?.required) || field.required_override === true;
  const requiredLocked = Boolean(catalogField?.required);

  return (
    <div
      className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3"
      data-layout-builder-field={field.field_key}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-copy-primary">{label}</span>
        {catalogField?.field_source === "custom_field" ? <Pill>Custom</Pill> : null}
        {isRequired ? (
          <Pill bg="bg-state-warning-muted" text="text-state-warning" border="border-state-warning/40">
            {requiredLocked ? <Lock className="mr-1 inline h-3 w-3" aria-hidden="true" /> : null}Required
          </Pill>
        ) : null}
        {!field.visible ? (
          <Pill bg="bg-surface" text="text-copy-muted" border="border-line-default">Hidden</Pill>
        ) : null}
        {catalogField && !catalogField.enabled ? (
          <Pill bg="bg-state-danger-muted" text="text-state-danger" border="border-state-danger/40">
            Off in Field Config
          </Pill>
        ) : null}
        {isUnknown ? (
          <Pill bg="bg-state-danger-muted" text="text-state-danger" border="border-state-danger/40">Unknown field</Pill>
        ) : null}
      </div>
      <div className="mt-1 text-p-xs text-copy-muted">
        {field.field_key}
        {catalogField ? ` · ${friendlyFieldType(catalogField.field_type)}` : ""}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select
          value={field.width}
          onValueChange={(width) => onChange((definition) => setFieldWidth(definition, field.field_key, width as RecordLayoutWidth))}
        >
          <SelectTrigger size="sm" className="w-32" aria-label={`Width for ${label}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="full">Full width</SelectItem>
            <SelectItem value="half">Half width</SelectItem>
          </SelectContent>
        </Select>

        <Button
          type="button"
          size="sm"
          variant={isRequired ? "secondary" : "outline"}
          aria-pressed={isRequired}
          disabled={requiredLocked}
          title={requiredLocked ? catalogField?.locked_reason ?? "This field is always required." : undefined}
          onClick={() =>
            onChange((definition) =>
              setFieldRequiredOverride(definition, field.field_key, field.required_override !== true),
            )
          }
        >
          Required
        </Button>

        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={field.visible ? `Hide ${label} without removing it` : `Show ${label}`}
          title={field.visible ? "Hide (keeps the field in the layout)" : "Show"}
          onClick={() => onChange((definition) => setFieldVisible(definition, field.field_key, !field.visible))}
        >
          {field.visible ? <EyeOff /> : <Eye />}
        </Button>

        <div className="ml-auto flex items-center gap-1">
          {sections.length > 1 ? (
            <Select
              value={section.id}
              onValueChange={(sectionId) =>
                onChange((definition) => moveFieldToSection(definition, field.field_key, sectionId))
              }
            >
              <SelectTrigger size="sm" className="w-40" aria-label={`Section for ${label}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sections.map((option) => (
                  <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Move ${label} up`}
            title="Move up"
            disabled={index === 0}
            onClick={() => onChange((definition) => moveField(definition, section.id, field.field_key, "up"))}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Move ${label} down`}
            title="Move down"
            disabled={index === fieldCount - 1}
            onClick={() => onChange((definition) => moveField(definition, section.id, field.field_key, "down"))}
          >
            <ArrowDown />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="dangerGhost"
            aria-label={`Remove ${label} from the layout`}
            title="Remove from layout"
            onClick={() => onChange((definition) => removeField(definition, field.field_key))}
          >
            <X />
          </Button>
        </div>
      </div>
    </div>
  );
}

function SectionCard({
  section,
  index,
  sectionCount,
  sections,
  catalog,
  onChange,
}: {
  section: RecordLayoutSectionDefinition;
  index: number;
  sectionCount: number;
  sections: RecordLayoutSectionDefinition[];
  catalog: Map<string, RecordLayoutCatalogField>;
  onChange: (update: (definition: RecordLayoutDefinition) => RecordLayoutDefinition) => void;
}) {
  const fields = orderedFields(section);

  return (
    <Card className="p-4" data-layout-builder-section={section.id}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={section.label}
          maxLength={150}
          aria-label={`Section name for ${section.label}`}
          className="w-full sm:w-64"
          onChange={(event) => onChange((definition) => updateSection(definition, section.id, { label: event.target.value }))}
        />
        <Select
          value={section.region}
          onValueChange={(region) =>
            onChange((definition) => updateSection(definition, section.id, { region: region as RecordLayoutRegion }))
          }
        >
          <SelectTrigger size="sm" className="w-32" aria-label={`Region for ${section.label}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="main">Main</SelectItem>
            <SelectItem value="sidebar">Sidebar</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant={section.collapsed_by_default ? "secondary" : "ghost"}
          aria-pressed={section.collapsed_by_default}
          onClick={() =>
            onChange((definition) =>
              updateSection(definition, section.id, { collapsed_by_default: !section.collapsed_by_default }),
            )
          }
        >
          Collapsed
        </Button>

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Move section ${section.label} up`}
            title="Move section up"
            disabled={index === 0}
            onClick={() => onChange((definition) => moveSection(definition, section.id, "up"))}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Move section ${section.label} down`}
            title="Move section down"
            disabled={index === sectionCount - 1}
            onClick={() => onChange((definition) => moveSection(definition, section.id, "down"))}
          >
            <ArrowDown />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="dangerGhost"
            aria-label={`Delete section ${section.label}`}
            title={sectionCount <= 1 ? "A layout needs at least one section." : "Delete section"}
            disabled={sectionCount <= 1}
            onClick={() => onChange((definition) => removeSection(definition, section.id))}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {fields.length ? (
          fields.map((field, fieldIndex) => (
            <FieldRow
              key={field.field_key}
              field={field}
              catalogField={catalog.get(field.field_key)}
              index={fieldIndex}
              fieldCount={fields.length}
              section={section}
              sections={sections}
              onChange={onChange}
            />
          ))
        ) : (
          <p className="rounded-[var(--radius-control)] border border-dashed border-line-default px-3 py-4 text-p-sm text-copy-muted">
            No fields yet. Add one from Available fields.
          </p>
        )}
      </div>
    </Card>
  );
}

export function RecordLayoutBuilder({ state, onReload }: { state: RecordLayoutAdminState; onReload: () => void }) {
  const { confirm } = useConfirm();
  const { publish, reset } = useRecordLayoutMutations(state.module_key, state.surface);

  // `state.definition` is the published baseline. The page remounts this component whenever
  // the server copy changes (see its `key`), so the baseline never drifts from the draft.
  const baseline = state.definition;
  const [draft, setDraft] = useState<RecordLayoutDefinition>(baseline);
  const [newSectionLabel, setNewSectionLabel] = useState("");
  const [preferredSectionId, setPreferredSectionId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const sections = useMemo(() => orderedSections(draft), [draft]);
  // Derived, not stored: deleting the chosen section falls back to the first one with no effect.
  const targetSectionId = sections.some((section) => section.id === preferredSectionId)
    ? (preferredSectionId as string)
    : sections[0]?.id ?? "";

  const isDirty = !definitionsEqual(draft, baseline);
  useUnsavedChangesGuard(isDirty);

  const [debouncedDraft, setDebouncedDraft] = useState(draft);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedDraft(draft), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft]);

  const previewQuery = useQuery({
    queryKey: ["record-layout-preview", state.module_key, state.surface, JSON.stringify(debouncedDraft)],
    queryFn: () => previewRecordLayout(state.module_key, state.surface, debouncedDraft),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const isPreviewStale = previewQuery.isFetching || JSON.stringify(draft) !== JSON.stringify(debouncedDraft);
  const validation = previewQuery.data?.validation ?? (isDirty ? null : state.validation);
  const catalog = useMemo(
    () => new Map(state.available_fields.map((field) => [field.field_key, field])),
    [state.available_fields],
  );
  const placed = placedFieldKeys(draft);
  const availableFields = state.available_fields.filter((field) => !placed.has(field.field_key));

  function applyDraft(update: (definition: RecordLayoutDefinition) => RecordLayoutDefinition) {
    setDraft((current) => update(current));
  }

  async function handlePublish() {
    if (!validation?.valid) return;
    try {
      await publish.mutateAsync({ definition: draft, expectedVersion: state.expected_version });
      setConflict(null);
      toast.success("Layout published. Everyone in this workspace sees it now.");
    } catch (error) {
      if (error instanceof RecordLayoutAdminError && error.kind === "conflict") {
        setConflict(error.message);
        return;
      }
      if (error instanceof RecordLayoutAdminError && error.kind === "validation") {
        toast.error(error.errors[0] ?? error.message);
        return;
      }
      toast.error(error instanceof Error ? error.message : "The layout could not be published.");
    }
  }

  async function handleReset() {
    const confirmed = await confirm({
      title: "Reset to the system default?",
      description:
        "The workspace layout is deleted and Quick Create goes back to the Lynk default for everyone. This cannot be undone.",
      confirmLabel: "Reset layout",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      await reset.mutateAsync();
      toast.success("Layout reset to the system default.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The layout could not be reset.");
    }
  }

  const isBusy = publish.isPending || reset.isPending;

  return (
    <div className="flex flex-col gap-5">
      <PageToolbar
        context={
          <span>
            Leads · Quick Create ·{" "}
            {state.source === "tenant" ? `Workspace layout (v${state.version})` : "System default"}
            {isDirty ? " · Unsaved changes" : ""}
          </span>
        }
      >
        <Button type="button" variant="ghost" disabled={!isDirty || isBusy} onClick={() => setDraft(baseline)}>
          <Undo2 />Discard changes
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={state.source !== "tenant" || isBusy}
          title={state.source === "tenant" ? undefined : "This workspace already uses the system default."}
          onClick={() => void handleReset()}
        >
          <RotateCcw />Reset to default
        </Button>
        <Button type="button" disabled={!isDirty || !validation?.valid || isBusy} onClick={() => void handlePublish()}>
          Publish
        </Button>
      </PageToolbar>

      {conflict ? (
        <Card className="border-state-warning/40 bg-state-warning-muted p-4" role="alert">
          <p className="text-sm font-semibold text-copy-primary">{conflict}</p>
          <Button className="mt-3" variant="outline" onClick={onReload}>Reload layout</Button>
        </Card>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,1fr)]">
        <div className="grid min-w-0 gap-4">
          {sections.map((section, index) => (
            <SectionCard
              key={section.id}
              section={section}
              index={index}
              sectionCount={sections.length}
              sections={sections}
              catalog={catalog}
              onChange={applyDraft}
            />
          ))}

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-copy-primary">Add a section</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <Input
                value={newSectionLabel}
                maxLength={150}
                placeholder="Section name"
                aria-label="New section name"
                className="w-full sm:w-64"
                onChange={(event) => setNewSectionLabel(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!newSectionLabel.trim()}
                onClick={() => {
                  applyDraft((definition) => addSection(definition, newSectionLabel));
                  setNewSectionLabel("");
                }}
              >
                <Plus />Add section
              </Button>
            </div>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-copy-primary">Validation</h2>
            <div className="mt-3">
              <RecordLayoutValidationPanel validation={validation} isChecking={isPreviewStale} />
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-copy-primary">Available fields</h2>
            <p className="mt-1 text-p-xs text-copy-muted">
              Fields not on the layout yet. Labels and types come from Field Config.
            </p>
            {sections.length > 1 ? (
              <div className="mt-3">
                <Select value={targetSectionId} onValueChange={setPreferredSectionId}>
                  <SelectTrigger size="sm" className="w-full" aria-label="Section to add fields to">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((section) => (
                      <SelectItem key={section.id} value={section.id}>Add to {section.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="mt-3 space-y-2">
              {availableFields.length ? (
                availableFields.map((field) => (
                  <div
                    key={field.field_key}
                    className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-copy-primary">{field.label}</span>
                        {field.field_source === "custom_field" ? <Pill>Custom</Pill> : null}
                        {!field.enabled ? (
                          <Pill bg="bg-state-danger-muted" text="text-state-danger" border="border-state-danger/40">
                            Off in Field Config
                          </Pill>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-p-xs text-copy-muted">{friendlyFieldType(field.field_type)}</div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!targetSectionId}
                      aria-label={`Add ${field.label} to the layout`}
                      onClick={() => applyDraft((definition) => addFieldToSection(definition, targetSectionId, field.field_key))}
                    >
                      <Plus />Add
                    </Button>
                  </div>
                ))
              ) : (
                <EmptyState title="Every field is on the layout" description="Remove one to make it available again." />
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-copy-primary">Preview</h2>
        <div className="mt-3">
          <RecordLayoutPreview layout={previewQuery.data?.resolved ?? null} isStale={isPreviewStale} />
        </div>
      </Card>
    </div>
  );
}
