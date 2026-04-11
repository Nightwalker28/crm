"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Trash2, UsersRound, type LucideIcon } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";

type Department = {
  id: number;
  name: string;
  description?: string | null;
};

type Team = {
  id: number;
  name: string;
  description?: string | null;
  department_id?: number | null;
};

type DepartmentForm = {
  name: string;
  description: string;
};

type TeamForm = {
  name: string;
  description: string;
  department_id: string;
};

const emptyDepartmentForm: DepartmentForm = {
  name: "",
  description: "",
};

const emptyTeamForm: TeamForm = {
  name: "",
  description: "",
  department_id: "",
};

async function fetchDepartments(): Promise<Department[]> {
  const res = await apiFetch("/admin/users/departments");
  if (!res.ok) throw new Error("Failed to load departments");
  return res.json();
}

async function fetchTeams(): Promise<Team[]> {
  const res = await apiFetch("/admin/users/teams");
  if (!res.ok) throw new Error("Failed to load teams");
  return res.json();
}

function SectionHeader({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-5 border-b border-neutral-800">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md border border-white/10 bg-neutral-950/70 p-2 text-neutral-300">
          <Icon size={16} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
          <p className="mt-1 text-sm text-zinc-500">{description}</p>
        </div>
      </div>

      <Button onClick={onAction}>
        <Plus />
        <span className="hidden sm:inline">{actionLabel}</span>
      </Button>
    </div>
  );
}

