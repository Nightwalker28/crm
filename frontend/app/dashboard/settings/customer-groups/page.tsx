"use client";

import { FormEvent, useMemo, useState } from "react";
import { BadgePercent, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/ui/PageShell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Pill } from "@/components/ui/Pill";
import { RequiredMark } from "@/components/ui/RequiredMark";
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
import { SortableHead, Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
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

function nextSort(current: SortState, key: SortState["key"]): SortState {
  return current.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: "asc" };
}

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

  async function saveGroup(event: FormEvent) {
    event.preventDefault();
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
      title="Customer Groups"
      description="Segments used by contacts, accounts, and the client portal."
      actions={<Button type="button" onClick={() => void startNewGroup()}><Plus />New customer group</Button>}
    >
      <Sheet open={editorOpen} onOpenChange={handleEditorOpenChange}>
        <SheetPortal>
          <SheetOverlay className="fixed inset-0 z-40 bg-overlay" />
          <SheetContent side="right" className="z-50 flex h-full w-full max-w-[34rem] flex-col border-l border-line-default bg-surface-raised outline-none">
            <form onSubmit={saveGroup} className="flex min-h-0 flex-1 flex-col">
              <SheetHeader className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
                <div>
                  <SheetTitle className="text-lg font-semibold text-copy-primary">{editingGroup ? "Edit customer group" : "Create customer group"}</SheetTitle>
                  <SheetDescription className="mt-1 text-sm text-copy-muted">
                    Discounts apply to authenticated customer context; public catalog pricing remains unchanged.
                  </SheetDescription>
                </div>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Close customer group editor" onClick={() => void closeEditor()}><X /></Button>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {saveError ? (
            <div role="alert" className="rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-secondary">
              Customer group changes could not be saved. Check the group key and discount, then try again.
            </div>
          ) : null}
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
              <FieldLabel htmlFor="customer-group-discount-type">Discount Type</FieldLabel>
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
              <FieldLabel htmlFor="customer-group-discount-value">Discount Value {draft.discount_type !== "none" ? <RequiredMark /> : null}</FieldLabel>
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
                <FieldGroup className="mt-5 border-t border-line-subtle pt-5">
                  <Field>
                    <FieldLabel>Default assignment</FieldLabel>
                    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Default assignment">
                      <Button
                        type="button"
                        variant={draft.is_default ? "secondary" : "outline"}
                        aria-pressed={draft.is_default}
                        onClick={() => setDraft((current) => ({ ...current, is_default: true }))}
                      >
                        Default group
                      </Button>
                      <Button
                        type="button"
                        variant={!draft.is_default ? "secondary" : "outline"}
                        aria-pressed={!draft.is_default}
                        onClick={() => setDraft((current) => ({ ...current, is_default: false }))}
                      >
                        Not default
                      </Button>
                    </div>
                    <FieldDescription>Use the default group when a customer has no explicit group assignment.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Group availability</FieldLabel>
                    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Group availability">
                      <Button
                        type="button"
                        variant={draft.is_active ? "secondary" : "outline"}
                        aria-pressed={draft.is_active}
                        onClick={() => setDraft((current) => ({ ...current, is_active: true }))}
                      >
                        Active
                      </Button>
                      <Button
                        type="button"
                        variant={!draft.is_active ? "secondary" : "outline"}
                        aria-pressed={!draft.is_active}
                        onClick={() => setDraft((current) => ({ ...current, is_active: false }))}
                      >
                        Inactive
                      </Button>
                    </div>
                    <FieldDescription>Active groups can be assigned and used for customer pricing.</FieldDescription>
                  </Field>
                </FieldGroup>
              </div>
              <SheetFooter className="flex flex-col gap-3 border-t border-line-subtle bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <span className={`text-sm ${isDirty ? "text-state-warning" : "text-state-success"}`}>{isDirty ? "Unsaved changes" : "All changes saved"}</span>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => void closeEditor()} disabled={isSaving}>Cancel</Button>
                  <Button type="submit" disabled={isSaving || !draft.name.trim() || !draft.group_key.trim()}>
                    {isSaving ? "Saving..." : editingGroup ? "Save Group" : "Create Group"}
                  </Button>
                </div>
              </SheetFooter>
            </form>
          </SheetContent>
        </SheetPortal>
      </Sheet>

      <ModuleTableShell>
        <div className="flex flex-col gap-3 border-b border-line-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchBar value={search} onChange={setSearch} placeholder="Search customer groups" className="sm:max-w-sm" />
          <div className="flex items-center gap-3">
            <span className="text-sm text-copy-muted">{groups.isLoading ? "Loading..." : `${visibleGroups.length} of ${groups.data?.length ?? 0} groups`}</span>
            <Button type="button" size="sm" onClick={() => void startNewGroup()}><Plus />New group</Button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableHeaderRow>
              <SortableHead sorted={sort.key === "name"} direction={sort.direction} onClick={() => setSort((current) => nextSort(current, "name"))}>Group</SortableHead>
              <SortableHead sorted={sort.key === "group_key"} direction={sort.direction} onClick={() => setSort((current) => nextSort(current, "group_key"))}>Key</SortableHead>
              <SortableHead sorted={sort.key === "discount_type"} direction={sort.direction} onClick={() => setSort((current) => nextSort(current, "discount_type"))}>Discount</SortableHead>
              <SortableHead sorted={sort.key === "is_active"} direction={sort.direction} onClick={() => setSort((current) => nextSort(current, "is_active"))}>Status</SortableHead>
              <SortableHead sorted={sort.key === "is_default"} direction={sort.direction} onClick={() => setSort((current) => nextSort(current, "is_default"))}>Default</SortableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {groups.isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-copy-muted" aria-busy="true">
                  Loading customer groups...
                </TableCell>
              </TableRow>
            ) : groups.error ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <div role="alert" className="flex flex-col items-center px-4 py-8 text-center">
                    <p className="text-sm font-medium text-copy-primary">Customer groups could not be loaded.</p>
                    <p className="mt-1 text-sm text-copy-muted">Check your connection and try again.</p>
                    <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void groups.refetch()}>
                      <RefreshCw />
                      Try again
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : visibleGroups.length ? (
              visibleGroups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell>
                    <div className="font-medium text-copy-primary">{group.name}</div>
                    {group.description ? <div className="mt-1 text-xs text-copy-muted">{group.description}</div> : null}
                  </TableCell>
                  <TableCell className="text-xs text-copy-muted">{group.group_key}</TableCell>
                  <TableCell className="text-copy-secondary">{formatDiscount(group.discount_type, group.discount_value)}</TableCell>
                  <TableCell>
                    <Pill
                      bg={group.is_active ? "bg-state-success-muted" : undefined}
                      text={group.is_active ? "text-state-success" : undefined}
                      border={group.is_active ? "border-state-success/40" : undefined}
                    >
                      {group.is_active ? "Active" : "Inactive"}
                    </Pill>
                  </TableCell>
                  <TableCell className="text-copy-secondary">
                    {group.is_default ? <Pill bg="bg-state-info-muted" text="text-state-info" border="border-state-info/40">Default</Pill> : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button type="button" size="sm" variant="outline" onClick={() => void editGroup(group)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState
                    icon={BadgePercent}
                    title={groups.data?.length ? "No matching groups" : "No customer groups"}
                    description={groups.data?.length ? "Adjust the search to find another customer group." : "Customer groups will appear here once the backend provides them."}
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ModuleTableShell>
    </PageShell>
  );
}
