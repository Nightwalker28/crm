"use client";

import { Fragment, useMemo, useState } from "react";
import { Plus, ShieldCheck, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { PageShell } from "@/components/ui/PageShell";
import { RouteLoadingState } from "@/components/ui/RouteStates";
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
import {
  Table,
  TableBody,
  TableCell,
  TableGroupCell,
  TableGroupRow,
  TableHead,
  TableHeader,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/Table";
import { useRolePermissions, type ModulePermission } from "@/hooks/admin/useRolePermissions";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

type ActionKey = keyof ModulePermission["actions"];
type PermissionPreset = "none" | "viewer" | "contributor" | "manager" | "full";
type PermissionDraft = {
  roleId: number;
  queryVersion: number;
  permissions: ModulePermission[];
  locallyEdited: boolean;
};

const ACTION_COLUMNS: Array<{ key: ActionKey; label: string; title: string }> = [
  { key: "can_view", label: "View", title: "Can view and list records" },
  { key: "can_create", label: "Create", title: "Can create new records" },
  { key: "can_edit", label: "Edit", title: "Can update existing records" },
  { key: "can_delete", label: "Delete", title: "Can move records to the recycle bin or delete where allowed" },
  { key: "can_restore", label: "Restore", title: "Can restore records from the recycle bin" },
  { key: "can_export", label: "Export", title: "Can export records" },
  { key: "can_configure", label: "Configure", title: "Can configure module settings" },
];

const PRODUCT_AREA_LABELS: Record<string, string> = {
  workspace: "Workspace",
  sales: "Sales",
  catalog: "Catalog",
  support: "Support",
  finance: "Finance",
  reports: "Reports",
  settings: "Administration",
  none: "Not in sidebar",
  other: "Other",
};

const PRESETS: Array<{ value: PermissionPreset; label: string }> = [
  { value: "none", label: "No access" },
  { value: "viewer", label: "Viewer" },
  { value: "contributor", label: "Contributor" },
  { value: "manager", label: "Manager" },
  { value: "full", label: "Full access" },
];

const EMPTY_PERMISSIONS: ModulePermission[] = [];

function permissionSignature(permissions: ModulePermission[]) {
  return JSON.stringify(
    [...permissions]
      .sort((left, right) => left.module_id - right.module_id)
      .map(({ module_id, actions }) => ({ module_id, actions })),
  );
}

function presetActions(preset: PermissionPreset): ModulePermission["actions"] {
  const canContribute = preset === "contributor" || preset === "manager" || preset === "full";
  const canManage = preset === "manager" || preset === "full";
  return {
    can_view: preset !== "none",
    can_create: canContribute,
    can_edit: canContribute,
    can_delete: canManage,
    can_restore: canManage,
    can_export: canManage,
    can_configure: preset === "full",
  };
}

function selectionState(values: boolean[]): boolean | "indeterminate" {
  if (values.length === 0 || values.every((value) => !value)) return false;
  if (values.every(Boolean)) return true;
  return "indeterminate";
}

function productAreaLabel(area: string) {
  return PRODUCT_AREA_LABELS[area] ?? area.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

export default function RolesPermissionsPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const searchParams = useSearchParams();
  const requestedAction = searchParams.get("action");
  const {
    roles,
    templates,
    selectedRoleId,
    setSelectedRoleId,
    permissions,
    permissionsQueryVersion,
    isPermissionsSuccess,
    isOverviewLoading,
    isPermissionsLoading,
    isPermissionsFetching,
    overviewError,
    permissionsError,
    retryOverview,
    retryPermissions,
    isCreating,
    isSaving,
    createRole,
    updatePermissions,
  } = useRolePermissions();

  const [permissionDraft, setPermissionDraft] = useState<PermissionDraft | null>(null);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");
  const [newRoleTemplate, setNewRoleTemplate] = useState("user");
  const [createError, setCreateError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const selectedDraft = permissionDraft?.roleId === selectedRoleId ? permissionDraft : null;
  const localPermissions = selectedDraft?.permissions ?? EMPTY_PERMISSIONS;
  const baselineLoaded = selectedRoleId != null && isPermissionsSuccess && selectedDraft != null;
  const isDirty = baselineLoaded && Boolean(selectedDraft?.locallyEdited);
  const isAwaitingHydration = selectedRoleId != null
    && isPermissionsSuccess
    && (
      selectedDraft == null
      || (!selectedDraft.locallyEdited && selectedDraft.queryVersion !== permissionsQueryVersion)
    );
  const isCreateRoleAction = requestedAction === "create-role";
  const createRoleOpen = dialogOpen || isCreateRoleAction;
  const isCreateRoleDirty = Boolean(newRoleName.trim() || newRoleDescription.trim() || newRoleTemplate !== "user");

  if (
    selectedRoleId != null
    && isPermissionsSuccess
    && (
      selectedDraft == null
      || (!selectedDraft.locallyEdited && selectedDraft.queryVersion !== permissionsQueryVersion)
    )
  ) {
    setPermissionDraft({
      roleId: selectedRoleId,
      queryVersion: permissionsQueryVersion,
      permissions,
      locallyEdited: false,
    });
  }

  useUnsavedChangesGuard(isDirty || (createRoleOpen && isCreateRoleDirty), isSaving || isCreating);

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const filteredPermissions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return localPermissions;
    return localPermissions.filter((permission) => {
      const area = productAreaLabel(permission.product_area);
      return [permission.module_name, permission.module_description, area]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(query));
    });
  }, [localPermissions, search]);
  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, ModulePermission[]>();
    filteredPermissions.forEach((permission) => {
      const key = permission.product_area || "other";
      groups.set(key, [...(groups.get(key) ?? []), permission]);
    });
    return Array.from(groups.entries());
  }, [filteredPermissions]);
  const visibleModuleIds = useMemo(
    () => new Set(filteredPermissions.map((permission) => permission.module_id)),
    [filteredPermissions],
  );

  function updateVisiblePermissions(
    update: (permission: ModulePermission) => ModulePermission,
  ) {
    updateDraftPermissions((current) => current.map((permission) =>
      visibleModuleIds.has(permission.module_id) ? update(permission) : permission,
    ));
    setSaveError(null);
  }

  function updateDraftPermissions(update: (permissions: ModulePermission[]) => ModulePermission[]) {
    setPermissionDraft((current) => {
      if (!current || current.roleId !== selectedRoleId) return current;
      const nextPermissions = update(current.permissions);
      return {
        ...current,
        permissions: nextPermissions,
        locallyEdited: permissionSignature(nextPermissions) !== permissionSignature(permissions),
      };
    });
  }

  function discardPermissionChanges() {
    if (selectedRoleId == null || !isPermissionsSuccess) return;
    setPermissionDraft({
      roleId: selectedRoleId,
      queryVersion: permissionsQueryVersion,
      permissions,
      locallyEdited: false,
    });
    setSaveError(null);
  }

  async function switchRole(roleId: number) {
    if (roleId === selectedRoleId) return;
    if (isDirty) {
      const confirmed = await confirm({
        title: "Discard permission changes?",
        description: "Switching roles will discard the unsaved permission changes for the current role.",
        confirmLabel: "Discard and switch",
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    setSearch("");
    setSelectedRoleId(roleId);
  }

  async function handleCreateRole() {
    setCreateError(null);
    try {
      await createRole({
        name: newRoleName.trim(),
        description: newRoleDescription.trim() || undefined,
        template_key: newRoleTemplate,
      });
      setNewRoleName("");
      setNewRoleDescription("");
      setNewRoleTemplate("user");
      setDialogOpen(false);
      if (isCreateRoleAction) router.replace("/dashboard/settings/permissions", { scroll: false });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "The role could not be created.");
    }
  }

  async function closeCreateRoleDialog() {
    if (isCreateRoleDirty) {
      const confirmed = await confirm({
        title: "Discard role draft?",
        description: "The role name, template, and description have not been saved.",
        confirmLabel: "Discard draft",
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    setNewRoleName("");
    setNewRoleDescription("");
    setNewRoleTemplate("user");
    setCreateError(null);
    setDialogOpen(false);
    if (isCreateRoleAction) {
      router.replace("/dashboard/settings/permissions", { scroll: false });
    }
  }

  function handleCreateRoleOpenChange(open: boolean) {
    if (open) {
      setDialogOpen(true);
      return;
    }
    if (!isCreating) void closeCreateRoleDialog();
  }

  async function handleSave() {
    if (selectedRoleId == null || !isDirty) return;
    const savedRoleId = selectedRoleId;
    setSaveError(null);
    try {
      const saved = await updatePermissions(savedRoleId, localPermissions);
      setPermissionDraft((current) => (
        current?.roleId === savedRoleId
          ? {
              roleId: savedRoleId,
              queryVersion: saved.queryVersion,
              permissions: saved.permissions,
              locallyEdited: false,
            }
          : current
      ));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Permissions could not be saved.");
    }
  }

  return (
    <PageShell
      variant="list"
      title="Permissions"
      description="Control role actions across enabled modules."
      actions={<Button onClick={() => setDialogOpen(true)}><Plus />Create Role</Button>}
      isLoading={isOverviewLoading}
      hasError={Boolean(overviewError)}
      errorDescription="Try the request again. No permissions have been changed."
      onRetry={() => void retryOverview()}
      backHref="/dashboard/settings"
      backLabel="Back to Settings"
    >
      {(
        <Card className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-line-subtle px-5 py-4">
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                <div>
                  <h2 className="text-lg font-semibold text-copy-primary">
                    {selectedRole ? `${selectedRole.name} Permissions` : "Role Permissions"}
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm text-copy-secondary">
                    Changes apply only to this role. Module availability is managed separately by workspace, department, and team settings.
                  </p>
                </div>
                {roles.length ? (
                  <div className="w-full lg:w-72">
                    <label htmlFor="permission-role-selector" className="mb-1.5 block text-xs font-medium text-copy-label">Role</label>
                    <Select
                      value={selectedRoleId == null ? "" : String(selectedRoleId)}
                      onValueChange={(value) => void switchRole(Number(value))}
                      disabled={isSaving}
                    >
                      <SelectTrigger id="permission-role-selector" aria-label="Role"><SelectValue placeholder="Select a role" /></SelectTrigger>
                      <SelectContent>
                        {roles.map((role) => <SelectItem key={role.id} value={String(role.id)}>{role.name} · Level {role.level}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {selectedRole?.description ? <p className="mt-1.5 text-xs text-copy-muted">{selectedRole.description}</p> : null}
                  </div>
                ) : null}
              </div>
              {selectedRole && baselineLoaded && localPermissions.length ? (
                <div className="mt-4 flex flex-col gap-2 border-t border-line-subtle pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <SearchBar value={search} onChange={setSearch} placeholder="Search modules" className="sm:max-w-sm" />
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Select
                      value=""
                      disabled={isSaving}
                      onValueChange={(value) =>
                        updateVisiblePermissions((permission) => ({
                          ...permission,
                          actions: presetActions(value as PermissionPreset),
                        }))
                      }
                    >
                      <SelectTrigger className="w-full sm:w-48" aria-label="Apply permission preset to visible modules">
                        <SelectValue placeholder="Apply preset" />
                      </SelectTrigger>
                      <SelectContent>
                        {PRESETS.map((preset) => <SelectItem key={preset.value} value={preset.value}>{preset.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
            </div>

            {isPermissionsLoading || isAwaitingHydration ? (
              <div className="p-5"><RouteLoadingState label="role permissions" /></div>
            ) : permissionsError ? (
              <div className="p-6" role="alert">
                <h3 className="font-semibold text-copy-primary">Permissions could not be loaded</h3>
                <p className="mt-1 text-sm text-copy-secondary">Try again before editing this role.</p>
                <Button className="mt-4" variant="outline" onClick={() => void retryPermissions()}>Try again</Button>
              </div>
            ) : selectedRole && baselineLoaded ? (
              <>
                <div className="flex min-h-0 flex-1 flex-col p-4">
                  <ModuleTableShell isRefreshing={isSaving || isPermissionsFetching}>
                    <Table className="min-w-[920px]">
                      <TableHeader>
                        <TableHeaderRow>
                          <TableHead className="sticky left-0 z-40 min-w-64 border-r border-line-subtle bg-surface-raised">
                            Module
                          </TableHead>
                          {ACTION_COLUMNS.map((column) => {
                            const state = selectionState(filteredPermissions.map((permission) => permission.actions[column.key]));
                            return (
                              <TableHead key={column.key} title={column.title} className="min-w-24 text-center">
                                <div className="flex flex-col items-center gap-1.5">
                                  <span>{column.label}</span>
                                  <Checkbox
                                    aria-label={`Set ${column.label.toLocaleLowerCase()} for all visible modules`}
                                    checked={state}
                                    disabled={!filteredPermissions.length || isSaving}
                                    onCheckedChange={(checked) =>
                                      updateVisiblePermissions((permission) => ({
                                        ...permission,
                                        actions: { ...permission.actions, [column.key]: checked === true },
                                      }))
                                    }
                                  />
                                </div>
                              </TableHead>
                            );
                          })}
                        </TableHeaderRow>
                      </TableHeader>
                      <TableBody>
                        {groupedPermissions.length ? groupedPermissions.map(([area, modulePermissions]) => (
                          <Fragment key={area}>
                            <TableGroupRow className="top-[58px]">
                              <TableGroupCell colSpan={ACTION_COLUMNS.length + 1}>
                                {productAreaLabel(area)}
                              </TableGroupCell>
                            </TableGroupRow>
                            {modulePermissions.map((permission) => {
                              const rowState = selectionState(ACTION_COLUMNS.map((column) => permission.actions[column.key]));
                              return (
                                <TableRow key={permission.module_id}>
                                  <TableCell className="sticky left-0 z-10 border-r border-line-subtle bg-surface">
                                    <div className="flex items-start gap-3">
                                      <Checkbox
                                        className="mt-0.5 shrink-0"
                                        aria-label={`Set all permissions for ${permission.module_name}`}
                                        checked={rowState}
                                        disabled={isSaving}
                                        onCheckedChange={(checked) =>
                                          updateDraftPermissions((current) => current.map((item) =>
                                            item.module_id === permission.module_id
                                              ? { ...item, actions: Object.fromEntries(ACTION_COLUMNS.map((column) => [column.key, checked === true])) as ModulePermission["actions"] }
                                              : item,
                                          ))
                                        }
                                      />
                                      <div>
                                        <div className="font-medium text-copy-primary">{permission.module_name}</div>
                                        {permission.module_description ? <div className="mt-1 text-xs text-copy-muted">{permission.module_description}</div> : null}
                                      </div>
                                    </div>
                                  </TableCell>
                                  {ACTION_COLUMNS.map((column) => (
                                    <TableCell key={column.key} className="text-center">
                                      <Checkbox
                                        checked={permission.actions[column.key]}
                                        aria-label={`${column.label} ${permission.module_name}`}
                                        disabled={isSaving}
                                        onCheckedChange={(checked) => {
                                          setSaveError(null);
                                          updateDraftPermissions((current) => current.map((item) =>
                                            item.module_id === permission.module_id
                                              ? { ...item, actions: { ...item.actions, [column.key]: checked === true } }
                                              : item,
                                          ));
                                        }}
                                        className="mx-auto"
                                      />
                                    </TableCell>
                                  ))}
                                </TableRow>
                              );
                            })}
                          </Fragment>
                        )) : localPermissions.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={ACTION_COLUMNS.length + 1} className="py-14">
                              <EmptyState
                                icon={ShieldCheck}
                                title="No modules available for this role"
                                description="No workspace modules are currently available to configure for this role."
                              />
                            </TableCell>
                          </TableRow>
                        ) : search.trim() ? (
                          <TableRow>
                            <TableCell colSpan={ACTION_COLUMNS.length + 1} className="py-14">
                              <EmptyState
                                icon={ShieldCheck}
                                title="No modules match this search"
                                description="Clear the search to return to the complete permission matrix."
                                action={<Button variant="outline" onClick={() => setSearch("")}>Clear search</Button>}
                              />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  </ModuleTableShell>
                </div>

                <div className="sticky bottom-0 z-30 flex flex-col gap-3 border-t border-line-default bg-surface-raised/95 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className={`text-sm font-medium ${isDirty ? "text-state-warning" : "text-state-success"}`}>
                      {isDirty ? "Unsaved changes" : "All changes saved"}
                    </div>
                    {saveError ? <p className="mt-1 text-sm text-state-danger" role="alert">{saveError}</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" disabled={!isDirty || isSaving} onClick={discardPermissionChanges}>
                      Discard
                    </Button>
                    <Button type="button" disabled={!isDirty || isSaving} onClick={() => void handleSave()}>
                      {isSaving ? "Saving…" : "Save Permissions"}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState className="py-16" icon={ShieldCheck} title="Select or create a role" description="A role is required before module permissions can be configured." />
            )}
          </Card>
      )}

      <Sheet open={createRoleOpen} onOpenChange={handleCreateRoleOpenChange}>
        <SheetPortal>
          <SheetOverlay className="fixed inset-0 z-40 bg-overlay" />
          <SheetContent side="right" className="z-50 flex h-full w-full max-w-[32rem] flex-col border-l border-line-default bg-surface-raised outline-none">
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); void handleCreateRole(); }}>
              <SheetHeader className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
                <div>
                  <SheetTitle className="text-lg font-semibold text-copy-primary">Create Role</SheetTitle>
                  <SheetDescription className="mt-1 text-sm text-copy-muted">Start with a secure platform template, then refine module actions in the permission matrix.</SheetDescription>
                </div>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Close role editor" onClick={() => void closeCreateRoleDialog()}><X /></Button>
              </SheetHeader>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                <FieldGroup className="grid gap-4">
              <Field>
                <FieldLabel htmlFor="new-role-name">Role Name <RequiredMark /></FieldLabel>
                <Input id="new-role-name" value={newRoleName} onChange={(event) => setNewRoleName(event.target.value)} placeholder="Operations Manager" disabled={isCreating} required />
              </Field>
              <Field>
                <FieldLabel>Template</FieldLabel>
                <Select value={newRoleTemplate} onValueChange={setNewRoleTemplate} disabled={isCreating}>
                  <SelectTrigger aria-label="Template"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => <SelectItem key={template.key} value={template.key}>{template.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Start from a secure platform template, then customize module actions after creation.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="new-role-description">Description</FieldLabel>
                <Input id="new-role-description" value={newRoleDescription} onChange={(event) => setNewRoleDescription(event.target.value)} placeholder="Optional internal description" disabled={isCreating} />
              </Field>
              {createError ? <p className="text-sm text-state-danger" role="alert">{createError}</p> : null}
                </FieldGroup>
              </div>

              <SheetFooter className="flex flex-col gap-3 border-t border-line-subtle bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <span className={`text-sm ${isCreateRoleDirty ? "text-state-warning" : "text-state-success"}`}>{isCreateRoleDirty ? "Unsaved role draft" : "Ready to create"}</span>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => void closeCreateRoleDialog()} disabled={isCreating}>Cancel</Button>
                  <Button type="submit" disabled={!newRoleName.trim() || isCreating}>{isCreating ? "Creating…" : "Create Role"}</Button>
                </div>
              </SheetFooter>
            </form>
          </SheetContent>
        </SheetPortal>
      </Sheet>
    </PageShell>
  );
}
