"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch, SwitchThumb } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

type AutomationRule = {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger_event: string;
  conditions_json: Record<string, unknown>[];
  actions_json: Record<string, unknown>[];
  updated_at: string;
};

type AutomationRun = {
  id: number;
  rule_id: number;
  event_id: number | null;
  status: string;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
};

type RuleDraft = {
  id?: number;
  name: string;
  description: string;
  enabled: boolean;
  trigger_event: string;
  conditions_json: string;
  actions_json: string;
};

const EMPTY_DRAFT: RuleDraft = {
  name: "",
  description: "",
  enabled: true,
  trigger_event: "lead.created",
  conditions_json: "[]",
  actions_json: JSON.stringify(
    [
      {
        type: "create_task",
        title: "Follow up with {{payload.lead_name}}",
        priority: "medium",
        due_in_days: 1,
        assignee_user_id: "actor",
      },
    ],
    null,
    2,
  ),
};

async function fetchRules(): Promise<AutomationRule[]> {
  const res = await apiFetch("/admin/automation-rules");
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body.results ?? [];
}

async function fetchTriggers(): Promise<string[]> {
  const res = await apiFetch("/admin/automation-rules/triggers");
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body.results ?? [];
}

async function fetchRuns(ruleId?: number): Promise<AutomationRun[]> {
  const params = new URLSearchParams({ page: "1", page_size: "10" });
  if (ruleId) params.set("rule_id", String(ruleId));
  const res = await apiFetch(`/admin/automation-rules/runs?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body.results ?? [];
}

function parseJsonList(value: string, label: string) {
  const parsed = JSON.parse(value || "[]");
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
  return parsed;
}

export default function AutomationSettingsPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_DRAFT);
  const selectedRuleId = draft.id;
  const rulesQuery = useQuery({ queryKey: ["automation-rules"], queryFn: fetchRules });
  const triggersQuery = useQuery({ queryKey: ["automation-rule-triggers"], queryFn: fetchTriggers });
  const runsQuery = useQuery({ queryKey: ["automation-rule-runs", selectedRuleId ?? "all"], queryFn: () => fetchRuns(selectedRuleId) });

  const selectedRule = useMemo(() => rulesQuery.data?.find((rule) => rule.id === selectedRuleId), [rulesQuery.data, selectedRuleId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        enabled: draft.enabled,
        trigger_event: draft.trigger_event,
        conditions_json: parseJsonList(draft.conditions_json, "Conditions"),
        actions_json: parseJsonList(draft.actions_json, "Actions"),
      };
      if (!payload.name) throw new Error("Rule name is required.");
      const res = await apiFetch(draft.id ? `/admin/automation-rules/${draft.id}` : "/admin/automation-rules", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      return body as AutomationRule;
    },
    onSuccess: async (rule) => {
      toast.success("Automation rule saved.");
      setDraft(ruleToDraft(rule));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["automation-rules"] }),
        queryClient.invalidateQueries({ queryKey: ["automation-rule-runs"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to save rule."),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ruleId: number) => {
      const res = await apiFetch(`/admin/automation-rules/${ruleId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Failed with ${res.status}`);
      }
    },
    onSuccess: async () => {
      toast.success("Automation rule deleted.");
      setDraft(EMPTY_DRAFT);
      await queryClient.invalidateQueries({ queryKey: ["automation-rules"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to delete rule."),
  });

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader title="Automation" description="Configure CRM event rules and review recent automation runs." />

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="px-5 py-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-neutral-100">Rules</h2>
              <p className="mt-1 text-sm text-neutral-500">Enabled rules run when matching CRM events are recorded.</p>
            </div>
            <Button type="button" variant="secondary" onClick={() => setDraft(EMPTY_DRAFT)}>New Rule</Button>
          </div>
          <div className="grid gap-2">
            {(rulesQuery.data ?? []).map((rule) => (
              <button
                key={rule.id}
                type="button"
                onClick={() => setDraft(ruleToDraft(rule))}
                className={rule.id === selectedRuleId ? "rounded-md border border-sky-700 bg-sky-950/30 px-4 py-3 text-left" : "rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-3 text-left hover:border-neutral-700"}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-neutral-100">{rule.name}</span>
                  <span className={rule.enabled ? "text-xs text-emerald-300" : "text-xs text-neutral-500"}>{rule.enabled ? "Enabled" : "Disabled"}</span>
                </div>
                <div className="mt-1 text-xs text-neutral-500">{rule.trigger_event}</div>
              </button>
            ))}
            {!rulesQuery.isLoading && !(rulesQuery.data ?? []).length ? <div className="rounded-md border border-neutral-800 px-4 py-8 text-center text-sm text-neutral-500">No automation rules yet.</div> : null}
          </div>
        </Card>

        <Card className="px-5 py-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-neutral-100">{draft.id ? "Edit Rule" : "Create Rule"}</h2>
            <FieldDescription className="mt-1">Use JSON arrays for conditions and actions. Actions are restricted to platform-safe types.</FieldDescription>
          </div>
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel>Trigger</FieldLabel>
              <Select value={draft.trigger_event} onValueChange={(value) => setDraft((current) => ({ ...current, trigger_event: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(triggersQuery.data ?? ["lead.created"]).map((trigger) => <SelectItem key={trigger} value={trigger}>{trigger}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel>Description</FieldLabel>
              <Input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel>Enabled</FieldLabel>
              <div className="flex h-10 items-center">
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(checked) => setDraft((current) => ({ ...current, enabled: checked }))}
                  className="relative h-6 w-11 shrink-0 rounded-full border border-neutral-700 bg-neutral-800 data-[state=checked]:bg-emerald-600"
                >
                  <SwitchThumb className="block h-5 w-5 rounded-full bg-white shadow-sm data-[state=checked]:translate-x-5" />
                </Switch>
              </div>
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel>Conditions JSON</FieldLabel>
              <textarea className="min-h-28 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-sm text-neutral-200 outline-none focus:border-neutral-600" value={draft.conditions_json} onChange={(event) => setDraft((current) => ({ ...current, conditions_json: event.target.value }))} />
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel>Actions JSON</FieldLabel>
              <textarea className="min-h-48 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-sm text-neutral-200 outline-none focus:border-neutral-600" value={draft.actions_json} onChange={(event) => setDraft((current) => ({ ...current, actions_json: event.target.value }))} />
            </Field>
          </FieldGroup>
          <div className="mt-5 flex flex-wrap justify-between gap-3">
            <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !draft.name.trim()}>
              <Save />{saveMutation.isPending ? "Saving..." : "Save Rule"}
            </Button>
            {draft.id ? (
              <Button type="button" variant="destructive" onClick={() => deleteMutation.mutate(draft.id!)} disabled={deleteMutation.isPending}>
                <Trash2 />Delete
              </Button>
            ) : null}
          </div>
        </Card>
      </div>

      <Card className="px-5 py-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-neutral-100">Run History</h2>
          <p className="mt-1 text-sm text-neutral-500">{selectedRule ? `Showing recent runs for ${selectedRule.name}.` : "Showing recent runs across automation rules."}</p>
        </div>
        <Table>
          <TableHeader>
            <TableHeaderRow>
              <TableHead>Run</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Error</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {(runsQuery.data ?? []).map((run) => (
              <TableRow key={run.id}>
                <TableCell>#{run.id}</TableCell>
                <TableCell>{run.rule_id}</TableCell>
                <TableCell><span className={run.status === "succeeded" ? "text-emerald-300" : run.status === "failed" ? "text-red-300" : "text-neutral-300"}>{run.status}</span></TableCell>
                <TableCell>{run.event_id ? `#${run.event_id}` : "-"}</TableCell>
                <TableCell>{formatDateTime(run.started_at)}</TableCell>
                <TableCell className="max-w-md truncate">{run.error_message || "-"}</TableCell>
              </TableRow>
            ))}
            {!runsQuery.isLoading && !(runsQuery.data ?? []).length ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-neutral-500">No automation runs yet.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function ruleToDraft(rule: AutomationRule): RuleDraft {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description ?? "",
    enabled: rule.enabled,
    trigger_event: rule.trigger_event,
    conditions_json: JSON.stringify(rule.conditions_json ?? [], null, 2),
    actions_json: JSON.stringify(rule.actions_json ?? [], null, 2),
  };
}
