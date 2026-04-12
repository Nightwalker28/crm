"use client";

import { Building2, Pencil, Plus, Trash2, UsersRound, type LucideIcon } from "lucide-react";

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
import {
  type Department,
  type DepartmentForm,
  type TeamForm,
  useTeamsAndDepartments,
} from "@/hooks/admin/useTeamsAndDepartments";

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
  const {
    departments,
    teams,
    groupedTeams,
    error,
    loading,
    departmentDialogOpen,
    teamDialogOpen,
    departmentMode,
    teamMode,
    departmentSubmitting,
    teamSubmitting,
    departmentForm,
    teamForm,
    setDepartmentDialogOpen,
    setTeamDialogOpen,
    setDepartmentForm,
    setTeamForm,
    openCreateDepartment,
    openEditDepartment,
    openCreateTeam,
    openEditTeam,
    saveDepartment,
    saveTeam,
    removeDepartment,
    removeTeam,
  } = useTeamsAndDepartments();

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
