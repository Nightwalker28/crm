"use client";

import type { SyntheticEvent } from "react";
import Link from "next/link";
import { Boxes, Power, RefreshCw, Repeat2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { useConfirm } from "@/hooks/useConfirm";
import { useModulesAdmin, useSidebarTabsAdmin } from "@/hooks/admin/useModulesAdmin";
import type { AdminModule } from "@/hooks/admin/useModulesAdmin";
import { getModuleDisplayName } from "@/lib/module-display";
import { SETTINGS_ROUTES } from "@/lib/routes";

const HIDDEN_SIDEBAR_TAB = { key: "none", label: "None" };

function stopRowNavigation(event: SyntheticEvent) {
  event.stopPropagation();
}

export default function ModulesPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const [updateError, setUpdateError] = useState(false);
  const { modules, isLoading, error, refetch, updateModule, isSaving } = useModulesAdmin();
  const { tabs, error: tabsError, refetch: refetchTabs } = useSidebarTabsAdmin();
  const placementOptions = [HIDDEN_SIDEBAR_TAB, ...tabs];

  async function handleUpdate(moduleId: number, payload: Partial<AdminModule>) {
    try {
      setUpdateError(false);
      await updateModule(moduleId, payload);
    } catch {
      setUpdateError(true);
    }
  }

  async function handleEnabledChange(module: AdminModule) {
    if (module.is_enabled) {
      const displayName = getModuleDisplayName(module.name, module.description ?? undefined);
      const confirmed = await confirm({
        title: `Disable ${displayName}?`,
        description: "The module will disappear from tenant navigation and its API access will be blocked for every user. Existing records are retained and the module can be enabled again.",
        confirmLabel: "Disable module",
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    await handleUpdate(module.id, { is_enabled: !module.is_enabled });
  }

  return (
    <div className="flex flex-col gap-6 text-copy-primary">
      <PageHeader
        title="Module Settings"
        description="Enable or disable CRM modules, set module defaults, and control which teams or departments can access each module."
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card variant="status" className="px-4 py-3 text-sm text-copy-secondary">
          Disabled modules disappear from navigation and are blocked at the API level for everyone in this tenant.
        </Card>
        <Card variant="status" className="px-4 py-3 text-sm text-copy-secondary">
          User membership is managed in{" "}
          <Link href={SETTINGS_ROUTES.teams} className="font-medium text-copy-primary underline-offset-4 hover:underline">
            Teams & Departments
          </Link>
          . Department/team module access is configured here, and action access is managed in{" "}
          <Link href={SETTINGS_ROUTES.permissions} className="font-medium text-copy-primary underline-offset-4 hover:underline">
            Roles & Permissions
          </Link>
          .
        </Card>
      </div>

      {tabsError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-state-warning/40 bg-state-warning-muted px-4 py-3 text-sm text-copy-secondary">
          <span>Sidebar groups could not be loaded. Module access and enablement remain available.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetchTabs()}>
            <RefreshCw />
            Try again
          </Button>
        </div>
      ) : null}

      {updateError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-secondary">
          <span>The module setting could not be updated. Review the value and try again.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setUpdateError(false)}>Dismiss</Button>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted p-6">
          <h2 className="text-base font-semibold text-copy-primary">Module settings could not be loaded</h2>
          <p className="mt-2 text-sm text-copy-secondary">Check your connection and try again.</p>
          <Button type="button" className="mt-4" onClick={() => void refetch()}>
            <RefreshCw />
            Try again
          </Button>
        </div>
      ) : (
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
                <TableCell colSpan={6} className="py-10 text-center text-copy-muted" aria-busy="true">Loading modules...</TableCell>
              </TableRow>
            ) : modules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState icon={Boxes} title="No modules found" description="No tenant modules are available to configure." />
                </TableCell>
              </TableRow>
            ) : (
              modules.map((module) => (
                <TableRow
                  key={module.id}
                  tabIndex={0}
                  className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
                  onClick={() => router.push(SETTINGS_ROUTES.moduleAccess(module.id))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push(SETTINGS_ROUTES.moduleAccess(module.id));
                    }
                  }}
                >
                  <TableCell>
                    <div className="font-medium text-copy-primary">
                      {getModuleDisplayName(module.name, module.description ?? undefined)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div onClick={stopRowNavigation} onKeyDown={stopRowNavigation}>
                      <Input
                        key={`${module.id}-${module.display_name ?? ""}`}
                        defaultValue={module.display_name ?? ""}
                        aria-label={`${getModuleDisplayName(module.name, module.description ?? undefined)} sidebar label`}
                        placeholder={getModuleDisplayName(module.name, module.description ?? undefined)}
                        className="w-44"
                        disabled={isSaving}
                        onBlur={(event) => {
                          const value = event.target.value.trim();
                          const current = module.display_name ?? "";
                          if (value !== current) {
                            void handleUpdate(module.id, { display_name: value || null });
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
                          void handleUpdate(module.id, { sidebar_tab_key: value });
                        }}
                        disabled={isSaving || Boolean(tabsError)}
                      >
                        <SelectTrigger className="w-44" aria-label={`${getModuleDisplayName(module.name, module.description ?? undefined)} sidebar group`}>
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
                    <div onClick={stopRowNavigation} onKeyDown={stopRowNavigation}>
                      <Select
                        value={module.import_duplicate_mode}
                        onValueChange={(value) => {
                          void handleUpdate(module.id, { import_duplicate_mode: value as "skip" | "overwrite" | "merge" });
                        }}
                        disabled={isSaving}
                      >
                        <SelectTrigger className="w-44" aria-label={`${getModuleDisplayName(module.name, module.description ?? undefined)} duplicate handling`}>
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
                    <Button
                      asChild
                      variant="outline"
                      onClick={stopRowNavigation}
                      onKeyDown={stopRowNavigation}
                    >
                      <Link href={`${SETTINGS_ROUTES.automation}?module_key=${encodeURIComponent(module.name)}`}>
                        <Repeat2 />
                        Open
                      </Link>
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant={module.is_enabled ? "dangerGhost" : "outline"}
                      aria-pressed={module.is_enabled}
                      aria-label={`${module.is_enabled ? "Disable" : "Enable"} ${getModuleDisplayName(module.name, module.description ?? undefined)}`}
                      disabled={isSaving}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleEnabledChange(module);
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                      className="min-w-32"
                    >
                      <Power />
                      {module.is_enabled ? "Disable" : "Enable"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ModuleTableShell>
      )}
    </div>
  );
}