function DepartmentDialog({
  open,
  mode,
  form,
  submitting,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  form: DepartmentForm;
  submitting: boolean;
  onClose: () => void;
  onChange: (next: DepartmentForm) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-lg">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "Create Department" : "Edit Department"}</DialogTitle>
            <DialogClose className="text-neutral-400/70 hover:text-red-400/90 cursor-pointer">
              Close
            </DialogClose>
          </DialogHeader>

          <FieldGroup className="mt-4">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input
                value={form.name}
                onChange={(event) => onChange({ ...form, name: event.target.value })}
                placeholder="Revenue Operations"
              />
            </Field>

            <Field>
              <FieldLabel>Description</FieldLabel>
              <Input
                value={form.description}
                onChange={(event) => onChange({ ...form, description: event.target.value })}
                placeholder="Optional description"
              />
              <FieldDescription>Departments control which modules teams can access.</FieldDescription>
            </Field>
          </FieldGroup>

          <DialogFooter className="mt-5">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={onSubmit} disabled={submitting || !form.name.trim()}>
              {submitting ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function TeamDialog({
  open,
  mode,
  form,
  departments,
  submitting,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  form: TeamForm;
  departments: Department[];
  submitting: boolean;
  onClose: () => void;
  onChange: (next: TeamForm) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-lg">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "Create Team" : "Edit Team"}</DialogTitle>
            <DialogClose className="text-neutral-400/70 hover:text-red-400/90 cursor-pointer">
              Close
            </DialogClose>
          </DialogHeader>

          <FieldGroup className="mt-4">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input
                value={form.name}
                onChange={(event) => onChange({ ...form, name: event.target.value })}
                placeholder="Platform Admins"
              />
            </Field>

            <Field>
              <FieldLabel>Department</FieldLabel>
              <Select value={form.department_id} onValueChange={(value) => onChange({ ...form, department_id: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((department) => (
                    <SelectItem key={department.id} value={String(department.id)}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>Description</FieldLabel>
              <Input
                value={form.description}
                onChange={(event) => onChange({ ...form, description: event.target.value })}
                placeholder="Optional description"
              />
              <FieldDescription>Users inherit department-based module access through teams.</FieldDescription>
            </Field>
          </FieldGroup>

          <DialogFooter className="mt-5">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={onSubmit}
              disabled={submitting || !form.name.trim() || !form.department_id}
            >
              {submitting ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export default function TeamsAndDepartmentsPage() {
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);
  const [departmentDialogOpen, setDepartmentDialogOpen] = useState(false);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [departmentMode, setDepartmentMode] = useState<"create" | "edit">("create");
  const [teamMode, setTeamMode] = useState<"create" | "edit">("create");
  const [editingDepartmentId, setEditingDepartmentId] = useState<number | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<number | null>(null);
  const [departmentSubmitting, setDepartmentSubmitting] = useState(false);
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [departmentForm, setDepartmentForm] = useState<DepartmentForm>(emptyDepartmentForm);
  const [teamForm, setTeamForm] = useState<TeamForm>(emptyTeamForm);

  const departmentsQuery = useQuery({
    queryKey: ["admin-departments"],
    queryFn: fetchDepartments,
  });

  const teamsQuery = useQuery({
    queryKey: ["admin-teams"],
    queryFn: fetchTeams,
  });

  const departments = departmentsQuery.data ?? [];
  const teams = teamsQuery.data ?? [];

  const groupedTeams = useMemo(() => {
    const grouped = departments.map((department) => ({
      department,
      teams: teams.filter((team) => team.department_id === department.id),
    }));

    const orphanedTeams = teams.filter(
      (team) => team.department_id == null || !departments.some((department) => department.id === team.department_id)
    );

    if (orphanedTeams.length > 0) {
      grouped.push({
        department: {
          id: -1,
          name: "Unassigned Department",
          description: "Teams with missing department links",
        },
        teams: orphanedTeams,
      });
    }

    return grouped;
  }, [departments, teams]);

  async function refreshData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-departments"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] }),
      queryClient.invalidateQueries({ queryKey: ["user-options"] }),
    ]);
  }

  function openCreateDepartment() {
    setError(null);
    setDepartmentMode("create");
    setEditingDepartmentId(null);
    setDepartmentForm(emptyDepartmentForm);
    setDepartmentDialogOpen(true);
  }

  function openEditDepartment(department: Department) {
    setError(null);
    setDepartmentMode("edit");
    setEditingDepartmentId(department.id);
    setDepartmentForm({
      name: department.name,
      description: department.description ?? "",
    });
    setDepartmentDialogOpen(true);
  }

  function openCreateTeam() {
    setError(null);
    setTeamMode("create");
    setEditingTeamId(null);
    setTeamForm({
      ...emptyTeamForm,
      department_id: departments[0] ? String(departments[0].id) : "",
    });
    setTeamDialogOpen(true);
  }

  function openEditTeam(team: Team) {
    setError(null);
    setTeamMode("edit");
    setEditingTeamId(team.id);
    setTeamForm({
      name: team.name,
      description: team.description ?? "",
      department_id: team.department_id ? String(team.department_id) : "",
    });
    setTeamDialogOpen(true);
  }

  async function saveDepartment() {
    try {
      setDepartmentSubmitting(true);
      setError(null);

      const payload = {
        name: departmentForm.name.trim(),
        description: departmentForm.description.trim() || null,
      };

      const res =
        departmentMode === "create"
          ? await apiFetch("/admin/users/departments", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await apiFetch(`/admin/users/departments/${editingDepartmentId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? "Failed to save department");
      }

      setDepartmentDialogOpen(false);
      setDepartmentForm(emptyDepartmentForm);
      await refreshData();
    } catch (err: any) {
      setError(err.message ?? "Failed to save department");
    } finally {
      setDepartmentSubmitting(false);
    }
  }

  async function saveTeam() {
    try {
      setTeamSubmitting(true);
      setError(null);

      const payload = {
        name: teamForm.name.trim(),
        description: teamForm.description.trim() || null,
        department_id: Number(teamForm.department_id),
      };

      const res =
        teamMode === "create"
          ? await apiFetch("/admin/users/teams", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await apiFetch(`/admin/users/teams/${editingTeamId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? "Failed to save team");
      }

      setTeamDialogOpen(false);
      setTeamForm(emptyTeamForm);
      await refreshData();
    } catch (err: any) {
      setError(err.message ?? "Failed to save team");
    } finally {
      setTeamSubmitting(false);
    }
  }

  async function removeDepartment(department: Department) {
    const confirmed = window.confirm(`Delete department "${department.name}"?`);
    if (!confirmed) return;

    try {
      setError(null);
      const res = await apiFetch(`/admin/users/departments/${department.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? "Failed to delete department");
      }
      await refreshData();
    } catch (err: any) {
      setError(err.message ?? "Failed to delete department");
    }
  }

  async function removeTeam(team: Team) {
    const confirmed = window.confirm(`Delete team "${team.name}"? Users assigned to it will become unassigned.`);
    if (!confirmed) return;

    try {
      setError(null);
      const res = await apiFetch(`/admin/users/teams/${team.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? "Failed to delete team");
      }
      await refreshData();
    } catch (err: any) {
      setError(err.message ?? "Failed to delete team");
    }
  }

  const loading = departmentsQuery.isLoading || teamsQuery.isLoading;

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <div>
        <h1 className="text-2xl font-semibold leading-none">Teams & Departments</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Manage the org structure that drives user assignment and module access.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <Card>
          <SectionHeader
            icon={Building2}
            title="Departments"
            description="Departments act as the permission boundary for modules."
            actionLabel="Create Department"
            onAction={openCreateDepartment}
          />

          <div className="px-5 py-5">
            {loading ? (
              <div className="text-sm text-neutral-500">Loading departments...</div>
            ) : departments.length === 0 ? (
              <div className="rounded-md border border-dashed border-neutral-800 bg-neutral-950/60 px-4 py-10 text-center text-sm text-neutral-500">
                No departments yet.
              </div>
            ) : (
              <div className="space-y-3">
                {departments.map((department) => (
                  <div
                    key={department.id}
                    className="rounded-md border border-neutral-800 bg-neutral-950/70 px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-neutral-100">{department.name}</div>
                        <div className="mt-1 text-sm text-neutral-500">
                          {department.description || "No description"}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button size="icon-sm" variant="outline" onClick={() => openEditDepartment(department)}>
                          <Pencil size={14} />
                        </Button>
                        <Button size="icon-sm" variant="destructive" onClick={() => removeDepartment(department)}>
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <SectionHeader
            icon={UsersRound}
            title="Teams"
            description="Teams place users inside departments and determine module access."
            actionLabel="Create Team"
            onAction={openCreateTeam}
          />

          <div className="px-5 py-5">
            {loading ? (
              <div className="text-sm text-neutral-500">Loading teams...</div>
            ) : teams.length === 0 ? (
              <div className="rounded-md border border-dashed border-neutral-800 bg-neutral-950/60 px-4 py-10 text-center text-sm text-neutral-500">
                No teams yet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-neutral-800">
                <Table>
                  <TableHeader>
                    <TableHeaderRow>
                      <TableHead>Team</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableHeaderRow>
                  </TableHeader>
                  <TableBody>
                    {groupedTeams.flatMap(({ department, teams: departmentTeams }) =>
                      departmentTeams.map((team) => (
                        <TableRow key={team.id}>
                          <TableCell className="font-medium text-neutral-100">{team.name}</TableCell>
                          <TableCell>{department.name}</TableCell>
                          <TableCell className="text-neutral-400">
                            {team.description || "No description"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="icon-sm" variant="outline" onClick={() => openEditTeam(team)}>
                                <Pencil size={14} />
                              </Button>
                              <Button size="icon-sm" variant="destructive" onClick={() => removeTeam(team)}>
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </Card>
      </div>

      <DepartmentDialog
        open={departmentDialogOpen}
        mode={departmentMode}
        form={departmentForm}
        submitting={departmentSubmitting}
        onClose={() => setDepartmentDialogOpen(false)}
        onChange={setDepartmentForm}
        onSubmit={saveDepartment}
      />

      <TeamDialog
        open={teamDialogOpen}
        mode={teamMode}
        form={teamForm}
        departments={departments}
        submitting={teamSubmitting}
        onClose={() => setTeamDialogOpen(false)}
        onChange={setTeamForm}
        onSubmit={saveTeam}
      />
    </div>
  );
}
