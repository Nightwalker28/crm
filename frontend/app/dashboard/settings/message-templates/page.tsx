"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Edit3, Plus, Power, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SortableHead, Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { getModuleDisplayName } from "@/lib/module-display";

type MessageTemplate = {
  id: number;
  template_key: string;
  name: string;
  description: string | null;
  channel: string;
  module_key: string | null;
  body: string;
  variables: string[];
  is_system: boolean;
  is_active: boolean;
};

type TemplateDraft = {
  name: string;
  description: string;
  channel: string;
  module_key: string;
  body: string;
  variables: string;
  is_active: boolean;
};

type TemplateSortState = { key: "name" | "channel" | "module_key" | "is_active"; direction: "asc" | "desc" };

const CHANNEL_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "mail", label: "Mail" },
];

const MODULE_OPTIONS = [
  "sales_leads",
  "sales_contacts",
  "sales_organizations",
  "sales_opportunities",
  "sales_quotes",
  "tasks",
];

const VARIABLE_LIBRARY: Record<string, string[]> = {
  common: ["company_name", "sender_name", "meeting_date", "meeting_time", "next_step"],
  sales_leads: ["lead_name", "first_name", "last_name", "company", "primary_email", "phone", "source"],
  sales_contacts: ["customer_name", "first_name", "last_name", "primary_email", "phone", "organization_name"],
  sales_organizations: ["organization_name", "primary_email", "primary_phone", "website"],
  sales_opportunities: ["deal_name", "customer_name", "organization_name", "deal_value", "expected_close_date"],
  sales_quotes: ["quote_number", "customer_name", "organization_name", "total_amount", "expiry_date"],
  tasks: ["task_title", "due_at", "priority", "source_label"],
};

const CRM_TEMPLATE_PRESETS = [
  {
    label: "Lead intro",
    channel: "mail",
    module_key: "sales_leads",
    name: "Lead intro",
    description: "First response to a new or qualified lead.",
    body: "Hi {{first_name}},\n\nThanks for reaching out to {{company_name}}. I wanted to introduce myself and learn a little more about what you are looking for.\n\nWould {{meeting_date}} work for a quick conversation?\n\nBest,\n{{sender_name}}",
  },
  {
    label: "Follow-up",
    channel: "whatsapp",
    module_key: "sales_contacts",
    name: "Follow-up",
    description: "General customer follow-up after a conversation.",
    body: "Hi {{first_name}}, following up on our last conversation. Please let me know if {{next_step}} still works for you.",
  },
  {
    label: "Meeting request",
    channel: "mail",
    module_key: "sales_contacts",
    name: "Meeting request",
    description: "Request a meeting with a known contact.",
    body: "Hi {{first_name}},\n\nCan we schedule a meeting on {{meeting_date}} at {{meeting_time}} to discuss the next steps?\n\nBest,\n{{sender_name}}",
  },
  {
    label: "Quote follow-up",
    channel: "whatsapp",
    module_key: "sales_quotes",
    name: "Quote follow-up",
    description: "Follow up after sharing a quote.",
    body: "Hi {{customer_name}}, checking in on quote {{quote_number}} for {{total_amount}}. Please let us know if you have questions before {{expiry_date}}.",
  },
  {
    label: "Deal negotiation",
    channel: "mail",
    module_key: "sales_opportunities",
    name: "Deal negotiation",
    description: "Continue a negotiation on an open deal.",
    body: "Hi {{customer_name}},\n\nFollowing up on {{deal_name}}. Based on our discussion, the next step is {{next_step}}.\n\nBest,\n{{sender_name}}",
  },
  {
    label: "Support handoff",
    channel: "mail",
    module_key: "sales_contacts",
    name: "Support handoff",
    description: "Hand a customer from sales to support or delivery.",
    body: "Hi {{first_name}},\n\nI am connecting you with our support team for {{next_step}}. They will have the context from our sales conversation.\n\nBest,\n{{sender_name}}",
  },
];

const emptyDraft: TemplateDraft = {
  name: "",
  description: "",
  channel: "whatsapp",
  module_key: "sales_contacts",
  body: "",
  variables: "",
  is_active: true,
};

function variablesToText(variables: string[]) {
  return variables.join(", ");
}

function textToVariables(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractTemplateVariables(body: string) {
  return Array.from(body.matchAll(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g))
    .map((match) => match[1])
    .filter(Boolean);
}

function mergedVariables(body: string, variables: string) {
  return Array.from(new Set([...textToVariables(variables), ...extractTemplateVariables(body)])).sort();
}

function toDraft(template: MessageTemplate): TemplateDraft {
  return {
    name: template.name,
    description: template.description ?? "",
    channel: template.channel,
    module_key: template.module_key ?? "sales_contacts",
    body: template.body,
    variables: variablesToText(template.variables),
    is_active: template.is_active,
  };
}

function nextTemplateSort(current: TemplateSortState, key: TemplateSortState["key"]): TemplateSortState {
  return current.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: "asc" };
}

