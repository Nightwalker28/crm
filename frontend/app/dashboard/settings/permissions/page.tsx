"use client";

import { useEffect, useState } from "react";

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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRolePermissions, type ModulePermission } from "@/hooks/admin/useRolePermissions";

const ACTION_COLUMNS: Array<{ key: keyof ModulePermission["actions"]; label: string }> = [
  { key: "can_view", label: "View" },
  { key: "can_create", label: "Create" },
  { key: "can_edit", label: "Edit" },
  { key: "can_delete", label: "Delete" },
  { key: "can_restore", label: "Restore" },
  { key: "can_export", label: "Export" },
  { key: "can_configure", label: "Configure" },
];

export default function RolesPermissionsPage() {
  const {
    roles,
    templates,
    selectedRoleId,
    setSelectedRoleId,
    permissions,
    isLoading,
    createRole,
    updatePermissions,
  } = useRolePermissions();

  const [localPermissions, setLocalPermissions] = useState<ModulePermission[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");
  const [newRoleTemplate, setNewRoleTemplate] = useState("user");

  useEffect(() => {
    setLocalPermissions(permissions);
  }, [permissions]);

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;

  async function handleCreateRole() {
    await createRole({
      name: newRoleName,
      description: newRoleDescription || undefined,
      template_key: newRoleTemplate,
    });
    setDialogOpen(false);
    setNewRoleName("");
    setNewRoleDescription("");
    setNewRoleTemplate("user");
  }

  return (
    <div className="flex flex-col gap-5 text-neutral-200">
      <PageHeader
        title="Roles & Permissions"
        description="Start from Admin, Superuser, or User templates, then customize module actions per role."
        actions={<Button onClick={() => setDialogOpen(true)}>Create Role</Button>}
      />

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <Card className="px-4 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Roles</h2>
          <div className="mt-4 space-y-2">
            {roles.map((role) => (
              <button
                key={role.id}
                className={`w-full rounded-md border px-3 py-3 text-left ${
                  selectedRoleId === role.id
                    ? "border-white/30 bg-white/10"
                    : "border-neutral-800 bg-neutral-950/70 hover:border-neutral-700"
                }`}
                onClick={() => setSelectedRoleId(role.id)}
              >
                <div className="text-sm font-semibold text-neutral-100">{role.name}</div>
                <div className="mt-1 text-xs text-neutral-500">Level {role.level}</div>
                {role.description ? (
                  <div className="mt-2 text-xs text-neutral-400">{role.description}</div>
                ) : null}
              </button>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden px-0 py-0">
          <div className="border-b border-neutral-800 px-5 py-4">
            <h2 className="text-lg font-semibold text-neutral-100">
              {selectedRole ? `${selectedRole.name} Permissions` : "Role Permissions"}
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              One unified permission matrix per role. Modules controls tenant, department, and team availability; these action flags control what each role can do inside available modules.
            </p>
          </div>

          {isLoading ? (
            <div className="px-5 py-5 text-sm text-neutral-500">Loading permissions…</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-neutral-950/70 text-neutral-400">
                    <tr className="border-b border-neutral-800">
                      <th className="px-5 py-3 text-left font-medium">Module</th>
                      {ACTION_COLUMNS.map((column) => (
                        <th key={column.key} className="px-4 py-3 text-center font-medium">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {localPermissions.map((permission, index) => (
                      <tr key={permission.module_id} className={index % 2 === 0 ? "bg-neutral-950/30" : "bg-transparent"}>
                        <td className="px-5 py-4 align-top">
                          <div className="font-medium text-neutral-100">{permission.module_name}</div>
                          {permission.module_description ? (
                            <div className="mt-1 text-xs text-neutral-500">{permission.module_description}</div>
                          ) : null}
                        </td>
                        {ACTION_COLUMNS.map((column) => (
                          <td key={column.key} className="px-4 py-4 text-center">
                            <Checkbox
                              checked={permission.actions[column.key]}
                              onCheckedChange={(checked) => {
                                setLocalPermissions((current) =>
                                  current.map((item) =>
                                    item.module_id === permission.module_id
                                      ? {
                                          ...item,
                                          actions: {
                                            ...item.actions,
                                            [column.key]: checked === true,
                                          },
                                        }
                                      : item,
                                  ),
                                );
                              }}
                              className="mx-auto flex h-4 w-4 items-center justify-center rounded border border-neutral-700 bg-neutral-900 text-white"
                            >
                              <CheckboxIndicator className="h-3 w-3" />
                            </Checkbox>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-neutral-800 px-5 py-4">
                <Button
                  onClick={async () => {
                    if (selectedRoleId == null) return;
                    await updatePermissions(selectedRoleId, localPermissions);
                  }}
                  disabled={selectedRoleId == null}
                >
                  Save Permissions
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
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
                <Input value={newRoleName} onChange={(event) => setNewRoleName(event.target.value)} placeholder="Operations Manager" />
              </Field>
              <Field>
                <FieldLabel>Template</FieldLabel>
                <Select value={newRoleTemplate} onValueChange={setNewRoleTemplate}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => (
                      <SelectItem key={template.key} value={template.key}>
                        {template.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Start from one of the three platform templates, then customize the module actions after creation.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Description</FieldLabel>
                <Input value={newRoleDescription} onChange={(event) => setNewRoleDescription(event.target.value)} placeholder="Optional internal description" />
              </Field>
            </FieldGroup>

            <DialogFooter className="mt-5">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateRole} disabled={!newRoleName.trim()}>
                Create Role
              </Button>
            </DialogFooter>
          </DialogPanel>
        </div>
      </Dialog>
    </div>
  );
}
