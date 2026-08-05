"use client";

import { Building2, Pencil, Plus, Trash2, UsersRound, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { RouteErrorState } from "@/components/ui/RouteStates";
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
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

function DepartmentEditorSheet({
  open,
  mode,
  form,
  error,
  dirty,
  submitting,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  form: DepartmentForm;
  error: string | null;
  dirty: boolean;
  submitting: boolean;
  onClose: () => void;
  onChange: (next: DepartmentForm) => void;
  onSubmit: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <SheetPortal>
        <SheetOverlay className="fixed inset-0 z-40 bg-overlay" />
        <SheetContent side="right" className="z-50 flex h-full w-full max-w-[32rem] flex-col border-l border-line-default bg-surface-raised shadow-2xl outline-none">
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
            <SheetHeader className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
              <div>
                <SheetTitle className="text-lg font-semibold text-copy-primary">{mode === "create" ? "Create Department" : "Edit Department"}</SheetTitle>
                <SheetDescription className="mt-1 text-sm text-copy-secondary">Group related teams for assignment, reporting, and module availability.</SheetDescription>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Close department editor" onClick={onClose}><X /></Button>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {error ? (
              <div role="alert" className="mb-4 rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
                {error}
              </div>
            ) : null}
            <FieldGroup>
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
            </div>
            <SheetFooter className="flex flex-col gap-3 border-t border-line-subtle bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <span className={`text-sm ${dirty ? "text-state-warning" : "text-state-success"}`}>{dirty ? "Unsaved changes" : "All changes saved"}</span>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
                <Button type="submit" disabled={submitting || !form.name.trim()}>{submitting ? "Saving..." : "Save Department"}</Button>
              </div>
            </SheetFooter>
          </form>
        </SheetContent>
      </SheetPortal>
    </Sheet>
  );
}

function TeamEditorSheet({
  open,
  mode,
  form,
  departments,
  error,
  dirty,
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
  dirty: boolean;
  submitting: boolean;
  onClose: () => void;
  onChange: (next: TeamForm) => void;
  onSubmit: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <SheetPortal>
        <SheetOverlay className="fixed inset-0 z-40 bg-overlay" />
        <SheetContent side="right" className="z-50 flex h-full w-full max-w-[32rem] flex-col border-l border-line-default bg-surface-raised shadow-2xl outline-none">
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
            <SheetHeader className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
              <div>
                <SheetTitle className="text-lg font-semibold text-copy-primary">{mode === "create" ? "Create Team" : "Edit Team"}</SheetTitle>
                <SheetDescription className="mt-1 text-sm text-copy-secondary">Place this team inside the organization structure.</SheetDescription>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Close team editor" onClick={onClose}><X /></Button>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {error ? (
              <div role="alert" className="mb-4 rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
                {error}
              </div>
            ) : null}
            <FieldGroup>
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
            </div>
            <SheetFooter className="flex flex-col gap-3 border-t border-line-subtle bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <span className={`text-sm ${dirty ? "text-state-warning" : "text-state-success"}`}>{dirty ? "Unsaved changes" : "All changes saved"}</span>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
                <Button type="submit" disabled={submitting || !form.name.trim() || !form.department_id}>{submitting ? "Saving..." : "Save Team"}</Button>
              </div>
            </SheetFooter>
          </form>
        </SheetContent>
      </SheetPortal>
    </Sheet>
  );
}

export default function TeamsAndDepartmentsPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const initializedActionRef = useRef<string | null>(null);
  const searchParams = useSearchParams();
  const requestedAction = searchParams.get("action");
  const isCreateTeamAction = requestedAction === "create-team";
  const isCreateDepartmentAction = requestedAction === "create-department";
  const {
    departments,
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

  const departmentEditorOpen = departmentDialogOpen || isCreateDepartmentAction;
  const teamEditorOpen = teamDialogOpen || isCreateTeamAction;

  useEffect(() => {
    if (loading || initializedActionRef.current === requestedAction) return;
    if (isCreateDepartmentAction) openCreateDepartment();
    if (isCreateTeamAction) openCreateTeam();
    initializedActionRef.current = requestedAction;
  }, [isCreateDepartmentAction, isCreateTeamAction, loading, openCreateDepartment, openCreateTeam, requestedAction]);

  useUnsavedChangesGuard(
    (departmentEditorOpen && departmentDirty) || (teamEditorOpen && teamDirty),
    departmentSubmitting || teamSubmitting,
  );

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
      {error && !departmentDialogOpen && !teamDialogOpen && !isCreateDepartmentAction && !isCreateTeamAction ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          {error}
          <Button type="button" variant="outline" size="sm" onClick={clearError}>Dismiss</Button>
        </div>
      ) : null}

      <Card>
        <div className="flex flex-col gap-4 border-b border-line-default px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-2 text-copy-secondary">
              <Building2 size={16} aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-copy-primary">Organization structure</h2>
              <p className="mt-1 text-sm leading-6 text-copy-muted">Departments contain teams. Manage the hierarchy from one workspace.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={openCreateDepartment}><Plus />Create Department</Button>
            <Button type="button" onClick={openCreateTeam} disabled={!departments.length}><Plus />Create Team</Button>
          </div>
        </div>

        <div className="px-5 py-5">
          {loading ? (
            <div className="space-y-4" aria-label="Loading organization structure" aria-busy="true">
              {[0, 1, 2].map((item) => <Skeleton key={item} className="h-36 w-full rounded-[var(--radius-card)]" />)}
            </div>
          ) : departments.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No departments yet"
              description="Create the first department, then add teams inside it."
              action={<Button type="button" onClick={openCreateDepartment}><Plus />Create Department</Button>}
            />
          ) : (
            <div className="space-y-4">
              {groupedTeams.map(({ department, teams: departmentTeams }) => (
                <section key={department.id} className="overflow-hidden rounded-[var(--radius-card)] border border-line-default bg-surface-muted" aria-labelledby={`department-${department.id}`}>
                  <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="rounded-[var(--radius-control)] border border-line-default bg-surface-raised p-2 text-copy-secondary"><Building2 size={15} aria-hidden="true" /></div>
                      <div className="min-w-0">
                        <h3 id={`department-${department.id}`} className="text-sm font-semibold text-copy-primary">{department.name}</h3>
                        <p className="mt-1 text-sm leading-6 text-copy-secondary">{department.description || "No description"}</p>
                        <p className="mt-1 text-xs text-copy-muted">{departmentTeams.length} {departmentTeams.length === 1 ? "team" : "teams"}</p>
                      </div>
                    </div>
                    {department.id !== -1 ? (
                      <div className="flex items-center gap-2">
                        <Button size="icon-sm" variant="outline" onClick={() => openEditDepartment(department)} aria-label={`Edit ${department.name}`}><Pencil size={14} aria-hidden="true" /></Button>
                        <Button size="icon-sm" variant="destructive" onClick={() => removeDepartment(department)} aria-label={`Delete ${department.name}`}><Trash2 size={14} aria-hidden="true" /></Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="border-t border-line-default bg-surface-raised">
                    {departmentTeams.length === 0 ? (
                      <div className="flex flex-col gap-3 px-4 py-4 text-sm text-copy-muted sm:flex-row sm:items-center sm:justify-between">
                        <span>No teams in this department.</span>
                        <Button type="button" variant="ghost" size="sm" onClick={openCreateTeam}><Plus />Add team</Button>
                      </div>
                    ) : (
                      <div className="divide-y divide-line-subtle">
                        {departmentTeams.map((team) => (
                          <div key={team.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-start gap-3">
                              <UsersRound className="mt-0.5 h-4 w-4 shrink-0 text-copy-muted" aria-hidden="true" />
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-copy-primary">{team.name}</div>
                                <div className="mt-0.5 text-sm text-copy-muted">{team.description || "No description"}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 self-end sm:self-auto">
                              <Button size="icon-sm" variant="outline" onClick={() => openEditTeam(team)} aria-label={`Edit ${team.name}`}><Pencil size={14} aria-hidden="true" /></Button>
                              <Button size="icon-sm" variant="destructive" onClick={() => removeTeam(team)} aria-label={`Delete ${team.name}`}><Trash2 size={14} aria-hidden="true" /></Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </Card>

      <DepartmentEditorSheet
        open={departmentEditorOpen}
        mode={departmentMode}
        form={departmentForm}
        error={error}
        dirty={departmentDirty}
        submitting={departmentSubmitting}
        onClose={() => void closeDepartmentWorkflow()}
        onChange={setDepartmentForm}
        onSubmit={() => void saveDepartmentWorkflow()}
      />

      <TeamEditorSheet
        open={teamEditorOpen}
        mode={teamMode}
        form={teamForm}
        departments={departments}
        error={error}
        dirty={teamDirty}
        submitting={teamSubmitting}
        onClose={() => void closeTeamWorkflow()}
        onChange={setTeamForm}
        onSubmit={() => void saveTeamWorkflow()}
      />
    </div>
  );
}
