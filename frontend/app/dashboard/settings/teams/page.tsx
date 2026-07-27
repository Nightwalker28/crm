"use client";

import { Building2, Pencil, Plus, Trash2, UsersRound, type LucideIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  Dialog,
  DialogBackdrop,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { RouteErrorState } from "@/components/ui/RouteStates";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  type Department,
  type DepartmentForm,
  type TeamForm,
  useTeamsAndDepartments,
} from "@/hooks/admin/useTeamsAndDepartments";
import { useConfirm } from "@/hooks/useConfirm";

function SectionHeader({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionDisabled = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-default px-5 py-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-2 text-copy-secondary">
          <Icon size={16} aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-copy-primary">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-copy-muted">{description}</p>
        </div>
      </div>

      <Button onClick={onAction} disabled={actionDisabled}>
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
  error,
  submitting,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  form: DepartmentForm;
  error: string | null;
  submitting: boolean;
  onClose: () => void;
  onChange: (next: DepartmentForm) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel size="lg">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "Create Department" : "Edit Department"}</DialogTitle>
            <DialogIconClose />
          </DialogHeader>

          <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
            {error ? (
              <div role="alert" className="mt-4 rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
                {error}
              </div>
            ) : null}
            <FieldGroup className="mt-4">
            <Field>
              <FieldLabel htmlFor="department-name">Name <RequiredMark /></FieldLabel>
              <Input
                id="department-name"
                value={form.name}
                onChange={(event) => onChange({ ...form, name: event.target.value })}
                placeholder="Revenue Operations"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="department-description">Description</FieldLabel>
              <Input
                id="department-description"
                value={form.description}
                onChange={(event) => onChange({ ...form, description: event.target.value })}
                placeholder="Optional description"
              />
              <FieldDescription>Departments organize teams for assignment and can be selected for module access from Modules.</FieldDescription>
            </Field>
            </FieldGroup>

            <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submitting || !form.name.trim()}>
              {submitting ? "Saving..." : "Save"}
            </Button>
            </DialogFooter>
          </form>
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
  error,
  submitting,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  form: TeamForm;
  departments: Department[];
  error: string | null;
  submitting: boolean;
  onClose: () => void;
  onChange: (next: TeamForm) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel size="lg">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "Create Team" : "Edit Team"}</DialogTitle>
            <DialogIconClose />
          </DialogHeader>

          <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
            {error ? (
              <div role="alert" className="mt-4 rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
                {error}
              </div>
            ) : null}
            <FieldGroup className="mt-4">
            <Field>
              <FieldLabel htmlFor="team-name">Name <RequiredMark /></FieldLabel>
              <Input
                id="team-name"
                value={form.name}
                onChange={(event) => onChange({ ...form, name: event.target.value })}
                placeholder="Platform Admins"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="team-department">Department <RequiredMark /></FieldLabel>
              <Select value={form.department_id} onValueChange={(value) => onChange({ ...form, department_id: value })}>
                <SelectTrigger id="team-department">
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
              <FieldLabel htmlFor="team-description">Description</FieldLabel>
              <Input
                id="team-description"
                value={form.description}
                onChange={(event) => onChange({ ...form, description: event.target.value })}
                placeholder="Optional description"
              />
              <FieldDescription>Teams place users in the org structure and can be selected for module access from Modules.</FieldDescription>
            </Field>
            </FieldGroup>

            <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              disabled={submitting || !form.name.trim() || !form.department_id}
            >
              {submitting ? "Saving..." : "Save"}
            </Button>
            </DialogFooter>
          </form>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function EntityCard({
  title,
  subtitle,
  meta,
  onEdit,
  onDelete,
}: {
  title: string;
  subtitle: string;
  meta?: string | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line-default bg-surface-muted px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-copy-primary">{title}</div>
          <div className="mt-1 text-sm leading-6 text-copy-secondary">{subtitle}</div>
          {meta ? <div className="mt-2 text-xs uppercase tracking-wide text-copy-muted">{meta}</div> : null}
        </div>

        <div className="flex items-center gap-2">
          <Button size="icon-sm" variant="outline" onClick={onEdit} aria-label={`Edit ${title}`}>
            <Pencil size={14} aria-hidden="true" />
          </Button>
          <Button size="icon-sm" variant="destructive" onClick={onDelete} aria-label={`Delete ${title}`}>
            <Trash2 size={14} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function TeamsAndDepartmentsPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const searchParams = useSearchParams();
  const requestedAction = searchParams.get("action");
  const isCreateTeamAction = requestedAction === "create-team";
  const isCreateDepartmentAction = requestedAction === "create-department";
  const {
    departments,
    teams,
    groupedTeams,
    error,
    clearError,
    loading,
    refreshing,
    loadError,
    retryLoad,
    departmentDirty,
    teamDirty,
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

  async function closeTeamWorkflow() {
    if (teamDirty) {
      const confirmed = await confirm({
        title: "Discard team changes?",
        description: "Your unsaved team changes will be lost.",
        confirmLabel: "Discard Changes",
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    clearError();
    setTeamDialogOpen(false);
    if (isCreateTeamAction) {
      router.replace("/dashboard/settings/teams", { scroll: false });
    }
  }

  async function closeDepartmentWorkflow() {
    if (departmentDirty) {
      const confirmed = await confirm({
        title: "Discard department changes?",
        description: "Your unsaved department changes will be lost.",
        confirmLabel: "Discard Changes",
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    clearError();
    setDepartmentDialogOpen(false);
    if (isCreateDepartmentAction) {
      router.replace("/dashboard/settings/teams", { scroll: false });
    }
  }

  async function saveTeamWorkflow() {
    if (await saveTeam() && isCreateTeamAction) {
      router.replace("/dashboard/settings/teams", { scroll: false });
    }
  }

  async function saveDepartmentWorkflow() {
    if (await saveDepartment() && isCreateDepartmentAction) {
      router.replace("/dashboard/settings/teams", { scroll: false });
    }
  }

  if (loadError && !loading) {
    return (
      <RouteErrorState
        title="Unable to load teams and departments"
        description="The organization structure could not be loaded. Try again or return to Settings."
        reset={() => void retryLoad()}
        backHref="/dashboard/settings"
        backLabel="Back to Settings"
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Teams & Departments"
        description="Manage the org structure used for user assignment, ownership, reporting, and module access targeting."
        eyebrow={refreshing && !loading ? "Refreshing" : undefined}
      />

      {error && !departmentDialogOpen && !teamDialogOpen && !isCreateDepartmentAction && !isCreateTeamAction ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          {error}
          <Button type="button" variant="outline" size="sm" onClick={clearError}>Dismiss</Button>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <Card>
          <SectionHeader
            icon={Building2}
            title="Departments"
            description="Departments group teams and can be granted module availability from Modules."
            actionLabel="Create Department"
            onAction={openCreateDepartment}
          />

          <div className="px-5 py-5">
            {loading ? (
              <div className="space-y-3" aria-label="Loading departments" aria-busy="true">
                {[0, 1, 2].map((item) => <Skeleton key={item} className="h-24 w-full rounded-[var(--radius-card)]" />)}
              </div>
            ) : departments.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No departments yet"
                description="Create the first department to organize teams and module availability."
                action={<Button type="button" variant="outline" onClick={openCreateDepartment}><Plus />Create department</Button>}
              />
            ) : (
              <div className="space-y-3">
                {departments.map((department) => (
                  <EntityCard
                    key={department.id}
                    title={department.name}
                    subtitle={department.description || "No description"}
                    onEdit={() => openEditDepartment(department)}
                    onDelete={() => removeDepartment(department)}
                  />
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <SectionHeader
            icon={UsersRound}
            title="Teams"
            description="Teams place users inside departments and can be granted module availability from Modules."
            actionLabel="Create Team"
            onAction={openCreateTeam}
            actionDisabled={!departments.length}
          />

          <div className="px-5 py-5">
            {loading ? (
              <div className="space-y-3" aria-label="Loading teams" aria-busy="true">
                {[0, 1, 2].map((item) => <Skeleton key={item} className="h-24 w-full rounded-[var(--radius-card)]" />)}
              </div>
            ) : teams.length === 0 ? (
              <EmptyState
                icon={UsersRound}
                title="No teams yet"
                description={departments.length
                  ? "Create the first team and place it inside a department."
                  : "Create a department before adding teams."}
                action={departments.length
                  ? <Button type="button" variant="outline" onClick={openCreateTeam}><Plus />Create team</Button>
                  : undefined}
              />
            ) : (
              <div className="space-y-3">
                {groupedTeams.flatMap(({ department, teams: departmentTeams }) =>
                  departmentTeams.map((team) => (
                    <EntityCard
                      key={team.id}
                      title={team.name}
                      subtitle={team.description || "No description"}
                      meta={department.name}
                      onEdit={() => openEditTeam(team)}
                      onDelete={() => removeTeam(team)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      <DepartmentDialog
        open={departmentDialogOpen || isCreateDepartmentAction}
        mode={departmentMode}
        form={departmentForm}
        error={error}
        submitting={departmentSubmitting}
        onClose={() => void closeDepartmentWorkflow()}
        onChange={setDepartmentForm}
        onSubmit={() => void saveDepartmentWorkflow()}
      />

      <TeamDialog
        open={teamDialogOpen || isCreateTeamAction}
        mode={teamMode}
        form={teamForm}
        departments={departments}
        error={error}
        submitting={teamSubmitting}
        onClose={() => void closeTeamWorkflow()}
        onChange={setTeamForm}
        onSubmit={() => void saveTeamWorkflow()}
      />
    </div>
  );
}
