"use client";

import { useQuery } from "@tanstack/react-query";

import type {
  AutomationActionDefinition,
  AutomationConditionField,
  AutomationRule,
  AutomationRulePreview,
  AutomationRun,
  AutomationTriggerGroup,
} from "@/components/automation/types";
import { apiFetch } from "@/lib/api";

async function readResults<T>(url: string): Promise<T[]> {
  const response = await apiFetch(url);
  if (!response.ok) throw new Error("request_failed");
  const body = await response.json();
  return body.results ?? [];
}

export function useAutomationRules(moduleKey?: string | null) {
  const params = new URLSearchParams();
  if (moduleKey) params.set("module_key", moduleKey);
  return useQuery({
    queryKey: ["automation-rules", moduleKey ?? "all"],
    queryFn: () => readResults<AutomationRule>(`/admin/automation-rules${params.size ? `?${params}` : ""}`),
  });
}

export function useAutomationTriggers() {
  return useQuery({
    queryKey: ["automation-rule-trigger-registry"],
    queryFn: () => readResults<AutomationTriggerGroup>("/admin/automation-rules/trigger-registry"),
  });
}

export function useAutomationConditionFields(triggerEvent: string, enabled = true) {
  return useQuery({
    queryKey: ["automation-rule-condition-fields", triggerEvent],
    queryFn: () => readResults<AutomationConditionField>(`/admin/automation-rules/condition-fields?${new URLSearchParams({ trigger_event: triggerEvent })}`),
    enabled: enabled && Boolean(triggerEvent),
  });
}

export function useAutomationActions(triggerEvent: string, enabled = true) {
  return useQuery({
    queryKey: ["automation-rule-action-registry", triggerEvent],
    queryFn: () => readResults<AutomationActionDefinition>(`/admin/automation-rules/action-registry?${new URLSearchParams({ trigger_event: triggerEvent })}`),
    enabled: enabled && Boolean(triggerEvent),
  });
}

export function useAutomationRuns(moduleKey?: string | null, ruleId?: number | null, enabled = true) {
  const params = new URLSearchParams({ page: "1", page_size: "100" });
  if (moduleKey) params.set("module_key", moduleKey);
  if (ruleId) params.set("rule_id", String(ruleId));
  return useQuery({
    queryKey: ["automation-rule-runs", moduleKey ?? "all", ruleId ?? "all"],
    queryFn: () => readResults<AutomationRun>(`/admin/automation-rules/runs?${params}`),
    enabled,
  });
}

export async function previewAutomationRule(payload: Record<string, unknown>): Promise<AutomationRulePreview> {
  const response = await apiFetch("/admin/automation-rules/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("preview_failed");
  return response.json();
}

export async function persistAutomationRule(ruleId: number | undefined, payload: Record<string, unknown>): Promise<AutomationRule> {
  const response = await apiFetch(ruleId ? `/admin/automation-rules/${ruleId}` : "/admin/automation-rules", {
    method: ruleId ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("save_failed");
  return response.json();
}

export async function deleteAutomationRule(ruleId: number) {
  const response = await apiFetch(`/admin/automation-rules/${ruleId}`, { method: "DELETE" });
  if (!response.ok) throw new Error("delete_failed");
}
