"use client";

import { Building2, Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { ActionBar } from "@/components/ui/ActionBar";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { EmptyValue } from "@/components/ui/EmptyValue";
import { EmptyState } from "@/components/ui/EmptyState";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { isForbiddenError } from "@/lib/api";
import { PageShell } from "@/components/ui/PageShell";
import { EditorPanel } from "@/components/ui/EditorPanel";
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

function DepartmentEditorPanel({
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
    <EditorPanel
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
      title={mode === "create" ? "Create department" : "Edit department"}
      description="Group related teams for assignment, reporting, and module availability."
      closeLabel="Close department editor"
      onSubmit={onSubmit}
      status={error
        ? <span role="alert" className="text-state-danger">{error}</span>
        : dirty ? "Unsaved changes"
        : mode === "edit" ? "All changes saved"
        : "Complete the required fields to create this department."}
      footer={(
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" disabled={submitting || !form.name.trim()}>{submitting ? "Saving\u2026" : "Save department"}</Button>
        </>
      )}
    >
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
    </EditorPanel>
  );
}

function TeamEditorPanel({
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
  const selectedDepartment = departments.find(
    (department) => String(department.id) === form.department_id,
  );
  return (
    <EditorPanel
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
      title={mode === "create" ? "Create team" : "Edit team"}
      description={selectedDepartment
        ? `Selected department: ${selectedDepartment.name}`
        : "Select where this team belongs in the organization structure."}
      closeLabel="Close team editor"
      onSubmit={onSubmit}
      status={error
        ? <span role="alert" className="text-state-danger">{error}</span>
        : dirty ? "Unsaved changes"
        : mode === "edit" ? "All changes saved"
        : "Complete the required fields to create this team."}
      footer={(
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" disabled={submitting || !dirty || !form.name.trim() || !form.department_id}>{submitting ? "Saving\u2026" : "Save team"}</Button>
        </>
      )}
    >
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
    </EditorPanel>
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
        confirmLabel: "Discard changes",
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
        confirmLabel: "Discard changes",
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

  return (
    <PageShell
      variant="settings"
      title="Teams"
      description="Departments contain teams. Manage the hierarchy from one workspace."
      actions={(
        <ActionBar>
          <Button type="button" variant="outline" onClick={openCreateDepartment}><Plus />Create department</Button>
          <Button
            type="button"
            onClick={() => openCreateTeam()}
            disabled={!departments.length}
            title={!departments.length ? "Create a department before creating a team" : undefined}
          >
            <Plus />Create team
          </Button>
        </ActionBar>
      )}
      isPermissionDenied={isForbiddenError(loadError)}
      hasError={Boolean(loadError) && !loading}
      errorDescription="The organization structure could not be loaded. Try again or return to Settings."
      onRetry={() => void retryLoad()}
      backHref="/dashboard/settings"
      backLabel="Back to settings"
    >
      {error && !departmentEditorOpen && !teamEditorOpen && !isCreateDepartmentAction && !isCreateTeamAction ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          {error}
          <Button type="button" variant="outline" size="sm" onClick={clearError}>Dismiss</Button>
        </div>
      ) : null}

      {/* R10's escalation clause, answered in the negative: this is a two-level hierarchy,
          and `RecordTable`'s `groupBy` takes a band *label* — it cannot carry a department's
          description, its team count, or its three actions. So the hierarchy stays, and what
          goes is the drift: two icon-chip headers (6d deleted three of the same recipe from
          `backups`), a third container level (§1.3 — a tinted `section` inside a tinted
          `div` inside the panel), and a header that repeated the page description verbatim. */}
      <FormSection title="Departments and teams" description="Every team belongs to a department. Deleting a department does not delete its teams.">
        {loading ? (
          <div className="space-y-4" aria-label="Loading organization structure" aria-busy="true">
            {[0, 1, 2].map((item) => <Skeleton key={item} className="h-24 w-full rounded-[var(--radius-control)]" />)}
          </div>
        ) : departments.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No departments yet"
            description="Create the first department, then add teams inside it."
            action={<Button type="button" onClick={openCreateDepartment}><Plus />Create department</Button>}
          />
        ) : (
          <div className="divide-y divide-line-default">
            {groupedTeams.map(({ department, teams: departmentTeams }) => (
              <section key={department.id} className="py-5 first:pt-0 last:pb-0" aria-labelledby={`department-${department.id}`}>
                <SectionHeading
                  as="h3"
                  id={`department-${department.id}`}
                  description={department.description || undefined}
                  action={department.id !== -1 ? (
                    <ActionBar size="sm">
                      <Button size="sm" variant="ghost" onClick={() => openCreateTeam(department.id)}><Plus />Create team</Button>
                      <Button size="icon-sm" variant="outline" onClick={() => openEditDepartment(department)} aria-label={`Edit ${department.name}`}><Pencil /></Button>
                      {/* R5: `destructive` is a solid red fill, and one per row put twenty
                          of them on this page — the only file in the app that draws a row
                          action that way; every other settings list uses `ghost` or
                          `outline`. The destructive weight belongs in the confirmation,
                          which names the record and the consequence (§7.5), not on twenty
                          idle rows. */}
                      <Button size="icon-sm" variant="outline" onClick={() => removeDepartment(department)} aria-label={`Delete ${department.name}`}><Trash2 /></Button>
                    </ActionBar>
                  ) : undefined}
                >
                  {department.name}
                </SectionHeading>

                {departmentTeams.length === 0 ? (
                  <p className="mt-4 text-sm text-copy-muted">No teams in this department yet.</p>
                ) : (
                  <div className="mt-4 divide-y divide-line-subtle">
                    {departmentTeams.map((team) => (
                      <div key={team.id} className="flex flex-col gap-3 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <UsersRound className="mt-0.5 h-4 w-4 shrink-0 text-copy-muted" aria-hidden="true" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-copy-primary">{team.name}</div>
                            <div className="mt-0.5 text-sm text-copy-muted">{team.description || <EmptyValue />}</div>
                          </div>
                        </div>
                        <ActionBar size="sm" className="self-end sm:self-auto">
                          <Button size="icon-sm" variant="outline" onClick={() => openEditTeam(team)} aria-label={`Edit ${team.name}`}><Pencil /></Button>
                          <Button size="icon-sm" variant="outline" onClick={() => removeTeam(team)} aria-label={`Delete ${team.name}`}><Trash2 /></Button>
                        </ActionBar>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </FormSection>

      <DepartmentEditorPanel
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

      <TeamEditorPanel
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
    </PageShell>
  );
}
