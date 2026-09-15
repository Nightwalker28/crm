"use client";

import { useMemo, useState } from "react";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { isForbiddenError } from "@/lib/api";
import { PageShell } from "@/components/ui/PageShell";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteAutomationRule, persistAutomationRule, previewAutomationRule, useAutomationRules, useAutomationRuns, useAutomationTriggers } from "@/hooks/useAutomationRules";
import { useConfirm } from "@/hooks/useConfirm";
import { usePageAddress } from "@/hooks/usePageAddress";
import { MODULE_REGISTRY, getModuleRegistryLabel } from "@/lib/module-registry";

type Tab = "rules" | "runs";

export default function AutomationSettingsPage() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  /*
   * The page's address, not its mount arguments (rebuild.md 5.6 batch 5). Three params are
   * read on every render rather than seeded into state: `?module=` scopes the page,
   * `?tab=rules|runs` is the workspace — it was `?view=`, which 5.5 made mean *saved view
   * id* on every list in the app — and `?rule_id=` is the runs filter, which was already an
   * inbound deep link and is now written as well as read.
   *
   * The editor is deliberately *not* addressed. It holds an unsaved draft, so a link to it
   * would promise a state the URL cannot carry; it is a local mode over the rules tab.
   */
  const { params, updateAddress } = usePageAddress();
  const selectedModuleKey = params.get("module")?.trim() || null;
  const tab: Tab = params.get("tab") === "runs" ? "runs" : "rules";
  const runRuleFilter = params.get("rule_id") ?? "all";
  const [isEditing, setIsEditing] = useState(false);
  const [editorRule, setEditorRule] = useState<AutomationRule | undefined>();
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [ruleSearch, setRuleSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [runStatusFilter, setRunStatusFilter] = useState("all");
  const [selectedRun, setSelectedRun] = useState<AutomationRun | null>(null);

  const rulesQuery = useAutomationRules(selectedModuleKey);
  const triggersQuery = useAutomationTriggers();
  const runsQuery = useAutomationRuns(selectedModuleKey, null, tab === "runs");
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

  function openEditor(rule?: AutomationRule, duplicate = false) { setEditorRule(rule); setIsDuplicate(duplicate); setIsEditing(true); }
  /*
   * One `updateAddress` per gesture: `router.replace` is async, so two calls in a tick would
   * read the same stale query string and the second would drop the first's param. Changing
   * the module also drops `?rule_id=`, which names a rule in the module being left.
   */
  function changeModule(value: string) {
    updateAddress((next) => {
      if (value === "all") next.delete("module");
      else next.set("module", value);
      next.delete("rule_id");
    });
  }
  function showTab(next: Tab) {
    updateAddress((address) => { if (next === "rules") address.delete("tab"); else address.set("tab", next); });
  }
  function filterRunsByRule(value: string) {
    updateAddress((next) => { if (value === "all") next.delete("rule_id"); else next.set("rule_id", value); });
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
  function viewRuns(rule?: AutomationRule) {
    updateAddress((next) => {
      next.set("tab", "runs");
      if (rule) next.set("rule_id", String(rule.id));
      else next.delete("rule_id");
    });
  }

  const isResolving = rulesQuery.isLoading || triggersQuery.isLoading;
  const failedToLoad = rulesQuery.isError || triggersQuery.isError;
  if (isResolving || failedToLoad) {
    return (
      <PageShell
        variant="settings"
        title="Automation"
        description="Rules that run when records change."
        isLoading={isResolving}
        isPermissionDenied={isForbiddenError(rulesQuery.error ?? triggersQuery.error)}
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

  if (isEditing) {
    return <AutomationRuleEditor key={`${editorRule?.id ?? "new"}-${isDuplicate ? "copy" : "edit"}`} rule={editorRule} duplicate={isDuplicate} triggerGroups={triggerGroups} onClose={() => setIsEditing(false)} onSaved={(rule) => { setEditorRule(rule); setIsDuplicate(false); }} onDeleted={() => setIsEditing(false)} />;
  }

  const moduleLabel = selectedModuleKey ? getModuleRegistryLabel(selectedModuleKey) ?? formatModuleLabel(selectedModuleKey) : null;
  return <PageShell
   variant="settings"
   title="Automation"
   description="Rules that run when records change."
   context={moduleLabel ? `${moduleLabel} automation` : "Automation workspace"}
   actions={(
     <>
     <SegmentedControl aria-label="Automation workspace" value={tab} onValueChange={(next) => showTab(next as Tab)}>
       <SegmentedItem value="rules"><Workflow />Rules</SegmentedItem>
       <SegmentedItem value="runs"><History />Runs</SegmentedItem>
     </SegmentedControl>
     {tab === "rules" ? <Button type="button" onClick={() => openEditor()}><Plus />Create rule</Button> : null}
     </>
   )}
 >
    {tab === "rules" ? <>
      <div className="grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_13rem_11rem]">
        <SearchBar value={ruleSearch} onChange={setRuleSearch} placeholder="Search rules" />
        <Field><FieldLabel className="sr-only">Module filter</FieldLabel><Select value={selectedModuleKey ?? "all"} onValueChange={changeModule}><SelectTrigger aria-label="Module filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All modules</SelectItem>{MODULE_REGISTRY.filter((module) => !module.adminOnly && module.enabled && !module.requiredModuleKey).map((module) => <SelectItem key={module.key} value={module.key}>{module.label}</SelectItem>)}</SelectContent></Select></Field>
        <Field><FieldLabel className="sr-only">Status filter</FieldLabel><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger aria-label="Status filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="enabled">Enabled</SelectItem><SelectItem value="disabled">Disabled</SelectItem></SelectContent></Select></Field>
      </div>
      <AutomationRulesTable rules={filteredRules} triggerLabels={triggerLabels} isRefreshing={rulesQuery.isFetching} hasFilters={Boolean(ruleSearch || statusFilter !== "all")} onCreate={() => openEditor()} onClearFilters={() => { setRuleSearch(""); setStatusFilter("all"); }} onEdit={(rule) => openEditor(rule)} onDuplicate={(rule) => openEditor(rule, true)} onToggle={(rule) => void toggleRule(rule)} onDelete={(rule) => void removeRule(rule)} onViewRuns={viewRuns} />
    </> : <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="button" variant="ghost" size="sm" onClick={() => showTab("rules")}><ArrowLeft />Rules</Button>
        <Field className="sm:w-64"><FieldLabel className="sr-only">Filter runs by rule</FieldLabel><Select value={runRuleFilter} onValueChange={filterRunsByRule}><SelectTrigger aria-label="Filter runs by rule"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All rules</SelectItem>{(rulesQuery.data ?? []).map((rule) => <SelectItem key={rule.id} value={String(rule.id)}>{rule.name}</SelectItem>)}</SelectContent></Select></Field>
        <Field className="sm:w-48"><FieldLabel className="sr-only">Filter runs by status</FieldLabel><Select value={runStatusFilter} onValueChange={setRunStatusFilter}><SelectTrigger aria-label="Filter runs by status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="succeeded">Succeeded</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="skipped">Skipped</SelectItem></SelectContent></Select></Field>
      </div>
      {/* The page drew a `RouteLoadingState` and a `Card`+`EmptyState` error *outside* a
          `RecordTable` that has owned both states since 4a — the same page-local pair batch 4
          deleted from ten other files. A state that sits beside the table cannot know the
          table is empty, and the error one left an empty table body rendering underneath it. */}
      <AutomationRunsTable runs={filteredRuns} isLoading={runsQuery.isLoading} isRefreshing={runsQuery.isFetching} hasError={runsQuery.isError} onRetry={() => void runsQuery.refetch()} hasFilters={runRuleFilter !== "all" || runStatusFilter !== "all"} onClearFilters={() => { filterRunsByRule("all"); setRunStatusFilter("all"); }} onInspect={(run) => setSelectedRun(run)} />
      <AutomationRunDetails run={selectedRun} open={Boolean(selectedRun)} onOpenChange={(open) => { if (!open) setSelectedRun(null); }} />
    </>}
  </PageShell>;
}
