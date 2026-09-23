"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Building2, Repeat2, Save, Users } from "lucide-react";

import { Chip } from "@/components/ui/Chip";
import { StatusValue } from "@/components/ui/StatusValue";
import { ActionBar } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/button";
import { Card, CardFooter } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/checkbox";
import { RecordTable } from "@/components/ui/RecordTable";
import { isForbiddenError } from "@/lib/api";
import { PageShell } from "@/components/ui/PageShell";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { RouteNotFoundState } from "@/components/ui/RouteStates";
import { ModuleAccessConflictError, type ModuleAccess, useModuleAccessAdmin } from "@/hooks/admin/useModulesAdmin";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { getModuleDisplayName } from "@/lib/module-display";
import { SETTINGS_ROUTES } from "@/lib/routes";

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
      <RecordTable
        label="Departments"
        shellVariant="nested"
        rows={access.departments}
        rowKey={(department) => department.id}
        emptyState={{
          icon: Building2,
          title: "No departments found",
          description: "Create a department before assigning department-level module access.",
        }}
        columns={[
          {
            key: "name",
            label: "Department",
            size: "lg",
            render: (department) => <div className="font-medium text-copy-primary">{department.name}</div>,
          },
          {
            key: "description",
            label: "Description",
            size: "lg",
            render: (department) => <span className="text-copy-secondary">{department.description || "-"}</span>,
          },
          {
            key: "status",
            label: "Status",
            render: (department) => (
              selectedDepartmentIds.has(department.id)
                ? <StatusValue status={{ tone: "success", label: "Allowed" }} className="w-24" />
                : <Chip className="w-24">Blocked</Chip>
            ),
          },
          {
            key: "allow",
            label: "Allow module",
            align: "right",
            interactive: true,
            render: (department) => (
              <Checkbox
                aria-label={`Allow ${department.name} department`}
                checked={selectedDepartmentIds.has(department.id)}
                disabled={isSaving}
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
                className="ml-auto"
              />
            ),
          },
        ]}
      />
    </div>
  );

  const teamsPanel = (
    <div>
      <p className="border-b border-line-subtle px-5 py-3 text-sm text-copy-secondary">
        A team can be selected only when its parent department is allowed. Unassigned teams use a direct team grant.
      </p>
      <RecordTable
        label="Teams"
        shellVariant="nested"
        rows={access.teams}
        rowKey={(team) => team.id}
        emptyState={{
          icon: Users,
          title: "No teams found",
          description: "Create a team before assigning team-level module access.",
        }}
        columns={[
          {
            key: "name",
            label: "Team",
            render: (team) => <div className="font-medium text-copy-primary">{team.name}</div>,
          },
          {
            key: "department",
            label: "Department",
            render: (team) => <span className="text-copy-secondary">{team.department_name || "Unassigned"}</span>,
          },
          {
            key: "description",
            label: "Description",
            size: "lg",
            render: (team) => <span className="text-copy-secondary">{team.description || "-"}</span>,
          },
          {
            key: "status",
            label: "Status",
            size: "lg",
            render: (team) => {
              const hasDepartment = team.department_id != null;
              const departmentAccess = hasDepartment && selectedDepartmentIds.has(team.department_id as number);
              if (hasDepartment && !departmentAccess) return <Chip className="w-44">Blocked by department.</Chip>;
              if (selectedTeamIds.has(team.id)) return <StatusValue status={{ tone: "success", label: "Team access" }} className="w-28" />;
              return hasDepartment ? <Chip className="w-32">Team blocked</Chip> : <Chip className="w-24">Blocked</Chip>;
            },
          },
          {
            key: "allow",
            label: "Allow team",
            align: "right",
            size: "lg",
            interactive: true,
            render: (team) => {
              const hasDepartment = team.department_id != null;
              const departmentAccess = hasDepartment && selectedDepartmentIds.has(team.department_id as number);
              const checkboxDescriptionId = `team-access-help-${team.id}`;
              return (
                <div className="flex flex-col items-end gap-1.5">
                  <Checkbox
                    aria-label={`Allow ${team.name} team`}
                    aria-describedby={hasDepartment ? checkboxDescriptionId : undefined}
                    checked={selectedTeamIds.has(team.id)}
                    disabled={(hasDepartment && !departmentAccess) || isSaving}
                    onCheckedChange={(nextChecked) => setTeamIds((current) => toggleId(current, team.id, nextChecked === true))}
                  />
                  {hasDepartment ? (
                    <span id={checkboxDescriptionId} className="max-w-44 text-xs text-copy-muted">
                      {departmentAccess
                        ? `${team.department_name || "Parent department"} is allowed; choose this team separately.`
                        : `Allow ${team.department_name || "the parent department"} first.`}
                    </span>
                  ) : null}
                </div>
              );
            },
          },
        ]}
      />
    </div>
  );

  return (
    <PageShell
      variant="settings"
      title="Access settings"
      description={`Choose which departments and teams can reach ${moduleDisplayName}.`}
      context={`${moduleDisplayName} access`}
      actions={(
        <>
          <Button type="button" variant="outline" onClick={() => void navigateAway(SETTINGS_ROUTES.modules)}><ArrowLeft />Module settings</Button>
          <Button type="button" variant="outline" onClick={() => void navigateAway(`${SETTINGS_ROUTES.automation}?module=${encodeURIComponent(access.module.name)}`)}><Repeat2 />Automation</Button>
        </>
      )}
    >

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
        <div className="px-6 py-4">
          <h2 className="font-semibold text-copy-primary">Access rules</h2>
          <p className="mt-1 text-sm text-copy-muted">Departments are the parent gate. Teams inside an allowed department remain individually selectable.</p>
        </div>
        <SectionTabs
          aria-label="Module access"
          panelPadding="none"
          tabs={[
            { id: "departments", label: `Departments (${access.departments.length})`, content: departmentsPanel },
            { id: "teams", label: `Teams (${access.teams.length})`, content: teamsPanel },
          ]}
        />
        {/* Department and team access commit together in one write, so the manual save
            stays (archetype 4). R3 takes the stickiness; R5 takes the colour. */}
        <CardFooter className="flex flex-wrap items-center gap-3">
          <p className="mr-auto text-sm text-copy-muted">
            {hasChanges ? "Unsaved changes" : "All changes saved"}
          </p>
          <ActionBar size="default">
            <Button type="button" onClick={() => void handleSave()} disabled={!hasChanges || isSaving}>
              <Save />{isSaving ? "Saving…" : "Save access"}
            </Button>
          </ActionBar>
        </CardFooter>
      </Card>
    </PageShell>
  );
}

export default function ModuleAccessPage() {
  const params = useParams<{ moduleId?: string }>();
  const moduleId = parseModuleId(params.moduleId);
  const { access, isLoading, error, refetch, updateAccess, isSaving } = useModuleAccessAdmin(moduleId);

  if (moduleId === null || isLoading || error || !access) {
    return (
      <PageShell
        variant="settings"
        title="Access settings"
        isLoading={isLoading}
        isPermissionDenied={isForbiddenError(error)}
        hasError={Boolean(error) || moduleId === null || !access}
        errorState={
          moduleId === null || (!error && !access) ? (
            <RouteNotFoundState titleAs="p" recordLabel="Module" backHref={SETTINGS_ROUTES.modules} backLabel="Back to module settings" />
          ) : undefined
        }
        errorDescription="Check your connection and try again. No access settings were changed."
        onRetry={() => void refetch()}
        backHref={SETTINGS_ROUTES.modules}
        backLabel="Back to module settings"
      >
        {null}
      </PageShell>
    );
  }
  {
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
}
