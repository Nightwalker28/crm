"use client";

import { useMemo, useState } from "react";
import { BadgePercent, Plus } from "lucide-react";
import { toast } from "sonner";

import { ActionBar } from "@/components/ui/ActionBar";
import { StatusValue } from "@/components/ui/StatusValue";
import { PageShell } from "@/components/ui/PageShell";
import { isForbiddenError } from "@/lib/api";
import { SETTINGS_ROUTES } from "@/lib/routes";
import { SegmentedBoolean } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/button";
import { EmptyValue } from "@/components/ui/EmptyValue";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RecordTable } from "@/components/ui/RecordTable";
import { RequiredMark } from "@/components/ui/RequiredMark";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/hooks/useConfirm";
import { useCustomerGroupActions, useCustomerGroups, type CustomerGroup } from "@/hooks/useClientPortal";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

function formatDiscount(type: string, value?: string | number | null) {
  if (value == null || type === "none") return "No discount rule";
  if (type === "percent") return `${value}%`;
  if (type === "fixed") return String(value);
  return `${type}: ${value}`;
}

type SortState = { key: "name" | "group_key" | "discount_type" | "is_active" | "is_default"; direction: "asc" | "desc" };
type CustomerGroupDraft = {
  group_key: string;
  name: string;
  description: string;
  discount_type: string;
  discount_value: string;
  is_default: boolean;
  is_active: boolean;
};
type DraftErrors = Partial<Record<"name" | "group_key" | "discount_value", string>>;

const EMPTY_DRAFT: CustomerGroupDraft = {
  group_key: "",
  name: "",
  description: "",
  discount_type: "none",
  discount_value: "",
  is_default: false,
  is_active: true,
};

