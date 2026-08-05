"use client";

import type { SyntheticEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Boxes, RefreshCw, Repeat2, Save, Settings2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Pill } from "@/components/ui/Pill";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { useConfirm } from "@/hooks/useConfirm";
import { useModulesAdmin, useSidebarTabsAdmin } from "@/hooks/admin/useModulesAdmin";
import type { AdminModule } from "@/hooks/admin/useModulesAdmin";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { getModuleDisplayName } from "@/lib/module-display";
import { SETTINGS_ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

const HIDDEN_SIDEBAR_TAB = { key: "none", label: "Not shown" };

type ModuleDraft = {
  display_name: string;
  sidebar_tab_key: string;
  import_duplicate_mode: "skip" | "overwrite" | "merge";
  is_enabled: boolean;
};

function stopRowNavigation(event: SyntheticEvent) {
  event.stopPropagation();
}

function moduleDraft(module: AdminModule): ModuleDraft {
  return {
    display_name: module.display_name ?? "",
    sidebar_tab_key: module.sidebar_tab_key ?? "none",
    import_duplicate_mode: module.import_duplicate_mode,
    is_enabled: module.is_enabled,
  };
}

function draftSignature(draft: ModuleDraft | null) {
  return draft ? JSON.stringify(draft) : "";
}

function duplicateModeLabel(mode: AdminModule["import_duplicate_mode"]) {
  if (mode === "overwrite") return "Overwrite existing";
  if (mode === "merge") return "Merge values";
  return "Skip duplicates";
}

export default function ModulesPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const { modules, isLoading, error, refetch, updateModule, isSaving } = useModulesAdmin();
  const { tabs, error: tabsError, refetch: refetchTabs } = useSidebarTabsAdmin();
  const [search, setSearch] = useState("");
  const [selectedModule, setSelectedModule] = useState<AdminModule | null>(null);
  const [draft, setDraft] = useState<ModuleDraft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [updateError, setUpdateError] = useState(false);
  const placementOptions = [HIDDEN_SIDEBAR_TAB, ...tabs];
  const isDirty = draftSignature(draft) !== baseline;

  useUnsavedChangesGuard(isDirty, isSaving);

  const visibleModules = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return modules;
    return modules.filter((module) => [
      module.name,
      module.display_name,
      module.description,
      module.sidebar_tab_label,
    ].some((value) => value?.toLowerCase().includes(query)));
  }, [modules, search]);

  function openEditor(module: AdminModule) {
    const nextDraft = moduleDraft(module);
    setSelectedModule(module);
    setDraft(nextDraft);
    setBaseline(draftSignature(nextDraft));
    setUpdateError(false);
    setEditorOpen(true);
  }

  async function canCloseEditor() {
    if (!isDirty) return true;
    return confirm({
      title: "Discard module changes?",
      description: "Closing this editor will discard the unsaved navigation, duplicate-handling, and availability changes.",
      confirmLabel: "Discard changes",
      variant: "destructive",
    });
  }

  async function closeEditor() {
    if (!(await canCloseEditor())) return;
    setEditorOpen(false);
    setSelectedModule(null);
    setDraft(null);
    setBaseline("");
    setUpdateError(false);
  }

  async function saveModuleSettings() {
    if (!selectedModule || !draft) return;
    if (selectedModule.is_enabled && !draft.is_enabled) {
      const displayName = getModuleDisplayName(selectedModule.name, selectedModule.description ?? undefined);
      const confirmed = await confirm({
        title: `Disable ${displayName}?`,
        description: "The module will disappear from tenant navigation and its API access will be blocked for every user. Existing records are retained and the module can be enabled again.",
        confirmLabel: "Disable module",
        variant: "destructive",
      });
      if (!confirmed) return;
    }

    try {
      setUpdateError(false);
      await updateModule(selectedModule.id, {
        display_name: draft.display_name.trim() || null,
        sidebar_tab_key: draft.sidebar_tab_key,
        import_duplicate_mode: draft.import_duplicate_mode,
        is_enabled: draft.is_enabled,
      });
      setEditorOpen(false);
      setSelectedModule(null);
      setDraft(null);
      setBaseline("");
      toast.success("Module settings saved.");
    } catch {
      setUpdateError(true);
    }
  }

  return (
    <div className="flex flex-col gap-6 text-copy-primary">
      <Card variant="status" className="px-4 py-3 text-sm text-copy-secondary">
        Module availability applies tenant-wide. Department and team access is managed separately, while action access remains in{" "}
        <Link href={SETTINGS_ROUTES.permissions} className="font-medium text-copy-primary underline-offset-4 hover:underline">Roles & Permissions</Link>.
      </Card>

      {tabsError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-state-warning/40 bg-state-warning-muted px-4 py-3 text-sm text-copy-secondary">
          <span>Sidebar groups could not be loaded. Module access and availability remain available.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetchTabs()}><RefreshCw />Try again</Button>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted p-6">
          <h2 className="text-base font-semibold text-copy-primary">Module settings could not be loaded</h2>
          <p className="mt-2 text-sm text-copy-secondary">Check your connection and try again.</p>
          <Button type="button" className="mt-4" onClick={() => void refetch()}><RefreshCw />Try again</Button>
        </div>
      ) : (
        <ModuleTableShell>
          <div className="flex flex-col gap-3 border-b border-line-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchBar value={search} onChange={setSearch} placeholder="Search modules" className="sm:max-w-sm" />
            <span className="text-sm text-copy-muted">{isLoading ? "Loading..." : `${visibleModules.length} of ${modules.length} modules`}</span>
          </div>
          <Table className="min-w-[880px]">
            <TableHeader>
              <TableHeaderRow>
                <TableHead>Module</TableHead>
                <TableHead>Navigation</TableHead>
                <TableHead>Duplicate Handling</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableHeaderRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="py-10 text-center text-copy-muted" aria-busy="true">Loading modules...</TableCell></TableRow>
              ) : visibleModules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <EmptyState
                      icon={Boxes}
                      title={modules.length ? "No matching modules" : "No modules found"}
                      description={modules.length ? "Adjust the search to find another module." : "No tenant modules are available to configure."}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                visibleModules.map((module) => {
                  const displayName = getModuleDisplayName(module.name, module.description ?? undefined);
                  return (
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
                        <div className="font-medium text-copy-primary">{displayName}</div>
                        <div className="mt-1 font-mono text-xs text-copy-muted">{module.name}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-copy-primary">{module.display_name || displayName}</div>
                        <div className="mt-1 text-xs text-copy-muted">{module.sidebar_tab_label || "Not shown in sidebar"}</div>
                      </TableCell>
                      <TableCell className="text-copy-secondary">{duplicateModeLabel(module.import_duplicate_mode)}</TableCell>
                      <TableCell>
                        <Pill
                          bg={module.is_enabled ? "bg-state-success-muted" : undefined}
                          text={module.is_enabled ? "text-state-success" : undefined}
                          border={module.is_enabled ? "border-state-success/40" : undefined}
                        >
                          {module.is_enabled ? "Enabled" : "Disabled"}
                        </Pill>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2" onClick={stopRowNavigation} onKeyDown={stopRowNavigation}>
                          <Button type="button" variant="outline" size="sm" aria-label={`Edit ${displayName} settings`} onClick={() => openEditor(module)}><Settings2 />Edit</Button>
                          <Button asChild variant="ghost" size="sm">
                            <Link href={SETTINGS_ROUTES.moduleAccess(module.id)}><ShieldCheck />Access</Link>
                          </Button>
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`${SETTINGS_ROUTES.automation}?module_key=${encodeURIComponent(module.name)}`}><Repeat2 />Automation</Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </ModuleTableShell>
      )}

      <Sheet open={editorOpen} onOpenChange={(open) => { if (!open) void closeEditor(); }}>
        <SheetPortal>
          <SheetOverlay className="fixed inset-0 z-40 bg-overlay" />
          <SheetContent side="right" className="z-50 flex h-full w-full max-w-[34rem] flex-col border-l border-line-default bg-surface-raised shadow-2xl outline-none">
            <SheetHeader className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
              <div>
                <SheetTitle className="text-lg font-semibold text-copy-primary">Edit module settings</SheetTitle>
                <SheetDescription className="mt-1 text-sm text-copy-muted">
                  {selectedModule ? getModuleDisplayName(selectedModule.name, selectedModule.description ?? undefined) : "Module"}
                </SheetDescription>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Close module settings" onClick={() => void closeEditor()}><X /></Button>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {updateError ? (
                <div role="alert" className="mb-5 rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-secondary">
                  The module setting could not be updated. Review the value and try again.
                </div>
              ) : null}
              {draft ? (
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="module-sidebar-label">Sidebar label</FieldLabel>
                    <Input
                      id="module-sidebar-label"
                      value={draft.display_name}
                      onChange={(event) => setDraft((current) => current ? { ...current, display_name: event.target.value } : current)}
                      placeholder={selectedModule ? getModuleDisplayName(selectedModule.name, selectedModule.description ?? undefined) : "Module name"}
                      disabled={isSaving}
                    />
                    <FieldDescription>Leave blank to use the standard module name.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Sidebar group</FieldLabel>
                    <Select
                      value={draft.sidebar_tab_key}
                      onValueChange={(value) => setDraft((current) => current ? { ...current, sidebar_tab_key: value } : current)}
                      disabled={isSaving || Boolean(tabsError)}
                    >
                      <SelectTrigger className="w-full" aria-label="Sidebar group"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {placementOptions.map((tab) => <SelectItem key={tab.key} value={tab.key}>{tab.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FieldDescription>Controls where the module appears in tenant navigation.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Import duplicate handling</FieldLabel>
                    <Select
                      value={draft.import_duplicate_mode}
                      onValueChange={(value) => setDraft((current) => current ? { ...current, import_duplicate_mode: value as ModuleDraft["import_duplicate_mode"] } : current)}
                      disabled={isSaving}
                    >
                      <SelectTrigger className="w-full" aria-label="Import duplicate handling"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skip">Skip duplicate rows</SelectItem>
                        <SelectItem value="overwrite">Overwrite existing values</SelectItem>
                        <SelectItem value="merge">Merge non-empty values</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Module availability</FieldLabel>
                    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Module availability">
                      <Button
                        type="button"
                        variant={draft.is_enabled ? "secondary" : "outline"}
                        aria-pressed={draft.is_enabled}
                        onClick={() => setDraft((current) => current ? { ...current, is_enabled: true } : current)}
                        disabled={isSaving}
                      >Enabled</Button>
                      <Button
                        type="button"
                        variant={!draft.is_enabled ? "secondary" : "outline"}
                        aria-pressed={!draft.is_enabled}
                        onClick={() => setDraft((current) => current ? { ...current, is_enabled: false } : current)}
                        disabled={isSaving}
                      >Disabled</Button>
                    </div>
                    <FieldDescription>Disabled modules are hidden and blocked at the API level; existing records are retained.</FieldDescription>
                  </Field>
                </FieldGroup>
              ) : null}
            </div>

            <SheetFooter className="flex flex-col gap-3 border-t border-line-subtle bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <span className={cn("text-sm", isDirty ? "text-state-warning" : "text-state-success")}>{isDirty ? "Unsaved changes" : "All changes saved"}</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => void closeEditor()} disabled={isSaving}>Cancel</Button>
                <Button type="button" onClick={() => void saveModuleSettings()} disabled={isSaving || !isDirty}><Save />{isSaving ? "Saving..." : "Save changes"}</Button>
              </div>
            </SheetFooter>
          </SheetContent>
        </SheetPortal>
      </Sheet>
    </div>
  );
}
