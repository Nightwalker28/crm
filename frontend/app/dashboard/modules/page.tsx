"use client";

import { Switch } from "@/components/ui/switch";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { useModulesAdmin } from "@/hooks/admin/useModulesAdmin";

export default function ModulesPage() {
  const { modules, isLoading, updateModule, isSaving } = useModulesAdmin();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Modules"
        description="Enable or disable modules for this tenant. Role-level access is managed from Roles & Permissions."
      />

      <div className="rounded-md border border-neutral-800 bg-neutral-950/70 px-4 py-3 text-sm text-neutral-400">
        Disabled modules disappear from navigation and are blocked at the API level for everyone in this tenant.
      </div>

      <ModuleTableShell>
        <Table className="min-w-[1100px]">
          <TableHeader>
            <TableHeaderRow>
              <TableHead>Module</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Import Duplicate Default</TableHead>
              <TableHead className="text-right">Enabled</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-neutral-500">Loading modules...</TableCell>
              </TableRow>
            ) : (
              modules.map((module) => (
                <TableRow key={module.id}>
                  <TableCell>
                    <div className="font-medium text-neutral-100">{module.name}</div>
                    {!module.is_enabled ? <div className="mt-1 text-xs text-red-300">Disabled for this tenant</div> : null}
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
                  <TableCell className="text-right">
                    <div className="flex justify-end">
                      <Switch
                        checked={module.is_enabled}
                        disabled={isSaving}
                        onCheckedChange={(checked) => updateModule(module.id, { is_enabled: checked })}
                      />
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
