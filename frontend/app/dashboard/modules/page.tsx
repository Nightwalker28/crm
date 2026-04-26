"use client";

import Link from "next/link";
import { Power, SlidersHorizontal } from "lucide-react";

import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { useModulesAdmin } from "@/hooks/admin/useModulesAdmin";

export default function ModulesPage() {
  const { modules, isLoading, updateModule, isSaving } = useModulesAdmin();

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Modules"
        description="Enable or disable whole modules for this tenant, set module defaults, and choose which departments or teams can open enabled modules."
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-neutral-800 bg-neutral-950/70 px-4 py-3 text-sm text-neutral-400">
          Disabled modules disappear from navigation and are blocked at the API level for everyone in this tenant.
        </div>
        <div className="rounded-md border border-neutral-800 bg-neutral-950/70 px-4 py-3 text-sm text-neutral-400">
          User membership is managed in{" "}
          <Link href="/dashboard/user/teams" className="text-neutral-100 underline-offset-4 hover:underline">
            Teams & Departments
          </Link>
          . Department/team module access is configured here, and action access is managed in{" "}
          <Link href="/dashboard/roles-permissions" className="text-neutral-100 underline-offset-4 hover:underline">
            Roles & Permissions
          </Link>
          .
        </div>
      </div>

      <ModuleTableShell>
        <Table className="min-w-[1100px]">
          <TableHeader>
            <TableHeaderRow>
              <TableHead>Module</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Import Duplicate Default</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Access</TableHead>
              <TableHead className="text-right">Enable / Disable</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-neutral-500">Loading modules...</TableCell>
              </TableRow>
            ) : (
              modules.map((module) => (
                <TableRow key={module.id}>
                  <TableCell>
                    <div className="font-medium text-neutral-100">{module.name}</div>
                  </TableCell>
                  <TableCell className="text-neutral-400">{module.base_route || "-"}</TableCell>
                  <TableCell className="max-w-sm text-neutral-400">{module.description || "-"}</TableCell>
                  <TableCell>
                    <Select
                      value={module.import_duplicate_mode}
                      onValueChange={(value) => updateModule(module.id, { import_duplicate_mode: value as "skip" | "overwrite" | "merge" })}
                      disabled={isSaving}
                    >
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder="Select mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skip">Skip</SelectItem>
                        <SelectItem value="overwrite">Overwrite</SelectItem>
                        <SelectItem value="merge">Merge</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {module.is_enabled ? (
                      <Pill bg="bg-emerald-950/60" text="text-emerald-200" border="border-emerald-800/70" className="w-24">
                        Enabled
                      </Pill>
                    ) : (
                      <Pill bg="bg-red-950/60" text="text-red-200" border="border-red-800/70" className="w-24">
                        Disabled
                      </Pill>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/dashboard/modules/${module.id}`}
                      className="inline-flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-800"
                    >
                      <SlidersHorizontal size={15} />
                      Configure
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        aria-pressed={module.is_enabled}
                        aria-label={`${module.is_enabled ? "Disable" : "Enable"} ${module.name}`}
                        disabled={isSaving}
                        onClick={() => updateModule(module.id, { is_enabled: !module.is_enabled })}
                        className={`inline-flex min-w-36 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                          module.is_enabled
                            ? "border-red-800/70 bg-red-950/30 text-red-200 hover:bg-red-950/50"
                            : "border-emerald-800/70 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-950/50"
                        }`}
                      >
                        <Power size={15} />
                        {module.is_enabled ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ModuleTableShell>
    </div>
  );
}
