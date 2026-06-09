"use client";

import type { SyntheticEvent } from "react";
import Link from "next/link";
import { Power, Repeat2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { useModulesAdmin, useSidebarTabsAdmin } from "@/hooks/admin/useModulesAdmin";
import { getModuleDisplayName } from "@/lib/module-display";
import { SETTINGS_ROUTES } from "@/lib/routes";

const HIDDEN_SIDEBAR_TAB = { key: "none", label: "None" };

function stopRowNavigation(event: SyntheticEvent) {
  event.stopPropagation();
}

export default function ModulesPage() {
  const router = useRouter();
  const { modules, isLoading, updateModule, isSaving } = useModulesAdmin();
  const { tabs } = useSidebarTabsAdmin();
  const placementOptions = [HIDDEN_SIDEBAR_TAB, ...tabs];

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Module Settings"
        description="Enable or disable CRM modules, set module defaults, and control which teams or departments can access each module."
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-neutral-800 bg-neutral-950/70 px-4 py-3 text-sm text-neutral-400">
          Disabled modules disappear from navigation and are blocked at the API level for everyone in this tenant.
        </div>
        <div className="rounded-md border border-neutral-800 bg-neutral-950/70 px-4 py-3 text-sm text-neutral-400">
          User membership is managed in{" "}
          <Link href={SETTINGS_ROUTES.teams} className="text-neutral-100 underline-offset-4 hover:underline">
            Teams & Departments
          </Link>
          . Department/team module access is configured here, and action access is managed in{" "}
          <Link href={SETTINGS_ROUTES.permissions} className="text-neutral-100 underline-offset-4 hover:underline">
            Roles & Permissions
          </Link>
          .
        </div>
      </div>

      <ModuleTableShell>
        <Table className="min-w-[920px]">
          <TableHeader>
            <TableHeaderRow>
              <TableHead>Module</TableHead>
              <TableHead>Sidebar Label</TableHead>
              <TableHead>Sidebar Group</TableHead>
              <TableHead>Duplicate Handling</TableHead>
              <TableHead>Automation</TableHead>
              <TableHead>Enable / Disable</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-neutral-500">Loading modules...</TableCell>
              </TableRow>
            ) : (
              modules.map((module) => (
                <TableRow
                  key={module.id}
                  tabIndex={0}
                  className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white/20"
                  onClick={() => router.push(SETTINGS_ROUTES.moduleAccess(module.id))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push(SETTINGS_ROUTES.moduleAccess(module.id));
                    }
                  }}
                >
                  <TableCell>
                    <div className="font-medium text-neutral-100">
                      {getModuleDisplayName(module.name, module.description ?? undefined)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div onClick={stopRowNavigation} onKeyDown={stopRowNavigation}>
                      <Input
                        defaultValue={module.display_name ?? ""}
                        placeholder={getModuleDisplayName(module.name, module.description ?? undefined)}
                        className="w-44 bg-neutral-950"
                        disabled={isSaving}
                        onBlur={(event) => {
                          const value = event.target.value.trim();
                          const current = module.display_name ?? "";
                          if (value !== current) {
                            void updateModule(module.id, { display_name: value || null });
                          }
                        }}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <div onClick={stopRowNavigation} onKeyDown={stopRowNavigation}>
                      <Select
                        value={module.sidebar_tab_key ?? "none"}
                        onValueChange={(value) => {
                          void updateModule(module.id, { sidebar_tab_key: value });
                        }}
                        disabled={isSaving}
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue placeholder="Select group" />
                        </SelectTrigger>
                        <SelectContent>
                          {placementOptions.map((tab) => (
                            <SelectItem key={tab.key} value={tab.key}>
                              {tab.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`${SETTINGS_ROUTES.automation}?module_key=${encodeURIComponent(module.name)}`}
                      onClick={stopRowNavigation}
                      onKeyDown={stopRowNavigation}
                      className="inline-flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-800"
                    >
                      <Repeat2 size={15} />
                      Open
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div onClick={stopRowNavigation} onKeyDown={stopRowNavigation}>
                      <Select
                        value={module.import_duplicate_mode}
                        onValueChange={(value) => {
                          void updateModule(module.id, { import_duplicate_mode: value as "skip" | "overwrite" | "merge" });
                        }}
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
                    </div>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      aria-pressed={module.is_enabled}
                      aria-label={`${module.is_enabled ? "Disable" : "Enable"} ${getModuleDisplayName(module.name, module.description ?? undefined)}`}
                      disabled={isSaving}
                      onClick={(event) => {
                        event.stopPropagation();
                        void updateModule(module.id, { is_enabled: !module.is_enabled });
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                      className={`inline-flex min-w-32 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        module.is_enabled
                          ? "border-red-800/70 bg-red-950/30 text-red-200 hover:bg-red-950/50"
                          : "border-emerald-800/70 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-950/50"
                      }`}
                    >
                      <Power size={15} />
                      {module.is_enabled ? "Disable" : "Enable"}
                    </button>
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