export default function CustomerGroupsSettingsPage() {
  const { confirm } = useConfirm();
  const groups = useCustomerGroups();
  const { createGroup, updateGroup, isSaving } = useCustomerGroupActions();
  const [editingGroup, setEditingGroup] = useState<CustomerGroup | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "asc" });
  const [draft, setDraft] = useState<CustomerGroupDraft>({ ...EMPTY_DRAFT });
  const [draftErrors, setDraftErrors] = useState<DraftErrors>({});
  const [saveError, setSaveError] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  const isDirty = useMemo(() => {
    if (!editingGroup) {
      return Object.entries(EMPTY_DRAFT).some(([key, value]) => draft[key as keyof CustomerGroupDraft] !== value);
    }
    return (
      draft.name !== editingGroup.name ||
      draft.group_key !== editingGroup.group_key ||
      draft.description !== (editingGroup.description ?? "") ||
      draft.discount_type !== editingGroup.discount_type ||
      draft.discount_value !== (editingGroup.discount_value == null ? "" : String(editingGroup.discount_value)) ||
      draft.is_default !== editingGroup.is_default ||
      draft.is_active !== editingGroup.is_active
    );
  }, [draft, editingGroup]);

  useUnsavedChangesGuard(isDirty, isSaving);

  function populateDraft(group: CustomerGroup) {
    setEditingGroup(group);
    setDraftErrors({});
    setSaveError(false);
    setDraft({
      group_key: group.group_key,
      name: group.name,
      description: group.description ?? "",
      discount_type: group.discount_type,
      discount_value: group.discount_value == null ? "" : String(group.discount_value),
      is_default: group.is_default,
      is_active: group.is_active,
    });
    setEditorOpen(true);
  }

  async function editGroup(group: CustomerGroup) {
    if (isDirty) {
      const confirmed = await confirm({
        title: "Discard unsaved customer group changes?",
        description: "The current draft will be replaced with the selected customer group.",
        confirmLabel: "Discard changes",
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    populateDraft(group);
  }

  function resetDraft() {
    setEditingGroup(null);
    setDraft({ ...EMPTY_DRAFT });
    setDraftErrors({});
    setSaveError(false);
  }

  async function closeEditor() {
    if (isDirty) {
      const confirmed = await confirm({
        title: "Discard customer group changes?",
        description: "The current customer group draft will be cleared.",
        confirmLabel: "Discard changes",
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    resetDraft();
    setEditorOpen(false);
  }

  async function startNewGroup() {
    if (isDirty) {
      const confirmed = await confirm({
        title: "Discard unsaved customer group changes?",
        description: "Starting a new group will replace the current draft.",
        confirmLabel: "Discard changes",
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    resetDraft();
    setEditorOpen(true);
  }

  function handleEditorOpenChange(open: boolean) {
    if (open) {
      setEditorOpen(true);
      return;
    }
    void closeEditor();
  }

  function validateDraft() {
    const errors: DraftErrors = {};
    const normalizedKey = draft.group_key.trim().toLowerCase().replace(/ /g, "_");
    if (!draft.name.trim()) errors.name = "Enter a customer group name.";
    if (!normalizedKey) {
      errors.group_key = "Enter a customer group key.";
    } else if (!/^[a-z0-9_]+$/.test(normalizedKey)) {
      errors.group_key = "Use letters, numbers, spaces, or underscores only.";
    }
    if (draft.discount_type !== "none") {
      const value = Number(draft.discount_value);
      if (!draft.discount_value.trim()) {
        errors.discount_value = "Enter a discount value.";
      } else if (!Number.isFinite(value) || value < 0) {
        errors.discount_value = "Enter a discount value of zero or more.";
      } else if (draft.discount_type === "percent" && value > 100) {
        errors.discount_value = "Percent discounts cannot exceed 100.";
      }
    }
    setDraftErrors(errors);
    const firstError = Object.keys(errors)[0];
    if (firstError) document.getElementById(`customer-group-${firstError.replace("_", "-")}`)?.focus();
    return Object.keys(errors).length === 0;
  }

  async function saveGroup() {
    if (!validateDraft()) return;
    const makesDefault = draft.is_default && !editingGroup?.is_default;
    const deactivatesGroup = Boolean(editingGroup?.is_active && !draft.is_active);
    if (makesDefault || deactivatesGroup) {
      const confirmed = await confirm({
        title: makesDefault && deactivatesGroup ? "Apply customer group changes?" : makesDefault ? "Change the default customer group?" : "Deactivate this customer group?",
        description: [
          makesDefault ? `"${draft.name.trim()}" will replace the current tenant default group.` : null,
          deactivatesGroup ? `"${draft.name.trim()}" will be marked inactive. Existing record assignments and historical data remain.` : null,
        ].filter(Boolean).join(" "),
        confirmLabel: makesDefault && deactivatesGroup ? "Apply changes" : makesDefault ? "Change default" : "Deactivate group",
        variant: deactivatesGroup ? "destructive" : "default",
      });
      if (!confirmed) return;
    }
    const payload = {
      group_key: draft.group_key.trim(),
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      discount_type: draft.discount_type,
      discount_value: draft.discount_type === "none" || draft.discount_value === "" ? null : Number(draft.discount_value),
      is_default: draft.is_default,
      is_active: draft.is_active,
    };
    try {
      setSaveError(false);
      if (editingGroup) {
        await updateGroup({
          groupId: editingGroup.id,
          payload: {
            name: payload.name,
            description: payload.description,
            discount_type: payload.discount_type,
            discount_value: payload.discount_value,
            is_default: payload.is_default,
            is_active: payload.is_active,
          },
        });
        toast.success("Customer group updated.");
      } else {
        await createGroup(payload);
        toast.success("Customer group created.");
      }
      resetDraft();
      setEditorOpen(false);
    } catch {
      setSaveError(true);
      toast.error("Customer group changes could not be saved.");
    }
  }

  const visibleGroups = useMemo(() => {
    const searchText = search.trim().toLowerCase();
    return [...(groups.data ?? [])]
      .filter((group) => {
        if (!searchText) return true;
        return [group.name, group.group_key, group.description ?? "", group.discount_type]
          .some((value) => value.toLowerCase().includes(searchText));
      })
      .sort((left, right) => {
        const leftValue = left[sort.key];
        const rightValue = right[sort.key];
        const result = typeof leftValue === "boolean" || typeof rightValue === "boolean"
          ? Number(leftValue) - Number(rightValue)
          : String(leftValue ?? "").localeCompare(String(rightValue ?? ""));
        return sort.direction === "asc" ? result : -result;
      });
  }, [groups.data, search, sort]);

  return (
    <PageShell
      variant="settings"
      title="Customer groups"
      description="Segments used by contacts, accounts, and the client portal."
      actions={<Button type="button" onClick={() => void startNewGroup()}><Plus />Create customer group</Button>}
      isPermissionDenied={isForbiddenError(groups.error)}
      backHref={SETTINGS_ROUTES.root}
      backLabel="Back to settings"
    >
      <EditorPanel
        open={editorOpen}
        onOpenChange={handleEditorOpenChange}
        title={editingGroup ? "Edit customer group" : "Create customer group"}
        description="Discounts apply to authenticated customer context; public catalog pricing remains unchanged."
        closeLabel="Close customer group editor"
        onSubmit={() => void saveGroup()}
        status={saveError
          ? <span role="alert" className="text-state-danger">Customer group changes could not be saved. Check the group key and discount, then try again.</span>
          : isDirty ? "Unsaved changes"
          : editingGroup ? null
          : "Name the group and give it a key to create it."}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => void closeEditor()} disabled={isSaving}>Cancel</Button>
            <Button type="submit" disabled={isSaving || !draft.name.trim() || !draft.group_key.trim()}>
              {isSaving ? "Saving\u2026" : editingGroup ? "Save group" : "Create group"}
            </Button>
          </>
        )}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="customer-group-name">Name <RequiredMark /></FieldLabel>
            <Input
        id="customer-group-name"
        value={draft.name}
        onChange={(event) => {
          setDraft((current) => ({ ...current, name: event.target.value }));
          setDraftErrors((current) => ({ ...current, name: undefined }));
        }}
        maxLength={120}
        aria-invalid={Boolean(draftErrors.name)}
        aria-describedby={draftErrors.name ? "customer-group-name-error" : undefined}
        required
            />
            {draftErrors.name ? <FieldError id="customer-group-name-error">{draftErrors.name}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="customer-group-group-key">Key <RequiredMark /></FieldLabel>
            <Input
        id="customer-group-group-key"
        value={draft.group_key}
        onChange={(event) => {
          setDraft((current) => ({ ...current, group_key: event.target.value }));
          setDraftErrors((current) => ({ ...current, group_key: undefined }));
        }}
        maxLength={80}
        disabled={Boolean(editingGroup)}
        aria-invalid={Boolean(draftErrors.group_key)}
        aria-describedby={draftErrors.group_key ? "customer-group-key-error" : "customer-group-key-description"}
        required
            />
            <FieldDescription id="customer-group-key-description">Letters, numbers, spaces, and underscores; spaces are stored as underscores.</FieldDescription>
            {draftErrors.group_key ? <FieldError id="customer-group-key-error">{draftErrors.group_key}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="customer-group-discount-type">Discount type</FieldLabel>
            <Select
        value={draft.discount_type}
        onValueChange={(value) => {
          setDraft((current) => ({ ...current, discount_type: value }));
          setDraftErrors((current) => ({ ...current, discount_value: undefined }));
        }}
            >
        <SelectTrigger id="customer-group-discount-type" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No discount</SelectItem>
          <SelectItem value="percent">Percent</SelectItem>
          <SelectItem value="fixed">Fixed</SelectItem>
        </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="customer-group-discount-value">Discount value {draft.discount_type !== "none" ? <RequiredMark /> : null}</FieldLabel>
            <Input
        id="customer-group-discount-value"
        type="number"
        min="0"
        max={draft.discount_type === "percent" ? "100" : undefined}
        step="0.01"
        value={draft.discount_value}
        onChange={(event) => {
          setDraft((current) => ({ ...current, discount_value: event.target.value }));
          setDraftErrors((current) => ({ ...current, discount_value: undefined }));
        }}
        disabled={draft.discount_type === "none"}
        aria-invalid={Boolean(draftErrors.discount_value)}
        aria-describedby={draftErrors.discount_value ? "customer-group-discount-value-error" : undefined}
            />
            {draftErrors.discount_value ? <FieldError id="customer-group-discount-value-error">{draftErrors.discount_value}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="customer-group-description">Description</FieldLabel>
            <Textarea id="customer-group-description" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
          </Field>
        </FieldGroup>
        <FieldGroup className="mt-6 border-t border-line-subtle pt-6">
          <Field>
            <FieldLabel>Default assignment</FieldLabel>
            <SegmentedBoolean
              aria-label="Default assignment"
              value={draft.is_default}
              onValueChange={(is_default) => setDraft((current) => ({ ...current, is_default }))}
              trueLabel="Default group"
              falseLabel="Not default"
            />
            <FieldDescription>Use the default group when a customer has no explicit group assignment.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Group availability</FieldLabel>
            <SegmentedBoolean
              aria-label="Group availability"
              value={draft.is_active}
              onValueChange={(is_active) => setDraft((current) => ({ ...current, is_active }))}
              trueLabel="Active"
              falseLabel="Inactive"
            />
            <FieldDescription>Active groups can be assigned and used for customer pricing.</FieldDescription>
          </Field>
        </FieldGroup>
      </EditorPanel>

      {/* R10: a hand-assembled `Table` with three page-local states — a loading row that
          said "Loading customer groups...", an error block inside a `colSpan={6}` cell, and
          an `EmptyState` that had to know the column count. `RecordTable` owns all four,
          and the header row above it is the toolbar the list language already has. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchBar value={search} onChange={setSearch} placeholder="Search customer groups" className="sm:max-w-sm" />
        <ActionBar size="sm">
          <span className="text-sm text-copy-muted">{groups.isLoading ? "Loading…" : `${visibleGroups.length} of ${groups.data?.length ?? 0} groups`}</span>
          <Button type="button" onClick={() => void startNewGroup()}><Plus />Create group</Button>
        </ActionBar>
      </div>
      <RecordTable
        label="Customer groups"
        columns={[
          {
            key: "name",
            label: "Group",
            size: "lg",
            sortable: true,
            render: (group) => (
              <>
                <div className="font-medium text-copy-primary">{group.name}</div>
                {group.description ? <div className="mt-1 text-xs text-copy-muted">{group.description}</div> : null}
              </>
            ),
          },
          { key: "group_key", label: "Key", sortable: true, render: (group) => <span className="text-xs text-copy-muted">{group.group_key}</span> },
          { key: "discount_type", label: "Discount", sortable: true, render: (group) => formatDiscount(group.discount_type, group.discount_value) },
          {
            key: "is_active",
            label: "Status",
            size: "sm",
            sortable: true,
            render: (group) => <StatusValue status={{ tone: group.is_active ? "success" : "neutral", label: group.is_active ? "Active" : "Inactive" }} />,
          },
          {
            key: "is_default",
            label: "Default",
            size: "sm",
            sortable: true,
            render: (group) => (group.is_default ? <StatusValue status={{ tone: "neutral", label: "Default" }} /> : <EmptyValue />),
          },
        ]}
        rows={visibleGroups}
        rowKey={(group) => group.id}
        onOpenRow={(group) => void editGroup(group)}
        rowLabel={(group) => `Edit ${group.name}`}
        sort={{ column: sort.key, direction: sort.direction }}
        onSortChange={(next) => setSort({ key: next.column as SortState["key"], direction: next.direction })}
        isLoading={groups.isLoading}
        isRefreshing={groups.isFetching && !groups.isLoading}
        isPermissionDenied={isForbiddenError(groups.error)}
        hasError={Boolean(groups.error) && !isForbiddenError(groups.error)}
        onRetry={() => void groups.refetch()}
        errorState={{ title: "Customer groups could not be loaded" }}
        hasActiveFilters={Boolean(search.trim())}
        onClearFilters={() => setSearch("")}
        filteredEmptyState={{
          icon: BadgePercent,
          title: "No matching groups",
          description: "Adjust the search to find another customer group.",
        }}
        emptyState={{
          icon: BadgePercent,
          title: "No customer groups yet",
          description: "Create a group to segment contacts and accounts.",
          action: <Button type="button" onClick={() => void startNewGroup()}><Plus />Create group</Button>,
        }}
        rowActions={(group) => (
          <Button type="button" size="sm" variant="outline" onClick={() => void editGroup(group)}>Edit</Button>
        )}
      />
    </PageShell>
  );
}
