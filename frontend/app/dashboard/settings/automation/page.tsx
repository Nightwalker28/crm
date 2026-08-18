"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, History, Plus, Workflow } from "lucide-react";
import { toast } from "sonner";

import { AutomationRuleEditor } from "@/components/automation/AutomationRuleEditor";
import { AutomationRulesTable } from "@/components/automation/AutomationRulesTable";
import { AutomationRunDetails } from "@/components/automation/AutomationRunDetails";
import { AutomationRunsTable } from "@/components/automation/AutomationRunsTable";
import type { AutomationRule, AutomationRun } from "@/components/automation/types";
import { formatModuleLabel, ruleToDraft, serializeDraft } from "@/components/automation/utils";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldLabel } from "@/components/ui/field";
import { PageShell } from "@/components/ui/PageShell";
import { RouteLoadingState } from "@/components/ui/RouteStates";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteAutomationRule, persistAutomationRule, previewAutomationRule, useAutomationRules, useAutomationRuns, useAutomationTriggers } from "@/hooks/useAutomationRules";
import { useConfirm } from "@/hooks/useConfirm";
import { MODULE_REGISTRY, getModuleRegistryLabel } from "@/lib/module-registry";
import { SETTINGS_ROUTES } from "@/lib/routes";

type Workspace = "rules" | "editor" | "runs";

