"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { type ModuleAccess, useModuleAccessAdmin } from "@/hooks/admin/useModulesAdmin";

function parseModuleId(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function toggleId(values: number[], id: number, checked: boolean) {
  if (checked) {
    return values.includes(id) ? values : [...values, id].sort((a, b) => a - b);
  }

  return values.filter((value) => value !== id);
}

function ModuleAccessEditor({
  access,
  isSaving,
  updateAccess,
}: {
  access: ModuleAccess;
  isSaving: boolean;
  updateAccess: (payload: { department_ids: number[]; team_ids: number[] }) => Promise<ModuleAccess>;
}) {
  const [departmentIds, setDepartmentIds] = useState<number[]>(
    () => access.departments.filter((department) => department.has_access).map((department) => department.id),
  );
  const [teamIds, setTeamIds] = useState<number[]>(
    () => access.teams.filter((team) => team.has_access).map((team) => team.id),
  );

  const selectedDepartmentIds = useMemo(() => new Set(departmentIds), [departmentIds]);
  const selectedTeamIds = useMemo(() => new Set(teamIds), [teamIds]);

  const hasChanges = useMemo(() => {
    const originalDepartmentIds = access.departments.filter((department) => department.has_access).map((department) => department.id).sort((a, b) => a - b);
    const originalTeamIds = access.teams.filter((team) => team.has_access).map((team) => team.id).sort((a, b) => a - b);
    return (
      originalDepartmentIds.join("|") !== [...departmentIds].sort((a, b) => a - b).join("|") ||
      originalTeamIds.join("|") !== [...teamIds].sort((a, b) => a - b).join("|")
    );
  }, [access, departmentIds, teamIds]);

  async function handleSave() {
    await updateAccess({
      department_ids: departmentIds,
      team_ids: teamIds,
    });
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title={`${access.module.name} Access`}
        description="Choose which departments and teams can open this enabled module. Roles & Permissions still control actions inside the module."
        actions={
          <>
            <Link
              href="/dashboard/modules"
              className="inline-flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-800"
            >
              <ArrowLeft size={15} />
              Modules
            </Link>
            <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
              <Save />
              {isSaving ? "Saving..." : "Save Access"}
            </Button>
          </>
        }
      />

      {!access.module.is_enabled ? (
        <div className="rounded-md border border-amber-800/70 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          This module is disabled for the tenant. Department and team access is saved here, but nobody can open the module until it is enabled.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-neutral-800 bg-neutral-950/70 px-4 py-3 text-sm text-neutral-400">
          Department access grants the module to every user whose team belongs to that department.
        </div>
        <div className="rounded-md border border-neutral-800 bg-neutral-950/70 px-4 py-3 text-sm text-neutral-400">
          Team access grants the module to specific teams. Team grants can add access even when the department is not selected.
        </div>
      </div>

      <ModuleTableShell className="min-h-[32vh] max-h-[44vh]">
        <Table className="min-w-[980px]">
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
                <TableCell colSpan={4} className="py-10 text-center text-neutral-500">No departments found.</TableCell>
              </TableRow>
            ) : (
              access.departments.map((department) => {
                const checked = selectedDepartmentIds.has(department.id);
                return (
                  <TableRow key={department.id}>
                    <TableCell>
                      <div className="font-medium text-neutral-100">{department.name}</div>
                    </TableCell>
                    <TableCell className="text-neutral-400">{department.description || "-"}</TableCell>
                    <TableCell>
                      {checked ? (
                        <Pill bg="bg-emerald-950/60" text="text-emerald-200" border="border-emerald-800/70" className="w-24">
                          Allowed
                        </Pill>
                      ) : (
                        <Pill bg="bg-neutral-900" text="text-neutral-300" border="border-neutral-700" className="w-24">
                          Blocked
                        </Pill>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) => setDepartmentIds((current) => toggleId(current, department.id, nextChecked === true))}
                        className="ml-auto flex h-5 w-5 items-center justify-center rounded border border-neutral-700 bg-neutral-900 text-white"
                      >
                        <CheckboxIndicator className="h-3.5 w-3.5" />
                      </Checkbox>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </ModuleTableShell>

      <ModuleTableShell className="min-h-[32vh] max-h-[44vh]">
        <Table className="min-w-[980px]">
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
                <TableCell colSpan={5} className="py-10 text-center text-neutral-500">No teams found.</TableCell>
              </TableRow>
            ) : (
              access.teams.map((team) => {
                const directAccess = selectedTeamIds.has(team.id);
                const inheritedAccess = Boolean(team.department_id && selectedDepartmentIds.has(team.department_id));
                return (
                  <TableRow key={team.id}>
                    <TableCell>
                      <div className="font-medium text-neutral-100">{team.name}</div>
                    </TableCell>
                    <TableCell className="text-neutral-400">{team.department_name || "Unassigned"}</TableCell>
                    <TableCell className="text-neutral-400">{team.description || "-"}</TableCell>
                    <TableCell>
                      {directAccess ? (
                        <Pill bg="bg-emerald-950/60" text="text-emerald-200" border="border-emerald-800/70" className="w-24">
                          Allowed
                        </Pill>
                      ) : inheritedAccess ? (
                        <Pill bg="bg-sky-950/60" text="text-sky-200" border="border-sky-800/70" className="w-32">
                          Department
                        </Pill>
                      ) : (
                        <Pill bg="bg-neutral-900" text="text-neutral-300" border="border-neutral-700" className="w-24">
                          Blocked
                        </Pill>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Checkbox
                        checked={directAccess}
                        onCheckedChange={(nextChecked) => setTeamIds((current) => toggleId(current, team.id, nextChecked === true))}
                        className="ml-auto flex h-5 w-5 items-center justify-center rounded border border-neutral-700 bg-neutral-900 text-white"
                      >
                        <CheckboxIndicator className="h-3.5 w-3.5" />
                      </Checkbox>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </ModuleTableShell>
    </div>
  );
}

export default function ModuleAccessPage() {
  const params = useParams<{ moduleId?: string }>();
  const moduleId = parseModuleId(params.moduleId);
  const { access, isLoading, updateAccess, isSaving } = useModuleAccessAdmin(moduleId);

  if (access) {
    const accessKey = [
      access.module.id,
      access.departments.filter((department) => department.has_access).map((department) => department.id).sort((a, b) => a - b).join("."),
      access.teams.filter((team) => team.has_access).map((team) => team.id).sort((a, b) => a - b).join("."),
    ].join(":");

    return <ModuleAccessEditor key={accessKey} access={access} isSaving={isSaving} updateAccess={updateAccess} />;
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Module Access"
        description="Choose which departments and teams can open this enabled module. Roles & Permissions still control actions inside the module."
        actions={
          <Link
            href="/dashboard/modules"
            className="inline-flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-800"
          >
            <ArrowLeft size={15} />
            Modules
          </Link>
        }
      />

      <ModuleTableShell className="min-h-[32vh] max-h-[44vh]">
        <Table className="min-w-[980px]">
          <TableBody>
            <TableRow>
              <TableCell className="py-10 text-center text-neutral-500">
                {isLoading ? "Loading module access..." : "Module access could not be loaded."}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ModuleTableShell>
    </div>
  );
}
