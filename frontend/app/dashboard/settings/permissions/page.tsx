"use client";

import { useMemo, useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { FormFooter } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MatrixTable, type MatrixColumn, type MatrixGroup } from "@/components/ui/MatrixTable";
import { isForbiddenError } from "@/lib/api";
import { PageShell } from "@/components/ui/PageShell";
import { RequiredMark } from "@/components/ui/RequiredMark";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditorPanel } from "@/components/ui/EditorPanel";
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

  // Built each render rather than memoized: every `onToggle` closes over
  // `updateDraftPermissions`, which closes over the selected role and the server
  // baseline. A memo keyed on anything less than both would toggle into a stale draft.
  const matrixColumns: MatrixColumn<ModulePermission>[] = ACTION_COLUMNS.map((column) => ({
    key: column.key,
    label: column.label,
    title: column.title,
    value: (permission) => permission.actions[column.key],
    onToggle: (permission, checked) => {
      setSaveError(null);
      updateDraftPermissions((current) => current.map((item) => (
        item.module_id === permission.module_id
          ? { ...item, actions: { ...item.actions, [column.key]: checked } }
          : item
      )));
    },
  }));
  const matrixGroups: MatrixGroup<ModulePermission>[] = groupedPermissions.map(([area, modulePermissions]) => ({
    key: area,
    label: productAreaLabel(area),
    rows: modulePermissions,
  }));

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
      isPermissionDenied={isForbiddenError(overviewError)}
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

            {selectedRole ? (
              <>
                <div className="flex min-h-0 flex-1 flex-col p-4">
                  <MatrixTable<ModulePermission>
                    label="Role permissions"
                    identityLabel="Module"
                    columns={matrixColumns}
                    groups={matrixGroups}
                    rowKey={(permission) => permission.module_id}
                    renderIdentity={(permission) => (
                      <>
                        <div className="font-medium text-copy-primary">{permission.module_name}</div>
                        {permission.module_description ? (
                          <div className="mt-1 text-xs text-copy-muted">{permission.module_description}</div>
                        ) : null}
                      </>
                    )}
                    onToggleRow={(permission, checked) =>
                      updateDraftPermissions((current) => current.map((item) => (
                        item.module_id === permission.module_id
                          ? { ...item, actions: Object.fromEntries(ACTION_COLUMNS.map((column) => [column.key, checked])) as ModulePermission["actions"] }
                          : item
                      )))
                    }
                    onToggleColumn={(column, checked) =>
                      updateVisiblePermissions((permission) => ({
                        ...permission,
                        actions: { ...permission.actions, [column.key]: checked },
                      }))
                    }
                    rowToggleLabel={(permission) => `Set all permissions for ${permission.module_name}`}
                    cellLabel={(permission, column) => `${column.label} ${permission.module_name}`}
                    columnToggleLabel={(column) => `Set ${column.label.toLocaleLowerCase()} for all visible modules`}
                    disabled={isSaving}
                    isLoading={isPermissionsLoading || isAwaitingHydration}
                    isRefreshing={isSaving || isPermissionsFetching}
                    hasError={Boolean(permissionsError)}
                    onRetry={() => void retryPermissions()}
                    errorState={{
                      title: "Permissions could not be loaded",
                      description: "Try again before editing this role.",
                    }}
                    emptyState={{
                      icon: ShieldCheck,
                      title: "No modules available for this role",
                      description: "No workspace modules are currently available to configure for this role.",
                    }}
                    hasActiveFilters={Boolean(search.trim())}
                    onClearFilters={() => setSearch("")}
                    filteredEmptyState={{
                      icon: ShieldCheck,
                      title: "No modules match this search",
                      description: "Clear the search to return to the complete permission matrix.",
                    }}
                  />
                </div>

                {/* The matrix is a configuration record: every checkbox in it commits in one
                    write, so it keeps a manual save (archetype 4). R3 takes the stickiness,
                    and R5 takes the colour — a dirty form is not an exception state. The
                    save error stays `state-danger`, because that one is. */}
                <FormFooter
                  className="px-5 pb-4"
                  status={
                    <>
                      <span className="font-medium">{isDirty ? "Unsaved changes" : "All changes saved"}</span>
                      {saveError ? <p className="mt-1 text-sm text-state-danger" role="alert">{saveError}</p> : null}
                    </>
                  }
                >
                  <Button type="button" variant="outline" disabled={!isDirty || isSaving} onClick={discardPermissionChanges}>
                    Discard
                  </Button>
                  <Button type="button" disabled={!isDirty || isSaving} onClick={() => void handleSave()}>
                    {isSaving ? "Saving…" : "Save Permissions"}
                  </Button>
                </FormFooter>
              </>
            ) : (
              <EmptyState className="py-16" icon={ShieldCheck} title="Select or create a role" description="A role is required before module permissions can be configured." />
            )}
          </Card>
      )}

      <EditorPanel
        open={createRoleOpen}
        onOpenChange={handleCreateRoleOpenChange}
        title="Create role"
        description="Start with a secure platform template, then refine module actions in the permission matrix."
        closeLabel="Close role editor"
        onSubmit={() => void handleCreateRole()}
        status={createError
          ? <span role="alert" className="text-state-danger">{createError}</span>
          : isCreateRoleDirty ? "Unsaved changes" : "Name the role to create it."}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => void closeCreateRoleDialog()} disabled={isCreating}>Cancel</Button>
            <Button type="submit" disabled={!newRoleName.trim() || isCreating}>{isCreating ? "Creating\u2026" : "Create role"}</Button>
          </>
        )}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="new-role-name">Role name <RequiredMark /></FieldLabel>
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
        </FieldGroup>
      </EditorPanel>
    </PageShell>
  );
}
