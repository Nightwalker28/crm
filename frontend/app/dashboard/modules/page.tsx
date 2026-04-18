"use client";

import { Switch } from "@/components/ui/switch";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { useModulesAdmin } from "@/hooks/admin/useModulesAdmin";

export default function ModulesPage() {
  const { modules, isLoading, updateModule, isSaving } = useModulesAdmin();

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-100">Modules</h1>
        <p className="mt-1 text-sm text-neutral-400">Enable or disable product modules globally. Disabled modules disappear from user navigation and accessible module lists.</p>
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
                  <TableCell>{module.name}</TableCell>
                  <TableCell>{module.base_route || "-"}</TableCell>
                  <TableCell>{module.description || "-"}</TableCell>
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
