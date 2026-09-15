"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Boxes, RefreshCw, Repeat2, Save, Settings2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { StatusValue } from "@/components/ui/StatusValue";
import { SegmentedBoolean } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { isForbiddenError } from "@/lib/api";
import { PageShell } from "@/components/ui/PageShell";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RecordTable } from "@/components/ui/RecordTable";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { useConfirm } from "@/hooks/useConfirm";
import { useModulesAdmin, useSidebarTabsAdmin } from "@/hooks/admin/useModulesAdmin";
import type { AdminModule } from "@/hooks/admin/useModulesAdmin";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { getModuleDisplayName } from "@/lib/module-display";
import { SETTINGS_ROUTES } from "@/lib/routes";

const HIDDEN_SIDEBAR_TAB = { key: "none", label: "Not shown" };

type ModuleDraft = {
  display_name: string;
  sidebar_tab_key: string;
  import_duplicate_mode: "skip" | "overwrite" | "merge";
  is_enabled: boolean;
};

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
    <PageShell
      variant="settings"
      title="Module Settings"
      description="Enable modules and assign department or team access."
      isPermissionDenied={isForbiddenError(error)}
      hasError={Boolean(error)}
      errorDescription="Check your connection and try again. No module settings were changed."
      onRetry={() => void refetch()}
      backHref="/dashboard/settings"
      backLabel="Back to Settings"
    >
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

      {/* R10. The hand-rolled row gesture went with it: this file had its own `tabIndex`,
          `onKeyDown` and a `stopRowNavigation` helper on the action cell, all of which
          `RecordTable` owns — the action column is `interactive`, so a click there never
          opens the row. The `min-w-[880px]` is derived from the columns now. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchBar value={search} onChange={setSearch} placeholder="Search modules" className="sm:max-w-sm" />
        <span className="text-sm text-copy-muted">{isLoading ? "Loading…" : `${visibleModules.length} of ${modules.length} modules`}</span>
      </div>
      <RecordTable
        label="Modules"
        columns={[
          {
            key: "module",
            label: "Module",
            size: "lg",
            render: (module) => (
              <>
                <div className="font-medium text-copy-primary">{getModuleDisplayName(module.name, module.description ?? undefined)}</div>
                <div className="mt-1 text-xs text-copy-muted">{module.name}</div>
              </>
            ),
          },
          {
            key: "navigation",
            label: "Navigation",
            size: "lg",
            render: (module) => (
              <>
                <div className="text-copy-primary">{module.display_name || getModuleDisplayName(module.name, module.description ?? undefined)}</div>
                <div className="mt-1 text-xs text-copy-muted">{module.sidebar_tab_label || "Not shown in sidebar"}</div>
              </>
            ),
          },
          { key: "duplicates", label: "Duplicate handling", render: (module) => duplicateModeLabel(module.import_duplicate_mode) },
          {
            key: "status",
            label: "Status",
            size: "sm",
            render: (module) => <StatusValue status={{ tone: module.is_enabled ? "success" : "neutral", label: module.is_enabled ? "Enabled" : "Disabled" }} />,
          },
        ]}
        rows={visibleModules}
        rowKey={(module) => module.id}
        rowHref={(module) => SETTINGS_ROUTES.moduleAccess(module.id)}
        rowLabel={(module) => `Open access settings for ${getModuleDisplayName(module.name, module.description ?? undefined)}`}
        isLoading={isLoading}
        rowActionsLabel="Actions"
        rowActions={(module) => {
          const displayName = getModuleDisplayName(module.name, module.description ?? undefined);
          return (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" aria-label={`Edit ${displayName} settings`} onClick={() => openEditor(module)}><Settings2 />Edit</Button>
              <Button asChild variant="ghost" size="sm">
                <Link href={SETTINGS_ROUTES.moduleAccess(module.id)}><ShieldCheck />Access</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href={`${SETTINGS_ROUTES.automation}?module=${encodeURIComponent(module.name)}`}><Repeat2 />Automation</Link>
              </Button>
            </div>
          );
        }}
        hasActiveFilters={Boolean(search.trim())}
        onClearFilters={() => setSearch("")}
        filteredEmptyState={{
          icon: Boxes,
          title: "No matching modules",
          description: "Adjust the search to find another module.",
        }}
        emptyState={{
          icon: Boxes,
          title: "No modules found",
          description: "No tenant modules are available to configure.",
        }}
      />

      <EditorPanel
        open={editorOpen}
        onOpenChange={(open) => { if (!open) void closeEditor(); }}
        title="Edit module settings"
        description={selectedModule ? getModuleDisplayName(selectedModule.name, selectedModule.description ?? undefined) : "Module"}
        closeLabel="Close module settings"
        onSubmit={() => void saveModuleSettings()}
        status={updateError
          ? <span role="alert" className="text-state-danger">The module setting could not be updated. Review the value and try again.</span>
          : isDirty ? "Unsaved changes" : "All changes saved"}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => void closeEditor()} disabled={isSaving}>Cancel</Button>
            <Button type="submit" disabled={isSaving || !isDirty}><Save />{isSaving ? "Saving\u2026" : "Save changes"}</Button>
          </>
        )}
      >
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
              <SegmentedBoolean
                aria-label="Module availability"
                value={draft.is_enabled}
                onValueChange={(is_enabled) => setDraft((current) => (current ? { ...current, is_enabled } : current))}
                trueLabel="Enabled"
                falseLabel="Disabled"
                disabled={isSaving}
              />
              <FieldDescription>Disabled modules are hidden and blocked at the API level; existing records are retained.</FieldDescription>
            </Field>
          </FieldGroup>
        ) : null}
      </EditorPanel>
    </PageShell>
  );
}