export default function AutomationSettingsPage() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const selectedModuleKey = (searchParams.get("module_key") || searchParams.get("module"))?.trim() || null;
  const [workspace, setWorkspace] = useState<Workspace>(searchParams.get("view") === "runs" ? "runs" : "rules");
  const [editorRule, setEditorRule] = useState<AutomationRule | undefined>();
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [ruleSearch, setRuleSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [runRuleFilter, setRunRuleFilter] = useState(searchParams.get("rule_id") ?? "all");
  const [runStatusFilter, setRunStatusFilter] = useState("all");
  const [selectedRun, setSelectedRun] = useState<AutomationRun | null>(null);

  const rulesQuery = useAutomationRules(selectedModuleKey);
  const triggersQuery = useAutomationTriggers();
  const runsQuery = useAutomationRuns(selectedModuleKey, null, workspace === "runs");
  const triggerGroups = useMemo(() => {
    const groups = triggersQuery.data ?? [];
    return selectedModuleKey ? groups.filter((group) => group.module_key === selectedModuleKey) : groups;
  }, [selectedModuleKey, triggersQuery.data]);
  const triggerLabels = useMemo(() => new Map((triggersQuery.data ?? []).flatMap((group) => group.triggers.map((trigger) => [trigger.key, trigger.label] as const))), [triggersQuery.data]);

  const filteredRules = useMemo(() => {
    const search = ruleSearch.trim().toLowerCase();
    return (rulesQuery.data ?? []).filter((rule) => {
      if (statusFilter === "enabled" && !rule.enabled) return false;
      if (statusFilter === "disabled" && rule.enabled) return false;
      return !search || [rule.name, rule.description, rule.trigger_event, rule.module_key].some((value) => value?.toLowerCase().includes(search));
    });
  }, [ruleSearch, rulesQuery.data, statusFilter]);
  const filteredRuns = useMemo(() => (runsQuery.data ?? []).filter((run) => {
    if (runRuleFilter !== "all" && run.rule_id !== Number(runRuleFilter)) return false;
    return runStatusFilter === "all" || run.status === runStatusFilter;
  }), [runRuleFilter, runStatusFilter, runsQuery.data]);

  const updateRuleMutation = useMutation({
    mutationFn: async ({ rule, enabled }: { rule: AutomationRule; enabled: boolean }) => {
      const draft = ruleToDraft(rule);
      if (enabled) {
        const preview = await previewAutomationRule(serializeDraft(draft, true));
        if (!preview.can_enable) throw new Error("cannot_enable");
      }
      return persistAutomationRule(rule.id, serializeDraft(draft, enabled));
    },
    onSuccess: async (rule) => { toast.success(rule.enabled ? "Automation rule enabled." : "Automation rule disabled."); await queryClient.invalidateQueries({ queryKey: ["automation-rules"] }); },
    onError: (error) => toast.error(error.message === "cannot_enable" ? "This rule cannot be enabled until preview validation passes." : "The automation rule could not be updated."),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAutomationRule,
    onSuccess: async () => { toast.success("Automation rule deleted."); await queryClient.invalidateQueries({ queryKey: ["automation-rules"] }); },
    onError: () => toast.error("The automation rule could not be deleted."),
  });

  function openEditor(rule?: AutomationRule, duplicate = false) { setEditorRule(rule); setIsDuplicate(duplicate); setWorkspace("editor"); }
  function changeModule(value: string) {
    window.location.href = value === "all" ? SETTINGS_ROUTES.automation : `${SETTINGS_ROUTES.automation}?module_key=${encodeURIComponent(value)}`;
  }
  async function toggleRule(rule: AutomationRule) {
    if (rule.enabled) {
      const confirmed = await confirm({ title: `Disable ${rule.name}?`, description: "New matching events will stop running this rule until it is enabled again.", confirmLabel: "Disable rule", variant: "destructive" });
      if (!confirmed) return;
    }
    updateRuleMutation.mutate({ rule, enabled: !rule.enabled });
  }
  async function removeRule(rule: AutomationRule) {
    const confirmed = await confirm({ title: `Delete ${rule.name}?`, description: "The rule will stop running. Existing run history remains available for audit.", confirmLabel: "Delete rule", variant: "destructive" });
    if (confirmed) deleteMutation.mutate(rule.id);
  }
  function viewRuns(rule?: AutomationRule) { setRunRuleFilter(rule ? String(rule.id) : "all"); setWorkspace("runs"); }

  const isResolving = rulesQuery.isLoading || triggersQuery.isLoading;
  const failedToLoad = rulesQuery.isError || triggersQuery.isError;
  if (isResolving || failedToLoad) {
    return (
      <PageShell
        variant="settings"
        title="Automation"
        description="Rules that run when records change."
        isLoading={isResolving}
        hasError={failedToLoad}
        errorDescription="Your rules are unchanged. Try loading the workspace again."
        onRetry={() => { void rulesQuery.refetch(); void triggersQuery.refetch(); }}
        backHref="/dashboard/settings"
        backLabel="Return to settings"
      >
        {null}
      </PageShell>
    );
  }

  if (workspace === "editor") {
    return <AutomationRuleEditor key={`${editorRule?.id ?? "new"}-${isDuplicate ? "copy" : "edit"}`} rule={editorRule} duplicate={isDuplicate} triggerGroups={triggerGroups} onClose={() => setWorkspace("rules")} onSaved={(rule) => { setEditorRule(rule); setIsDuplicate(false); }} onDeleted={() => setWorkspace("rules")} />;
  }

  const moduleLabel = selectedModuleKey ? getModuleRegistryLabel(selectedModuleKey) ?? formatModuleLabel(selectedModuleKey) : null;
  return <PageShell
   variant="settings"
   title="Automation"
   description="Rules that run when records change."
   context={moduleLabel ? `${moduleLabel} automation` : "Automation workspace"}
   actions={(
     <>
     <SegmentedControl aria-label="Automation workspace" value={workspace} onValueChange={(next) => (next === "runs" ? viewRuns() : setWorkspace("rules"))}>
       <SegmentedItem value="rules"><Workflow />Rules</SegmentedItem>
       <SegmentedItem value="runs"><History />Runs</SegmentedItem>
     </SegmentedControl>
     {workspace === "rules" ? <Button type="button" onClick={() => openEditor()}><Plus />Create rule</Button> : null}
     </>
   )}
 >
    {workspace === "rules" ? <>
      <div className="grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_13rem_11rem]">
        <SearchBar value={ruleSearch} onChange={setRuleSearch} placeholder="Search rules" />
        <Field><FieldLabel className="sr-only">Module filter</FieldLabel><Select value={selectedModuleKey ?? "all"} onValueChange={changeModule}><SelectTrigger aria-label="Module filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All modules</SelectItem>{MODULE_REGISTRY.filter((module) => !module.adminOnly && module.enabled && !module.requiredModuleKey).map((module) => <SelectItem key={module.key} value={module.key}>{module.label}</SelectItem>)}</SelectContent></Select></Field>
        <Field><FieldLabel className="sr-only">Status filter</FieldLabel><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger aria-label="Status filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="enabled">Enabled</SelectItem><SelectItem value="disabled">Disabled</SelectItem></SelectContent></Select></Field>
      </div>
      <AutomationRulesTable rules={filteredRules} triggerLabels={triggerLabels} isRefreshing={rulesQuery.isFetching} hasFilters={Boolean(ruleSearch || statusFilter !== "all")} onCreate={() => openEditor()} onClearFilters={() => { setRuleSearch(""); setStatusFilter("all"); }} onEdit={(rule) => openEditor(rule)} onDuplicate={(rule) => openEditor(rule, true)} onToggle={(rule) => void toggleRule(rule)} onDelete={(rule) => void removeRule(rule)} onViewRuns={viewRuns} />
    </> : <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="button" variant="ghost" size="sm" onClick={() => setWorkspace("rules")}><ArrowLeft />Rules</Button>
        <Field className="sm:w-64"><FieldLabel className="sr-only">Filter runs by rule</FieldLabel><Select value={runRuleFilter} onValueChange={setRunRuleFilter}><SelectTrigger aria-label="Filter runs by rule"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All rules</SelectItem>{(rulesQuery.data ?? []).map((rule) => <SelectItem key={rule.id} value={String(rule.id)}>{rule.name}</SelectItem>)}</SelectContent></Select></Field>
        <Field className="sm:w-48"><FieldLabel className="sr-only">Filter runs by status</FieldLabel><Select value={runStatusFilter} onValueChange={setRunStatusFilter}><SelectTrigger aria-label="Filter runs by status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="succeeded">Succeeded</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="skipped">Skipped</SelectItem></SelectContent></Select></Field>
      </div>
      {runsQuery.isLoading ? <RouteLoadingState label="automation runs" /> : runsQuery.isError ? <Card><EmptyState icon={History} title="Run history could not be loaded" description="The rules are unaffected. Try loading recent runs again." action={<Button type="button" variant="outline" onClick={() => void runsQuery.refetch()}>Try again</Button>} /></Card> : <AutomationRunsTable runs={filteredRuns} isRefreshing={runsQuery.isFetching} hasFilters={runRuleFilter !== "all" || runStatusFilter !== "all"} onClearFilters={() => { setRunRuleFilter("all"); setRunStatusFilter("all"); }} onInspect={(run) => setSelectedRun(run)} />}
      <AutomationRunDetails run={selectedRun} open={Boolean(selectedRun)} onOpenChange={(open) => { if (!open) setSelectedRun(null); }} />
    </>}
  </PageShell>;
}