async function fetchTemplates(): Promise<MessageTemplate[]> {
  const res = await apiFetch("/message-templates?include_inactive=true");
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body?.results ?? [];
}

export default function MessageTemplatesPage() {
  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [sort, setSort] = useState<TemplateSortState>({ key: "name", direction: "asc" });

  const query = useQuery({
    queryKey: ["message-templates", "all"],
    queryFn: fetchTemplates,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: draft.name,
        description: draft.description || null,
        channel: draft.channel,
        module_key: draft.module_key || null,
        body: draft.body,
        variables: mergedVariables(draft.body, draft.variables),
        is_active: draft.is_active,
      };
      const res = await apiFetch(editingId ? `/message-templates/${editingId}` : "/message-templates", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      return body as MessageTemplate;
    },
    onSuccess: async () => {
      setDraft(emptyDraft);
      setEditingId(null);
      await query.refetch();
      toast.success(editingId ? "Template updated." : "Template created.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to save template."),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ template, payload }: { template: MessageTemplate; payload: Partial<MessageTemplate> }) => {
      const res = await apiFetch(`/message-templates/${template.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      return body as MessageTemplate;
    },
    onSuccess: async () => {
      await query.refetch();
      toast.success("Template updated.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to update template."),
  });

  const deleteMutation = useMutation({
    mutationFn: async (template: MessageTemplate) => {
      const res = await apiFetch(`/message-templates/${template.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      return body as MessageTemplate;
    },
    onSuccess: async () => {
      await query.refetch();
      toast.success("Template deleted.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to delete template."),
  });

  const isSaving = saveMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const visibleVariables = mergedVariables(draft.body, draft.variables);
  const suggestedVariables = Array.from(
    new Set([...(VARIABLE_LIBRARY.common ?? []), ...(VARIABLE_LIBRARY[draft.module_key] ?? [])]),
  );
  const templates = query.data ?? [];
  const visibleTemplates = useMemo(() => {
    const searchText = search.trim().toLowerCase();
    return [...(query.data ?? [])]
      .filter((template) => {
        if (channelFilter !== "all" && template.channel !== channelFilter) return false;
        if (moduleFilter !== "all" && (template.module_key ?? "") !== moduleFilter) return false;
        if (!searchText) return true;
        return [
          template.name,
          template.template_key,
          template.description ?? "",
          template.channel,
          template.module_key ? getModuleDisplayName(template.module_key) : "",
          variablesToText(template.variables),
        ].some((value) => value.toLowerCase().includes(searchText));
      })
      .sort((left, right) => {
        const leftValue = left[sort.key];
        const rightValue = right[sort.key];
        const result = typeof leftValue === "boolean" || typeof rightValue === "boolean"
          ? Number(leftValue) - Number(rightValue)
          : String(leftValue ?? "").localeCompare(String(rightValue ?? ""));
        return sort.direction === "asc" ? result : -result;
      });
  }, [channelFilter, moduleFilter, query.data, search, sort]);

  return (
    <div className="flex flex-col gap-5 text-neutral-200">
      <PageHeader
        title="Templates"
        description="Manage tenant-scoped message templates for WhatsApp and future communication workflows."
      />

      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <Card className="px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-neutral-100">{editingId ? "Edit Template" : "Add Template"}</h2>
              <p className="mt-1 text-sm text-neutral-500">Start from a CRM preset or write a channel-specific template.</p>
            </div>
            {editingId ? (
              <Button type="button" variant="outline" size="sm" onClick={() => { setEditingId(null); setDraft(emptyDraft); }}>
                Cancel
              </Button>
            ) : null}
          </div>

          <FieldGroup className="mt-4 grid gap-4">
            <Field>
              <FieldLabel>CRM presets</FieldLabel>
              <div className="grid gap-2 sm:grid-cols-2">
                {CRM_TEMPLATE_PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    onClick={() => {
                      setEditingId(null);
                      setDraft({
                        name: preset.name,
                        description: preset.description,
                        channel: preset.channel,
                        module_key: preset.module_key,
                        body: preset.body,
                        variables: extractTemplateVariables(preset.body).join(", "),
                        is_active: true,
                      });
                    }}
                  >
                    <Sparkles className="h-4 w-4" />
                    {preset.label}
                  </Button>
                ))}
              </div>
            </Field>
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Quote follow-up" />
            </Field>
            <Field>
              <FieldLabel>Description</FieldLabel>
              <Input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel>Channel</FieldLabel>
                <Select value={draft.channel} onValueChange={(value) => setDraft((current) => ({ ...current, channel: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CHANNEL_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Module</FieldLabel>
                <Select value={draft.module_key} onValueChange={(value) => setDraft((current) => ({ ...current, module_key: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODULE_OPTIONS.map((moduleName) => (
                      <SelectItem key={moduleName} value={moduleName}>{getModuleDisplayName(moduleName)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel>Body</FieldLabel>
              <Textarea
                value={draft.body}
                onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
                className="min-h-32 border-neutral-800 bg-neutral-950 text-neutral-100"
              />
              <FieldDescription>
                Variables wrapped in braces are saved automatically, for example {"{{first_name}}"}.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Variables</FieldLabel>
              <Input value={draft.variables} onChange={(event) => setDraft((current) => ({ ...current, variables: event.target.value }))} placeholder="contact_first_name, organization_name" />
              {visibleVariables.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {visibleVariables.map((variable) => (
                    <span key={variable} className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-300">
                      {`{{${variable}}}`}
                    </span>
                  ))}
                </div>
              ) : null}
            </Field>
            <Field>
              <FieldLabel>Suggested variables</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {suggestedVariables.map((variable) => (
                  <button
                    key={variable}
                    type="button"
                    className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-100"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        variables: mergedVariables(current.body, `${current.variables}, ${variable}`).join(", "),
                      }))
                    }
                  >
                    {`{{${variable}}}`}
                  </button>
                ))}
              </div>
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
              Active
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))}
                className="h-4 w-4 accent-neutral-100"
              />
            </label>
            <Button type="button" disabled={isSaving || !draft.name.trim() || !draft.body.trim()} onClick={() => saveMutation.mutate()}>
              <Plus size={16} />
              {editingId ? "Save Template" : "Create Template"}
            </Button>
          </FieldGroup>
        </Card>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 rounded-md border border-neutral-800 bg-neutral-950/80 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search templates"
              className="lg:max-w-sm"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select value={channelFilter} onValueChange={setChannelFilter}>
                <SelectTrigger className="sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  {CHANNEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={moduleFilter} onValueChange={setModuleFilter}>
                <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All modules</SelectItem>
                  {MODULE_OPTIONS.map((moduleName) => (
                    <SelectItem key={moduleName} value={moduleName}>{getModuleDisplayName(moduleName)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <ModuleTableShell>
            <Table className="min-w-[950px]">
              <TableHeader>
                <TableHeaderRow>
                  <SortableHead sorted={sort.key === "name"} direction={sort.direction} onClick={() => setSort((current) => nextTemplateSort(current, "name"))}>Name</SortableHead>
                  <SortableHead sorted={sort.key === "channel"} direction={sort.direction} onClick={() => setSort((current) => nextTemplateSort(current, "channel"))}>Channel</SortableHead>
                  <SortableHead sorted={sort.key === "module_key"} direction={sort.direction} onClick={() => setSort((current) => nextTemplateSort(current, "module_key"))}>Module</SortableHead>
                  <SortableHead sorted={sort.key === "is_active"} direction={sort.direction} onClick={() => setSort((current) => nextTemplateSort(current, "is_active"))}>Status</SortableHead>
                  <TableHead>Variables</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableHeaderRow>
              </TableHeader>
              <TableBody>
                {query.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-neutral-500">Loading templates...</TableCell>
                  </TableRow>
                ) : query.error ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-red-300">{query.error instanceof Error ? query.error.message : "Failed to load templates."}</TableCell>
                  </TableRow>
                ) : visibleTemplates.length ? (
                  visibleTemplates.map((template) => (
                    <TableRow key={template.id}>
                      <TableCell>
                        <div className="font-medium text-neutral-100">{template.name}</div>
                        <div className="mt-1 max-w-md truncate text-xs text-neutral-500">{template.description || template.template_key}</div>
                      </TableCell>
                      <TableCell className="capitalize text-neutral-300">{template.channel}</TableCell>
                      <TableCell className="text-neutral-400">
                        {template.module_key ? getModuleDisplayName(template.module_key) : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Pill bg={template.is_active ? "bg-emerald-950/60" : "bg-red-950/60"} text={template.is_active ? "text-emerald-200" : "text-red-200"} border={template.is_active ? "border-emerald-800/70" : "border-red-800/70"}>
                            {template.is_active ? "Active" : "Inactive"}
                          </Pill>
                          {template.is_system ? (
                            <Pill bg="bg-neutral-900" text="text-neutral-300" border="border-neutral-700">System</Pill>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-neutral-500">{variablesToText(template.variables) || "-"}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" size="icon-sm" aria-label={`Edit ${template.name}`} onClick={() => { setEditingId(template.id); setDraft(toDraft(template)); }}>
                            <Edit3 size={14} />
                          </Button>
                          <Button type="button" variant="outline" size="icon-sm" aria-label={`${template.is_active ? "Disable" : "Enable"} ${template.name}`} disabled={isSaving} onClick={() => updateMutation.mutate({ template, payload: { is_active: !template.is_active } })}>
                            <Power size={14} />
                          </Button>
                          <Button type="button" variant="outline" size="icon-sm" aria-label={`Delete ${template.name}`} disabled={isSaving} onClick={() => deleteMutation.mutate(template)}>
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-neutral-500">
                      {templates.length ? "No templates match the current search or filters." : "No templates found."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ModuleTableShell>
        </div>
      </div>
    </div>
  );
}
