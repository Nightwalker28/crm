"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBackdrop,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { RouteLoadingState } from "@/components/ui/RouteStates";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

type ActionKey = keyof ModulePermission["actions"];
type PermissionPreset = "none" | "viewer" | "contributor" | "manager" | "full";

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

const CHECKBOX_CLASS = "h-4 w-4 rounded border border-line-strong bg-surface-raised text-primary";

function roleAccent(level: number) {
  if (level >= 100) return "border-l-state-danger";
  if (level >= 90) return "border-l-state-warning";
  if (level >= 10) return "border-l-primary";
  return "border-l-line-strong";
}

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
  const {
    roles,
    templates,
    selectedRoleId,
    setSelectedRoleId,
    permissions,
    isOverviewLoading,
    isPermissionsLoading,
    overviewError,
    permissionsError,
    retryOverview,
    retryPermissions,
    isCreating,
    isSaving,
    createRole,
    updatePermissions,
  } = useRolePermissions();

  const [localPermissions, setLocalPermissions] = useState<ModulePermission[]>([]);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");
  const [newRoleTemplate, setNewRoleTemplate] = useState("user");
  const [createError, setCreateError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loadedRoleId = useRef<number | null>(null);

  const isDirty = permissionSignature(localPermissions) !== permissionSignature(permissions);

  useEffect(() => {
    if (loadedRoleId.current !== selectedRoleId || !isDirty) {
      loadedRoleId.current = selectedRoleId;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocalPermissions(permissions);
      setSaveError(null);
    }
  }, [isDirty, permissions, selectedRoleId]);

  useUnsavedChangesGuard(isDirty, isSaving);

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
    setLocalPermissions((current) =>
      current.map((permission) =>
        visibleModuleIds.has(permission.module_id) ? update(permission) : permission,
      ),
    );
    setSaveError(null);
  }

  function switchRole(roleId: number) {
    if (roleId === selectedRoleId) return;
    if (isDirty && !window.confirm("Switch roles and discard unsaved permission changes?")) return;
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
      setDialogOpen(false);
      setNewRoleName("");
      setNewRoleDescription("");
      setNewRoleTemplate("user");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "The role could not be created.");
    }
  }

  async function handleSave() {
    if (selectedRoleId == null || !isDirty) return;
    setSaveError(null);
    try {
      await updatePermissions(selectedRoleId, localPermissions);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Permissions could not be saved.");
    }
  }

  if (isOverviewLoading) return <RouteLoadingState label="roles and permissions" />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Roles & Permissions"
        description="Control what each role can do inside the modules available to its workspace, departments, and teams."
        actions={<Button onClick={() => setDialogOpen(true)}>Create Role</Button>}
      />

      {overviewError ? (
        <Card className="p-6" role="alert">
          <h2 className="font-semibold text-copy-primary">Roles could not be loaded</h2>
          <p className="mt-1 text-sm text-copy-secondary">Try the request again. No permissions have been changed.</p>
          <Button className="mt-4" variant="outline" onClick={() => void retryOverview()}>Try again</Button>
        </Card>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="p-4 xl:sticky xl:top-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-copy-muted">Roles</h2>
              <span className="text-xs text-copy-muted">{roles.length}</span>
            </div>
            {roles.length ? (
              <div className="scrollbar-hide mt-4 flex gap-2 overflow-x-auto pb-1 xl:block xl:space-y-2 xl:overflow-visible xl:pb-0">
                {roles.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    aria-pressed={selectedRoleId === role.id}
                    className={`min-w-56 rounded-[var(--radius-control)] border border-l-4 px-3 py-3 text-left transition-colors xl:w-full ${roleAccent(role.level)} ${
                      selectedRoleId === role.id
                        ? "border-line-strong bg-action-primary-muted"
                        : "border-line-default bg-surface hover:bg-surface-muted"
                    }`}
                    onClick={() => switchRole(role.id)}
                  >
                    <div className="text-sm font-semibold text-copy-primary">{role.name}</div>
                    <div className="mt-1 text-xs text-copy-muted">Level {role.level}</div>
                    {role.description ? <div className="mt-2 line-clamp-2 text-xs text-copy-secondary">{role.description}</div> : null}
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                className="px-0"
                icon={ShieldCheck}
                title="No roles yet"
                description="Create a role from a secure platform template."
                action={<Button onClick={() => setDialogOpen(true)}>Create Role</Button>}
              />
            )}
          </Card>

          <Card className="overflow-visible">
            <div className="border-b border-line-subtle px-5 py-4">
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
                <div>
                  <h2 className="text-lg font-semibold text-copy-primary">
                    {selectedRole ? `${selectedRole.name} Permissions` : "Role Permissions"}
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm text-copy-secondary">
                    Changes apply only to this role. Module availability is managed separately by workspace, department, and team settings.
                  </p>
                </div>
                {selectedRole ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <SearchBar value={search} onChange={setSearch} placeholder="Search modules" className="md:w-64" />
                    <Select
                      value=""
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
                ) : null}
              </div>
            </div>

            {isPermissionsLoading ? (
              <div className="p-5"><RouteLoadingState label="role permissions" /></div>
            ) : permissionsError ? (
              <div className="p-6" role="alert">
                <h3 className="font-semibold text-copy-primary">Permissions could not be loaded</h3>
                <p className="mt-1 text-sm text-copy-secondary">Try again before editing this role.</p>
                <Button className="mt-4" variant="outline" onClick={() => void retryPermissions()}>Try again</Button>
              </div>
            ) : selectedRole ? (
              <>
                <div className="p-4">
                  <ModuleTableShell className="max-h-[62vh]" isRefreshing={isSaving}>
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
                                    className={CHECKBOX_CLASS}
                                    aria-label={`Set ${column.label.toLocaleLowerCase()} for all visible modules`}
                                    checked={state}
                                    disabled={!filteredPermissions.length}
                                    onCheckedChange={(checked) =>
                                      updateVisiblePermissions((permission) => ({
                                        ...permission,
                                        actions: { ...permission.actions, [column.key]: checked === true },
                                      }))
                                    }
                                  >
                                    <CheckboxIndicator className="h-3 w-3" />
                                  </Checkbox>
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
                                        className={`${CHECKBOX_CLASS} mt-0.5 shrink-0`}
                                        aria-label={`Set all permissions for ${permission.module_name}`}
                                        checked={rowState}
                                        onCheckedChange={(checked) =>
                                          setLocalPermissions((current) => current.map((item) =>
                                            item.module_id === permission.module_id
                                              ? { ...item, actions: Object.fromEntries(ACTION_COLUMNS.map((column) => [column.key, checked === true])) as ModulePermission["actions"] }
                                              : item,
                                          ))
                                        }
                                      >
                                        <CheckboxIndicator className="h-3 w-3" />
                                      </Checkbox>
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
                                        onCheckedChange={(checked) => {
                                          setSaveError(null);
                                          setLocalPermissions((current) => current.map((item) =>
                                            item.module_id === permission.module_id
                                              ? { ...item, actions: { ...item.actions, [column.key]: checked === true } }
                                              : item,
                                          ));
                                        }}
                                        className={`${CHECKBOX_CLASS} mx-auto`}
                                      >
                                        <CheckboxIndicator className="h-3 w-3" />
                                      </Checkbox>
                                    </TableCell>
                                  ))}
                                </TableRow>
                              );
                            })}
                          </Fragment>
                        )) : (
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
                        )}
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
                    <Button type="button" variant="outline" disabled={!isDirty || isSaving} onClick={() => { setLocalPermissions(permissions); setSaveError(null); }}>
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
        </div>
      )}

      <Dialog open={dialogOpen} onClose={() => { if (!isCreating) setDialogOpen(false); }}>
        <DialogBackdrop />
        <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
          <DialogPanel size="xl">
            <DialogHeader>
              <DialogTitle>Create Role</DialogTitle>
              <DialogIconClose />
            </DialogHeader>

            <FieldGroup className="mt-4 grid gap-4">
              <Field>
                <FieldLabel>Role Name</FieldLabel>
                <Input value={newRoleName} onChange={(event) => setNewRoleName(event.target.value)} placeholder="Operations Manager" disabled={isCreating} />
              </Field>
              <Field>
                <FieldLabel>Template</FieldLabel>
                <Select value={newRoleTemplate} onValueChange={setNewRoleTemplate} disabled={isCreating}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => <SelectItem key={template.key} value={template.key}>{template.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Start from a secure platform template, then customize module actions after creation.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Description</FieldLabel>
                <Input value={newRoleDescription} onChange={(event) => setNewRoleDescription(event.target.value)} placeholder="Optional internal description" disabled={isCreating} />
              </Field>
              {createError ? <p className="text-sm text-state-danger" role="alert">{createError}</p> : null}
            </FieldGroup>

            <DialogFooter className="mt-5">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isCreating}>Cancel</Button>
              <Button onClick={() => void handleCreateRole()} disabled={!newRoleName.trim() || isCreating}>
                {isCreating ? "Creating…" : "Create Role"}
              </Button>
            </DialogFooter>
          </DialogPanel>
        </div>
      </Dialog>
    </div>
  );
}
