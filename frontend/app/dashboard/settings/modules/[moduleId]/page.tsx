"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Building2, Repeat2, Save, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardFooter } from "@/components/ui/Card";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { PageToolbar } from "@/components/ui/PageToolbar";
import { Pill } from "@/components/ui/Pill";
import { RecordTabs } from "@/components/ui/RecordTabs";
import { RouteErrorState, RouteLoadingState, RouteNotFoundState } from "@/components/ui/RouteStates";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { ModuleAccessConflictError, type ModuleAccess, useModuleAccessAdmin } from "@/hooks/admin/useModulesAdmin";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { getModuleDisplayName } from "@/lib/module-display";
import { SETTINGS_ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

function parseModuleId(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (!rawValue || !/^\d+$/.test(rawValue)) return null;
  const parsed = Number(rawValue);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function toggleId(values: number[], id: number, checked: boolean) {
  if (checked) return values.includes(id) ? values : [...values, id].sort((a, b) => a - b);
  return values.filter((value) => value !== id);
}

function ModuleAccessEditor({
  access,
  isSaving,
  updateAccess,
  reloadAccess,
}: {
  access: ModuleAccess;
  isSaving: boolean;
  updateAccess: (payload: { department_ids: number[]; team_ids: number[] }) => Promise<ModuleAccess>;
  reloadAccess: () => Promise<unknown>;
}) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const moduleDisplayName = getModuleDisplayName(access.module.name, access.module.description ?? undefined);
  const [departmentIds, setDepartmentIds] = useState<number[]>(
    () => access.departments.filter((department) => department.has_access).map((department) => department.id),
  );
  const [teamIds, setTeamIds] = useState<number[]>(
    () => access.teams.filter((team) => team.has_direct_access).map((team) => team.id),
  );
  const [saveError, setSaveError] = useState<"conflict" | "generic" | null>(null);

  const selectedDepartmentIds = useMemo(() => new Set(departmentIds), [departmentIds]);
  const selectedTeamIds = useMemo(() => new Set(teamIds), [teamIds]);
  const hasChanges = useMemo(() => {
    const originalDepartmentIds = access.departments.filter((department) => department.has_access).map((department) => department.id).sort((a, b) => a - b);
    const originalTeamIds = access.teams.filter((team) => team.has_direct_access).map((team) => team.id).sort((a, b) => a - b);
    return (
      originalDepartmentIds.join("|") !== [...departmentIds].sort((a, b) => a - b).join("|") ||
      originalTeamIds.join("|") !== [...teamIds].sort((a, b) => a - b).join("|")
    );
  }, [access, departmentIds, teamIds]);

  useUnsavedChangesGuard(hasChanges, isSaving);

  async function handleSave() {
    try {
      setSaveError(null);
      await updateAccess({ department_ids: departmentIds, team_ids: teamIds });
    } catch (error) {
      setSaveError(error instanceof ModuleAccessConflictError ? "conflict" : "generic");
    }
  }

  async function navigateAway(href: string) {
    if (hasChanges) {
      const confirmed = await confirm({
        title: "Discard module access changes?",
        description: "Leaving this workspace will discard the unsaved department and team access selections.",
        confirmLabel: "Discard and leave",
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    router.push(href);
  }

  const departmentsPanel = (
    <div>
      <p className="border-b border-line-subtle px-5 py-3 text-sm text-copy-secondary">
        Department access opens the parent gate. Select the individual teams that should receive access from the Teams tab.
      </p>
      <ModuleTableShell className="min-h-[44vh] max-h-[58vh] rounded-none border-0">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableHeaderRow>
              <TableHead>Department</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Allow Module</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {access.departments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <EmptyState icon={Building2} title="No departments found" description="Create a department before assigning department-level module access." />
                </TableCell>
              </TableRow>
            ) : access.departments.map((department) => {
              const checked = selectedDepartmentIds.has(department.id);
              return (
                <TableRow key={department.id}>
                  <TableCell><div className="font-medium text-copy-primary">{department.name}</div></TableCell>
                  <TableCell className="text-copy-secondary">{department.description || "-"}</TableCell>
                  <TableCell>
                    {checked ? (
                      <Pill bg="bg-state-success-muted" text="text-state-success" border="border-state-success/40" className="w-24">Allowed</Pill>
                    ) : <Pill className="w-24">Blocked</Pill>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Checkbox
                      aria-label={`Allow ${department.name} department`}
                      checked={checked}
                      onCheckedChange={(nextChecked) => {
                        const allowDepartment = nextChecked === true;
                        setDepartmentIds((current) => toggleId(current, department.id, allowDepartment));
                        if (!allowDepartment) {
                          const childTeamIds = new Set(
                            access.teams
                              .filter((team) => team.department_id === department.id)
                              .map((team) => team.id),
                          );
                          setTeamIds((current) => current.filter((teamId) => !childTeamIds.has(teamId)));
                        }
                      }}
                      className="ml-auto flex h-5 w-5 items-center justify-center rounded border border-line-strong bg-surface text-copy-primary focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <CheckboxIndicator className="h-3.5 w-3.5" />
                    </Checkbox>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ModuleTableShell>
    </div>
  );

  const teamsPanel = (
    <div>
      <p className="border-b border-line-subtle px-5 py-3 text-sm text-copy-secondary">
        A team can be selected only when its parent department is allowed. Unassigned teams use a direct team grant.
      </p>
      <ModuleTableShell className="min-h-[44vh] max-h-[58vh] rounded-none border-0">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableHeaderRow>
              <TableHead>Team</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Allow Team</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {access.teams.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState icon={Users} title="No teams found" description="Create a team before assigning team-level module access." />
                </TableCell>
              </TableRow>
            ) : access.teams.map((team) => {
              const directAccess = selectedTeamIds.has(team.id);
              const hasDepartment = team.department_id != null;
              const departmentAccess = hasDepartment && selectedDepartmentIds.has(team.department_id as number);
              const teamAllowed = directAccess && (!hasDepartment || departmentAccess);
              const checkboxDescriptionId = `team-access-help-${team.id}`;
              return (
                <TableRow key={team.id}>
                  <TableCell><div className="font-medium text-copy-primary">{team.name}</div></TableCell>
                  <TableCell className="text-copy-secondary">{team.department_name || "Unassigned"}</TableCell>
                  <TableCell className="text-copy-secondary">{team.description || "-"}</TableCell>
                  <TableCell>
                    {hasDepartment && !departmentAccess ? (
                      <Pill className="w-44">Blocked by department.</Pill>
                    ) : teamAllowed ? (
                      <Pill bg="bg-state-success-muted" text="text-state-success" border="border-state-success/40" className="w-28">Team access</Pill>
                    ) : hasDepartment ? (
                      <Pill className="w-32">Team blocked</Pill>
                    ) : <Pill className="w-24">Blocked</Pill>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-1.5">
                      <Checkbox
                        aria-label={`Allow ${team.name} team`}
                        aria-describedby={hasDepartment ? checkboxDescriptionId : undefined}
                        checked={directAccess}
                        disabled={(hasDepartment && !departmentAccess) || isSaving}
                        onCheckedChange={(nextChecked) => setTeamIds((current) => toggleId(current, team.id, nextChecked === true))}
                        className="flex h-5 w-5 items-center justify-center rounded border border-line-strong bg-surface text-copy-primary focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <CheckboxIndicator className="h-3.5 w-3.5" />
                      </Checkbox>
                      {hasDepartment ? (
                        <span id={checkboxDescriptionId} className="max-w-44 text-xs text-copy-muted">
                          {departmentAccess
                            ? `${team.department_name || "Parent department"} is allowed; choose this team separately.`
                            : `Allow ${team.department_name || "the parent department"} first.`}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ModuleTableShell>
    </div>
  );

  return (
    <div className="flex flex-col gap-6 text-copy-primary">
      <PageToolbar context={`${moduleDisplayName} access`}>
          <>
            <Button type="button" variant="outline" onClick={() => void navigateAway(SETTINGS_ROUTES.modules)}><ArrowLeft />Module Settings</Button>
            <Button type="button" variant="outline" onClick={() => void navigateAway(`${SETTINGS_ROUTES.automation}?module_key=${encodeURIComponent(access.module.name)}`)}><Repeat2 />Automation</Button>
          </>
      </PageToolbar>

      {!access.module.is_enabled ? (
        <div className="rounded-[var(--radius-control)] border border-state-warning/40 bg-state-warning-muted px-4 py-3 text-sm text-copy-secondary">
          This module is disabled for the tenant. Access selections are retained, but nobody can open it until it is enabled.
        </div>
      ) : null}

      {saveError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-secondary">
          <span>
            {saveError === "conflict"
              ? "A team’s department changed while you were editing. Reload the access rules before saving again."
              : "Module access could not be updated. Your unsaved selections are still available."}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => saveError === "conflict" ? void reloadAccess() : void handleSave()}
            disabled={isSaving}
          >
            {saveError === "conflict" ? "Reload access rules" : "Try again"}
          </Button>
        </div>
      ) : null}

      <Card className="min-w-0 overflow-hidden">
        <div className="border-b border-line-subtle px-5 py-4">
          <h2 className="font-semibold text-copy-primary">Access rules</h2>
          <p className="mt-1 text-sm text-copy-muted">Departments are the parent gate. Teams inside an allowed department remain individually selectable.</p>
        </div>
        <RecordTabs
          className="gap-0"
          tabs={[
            { id: "departments", label: `Departments (${access.departments.length})`, content: departmentsPanel },
            { id: "teams", label: `Teams (${access.teams.length})`, content: teamsPanel },
          ]}
        />
        <CardFooter className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 bg-surface/95 backdrop-blur">
          <p className={cn("mr-auto text-sm font-medium", hasChanges ? "text-state-warning" : "text-state-success")}>
            {hasChanges ? "Unsaved changes" : "All changes saved"}
          </p>
          <Button type="button" onClick={() => void handleSave()} disabled={!hasChanges || isSaving}>
            <Save />{isSaving ? "Saving..." : "Save Access"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function ModuleAccessPage() {
  const params = useParams<{ moduleId?: string }>();
  const moduleId = parseModuleId(params.moduleId);
  const { access, isLoading, error, refetch, updateAccess, isSaving } = useModuleAccessAdmin(moduleId);

  if (moduleId === null) {
    return <RouteNotFoundState recordLabel="Module" backHref={SETTINGS_ROUTES.modules} backLabel="Back to module settings" />;
  }
  if (isLoading) return <RouteLoadingState label="module access settings" />;
  if (error) {
    return (
      <RouteErrorState
        title="Module access could not be loaded"
        description="Check your connection and try again. No access settings were changed."
        reset={() => void refetch()}
        backHref={SETTINGS_ROUTES.modules}
        backLabel="Back to module settings"
      />
    );
  }
  if (access) {
    const accessKey = [
      access.module.id,
      access.departments.filter((department) => department.has_access).map((department) => department.id).sort((a, b) => a - b).join("."),
      access.teams.filter((team) => team.has_direct_access).map((team) => team.id).sort((a, b) => a - b).join("."),
      access.teams.map((team) => `${team.id}.${team.department_id ?? "none"}.${team.access_state}`).join("|"),
    ].join(":");
    return (
      <ModuleAccessEditor
        key={accessKey}
        access={access}
        isSaving={isSaving}
        updateAccess={updateAccess}
        reloadAccess={refetch}
      />
    );
  }
  return <RouteNotFoundState recordLabel="Module" backHref={SETTINGS_ROUTES.modules} backLabel="Back to module settings" />;
}
