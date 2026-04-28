"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Edit3, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";

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

const CHANNEL_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "mail", label: "Mail" },
  { value: "task", label: "Tasks" },
];

const MODULE_OPTIONS = [
  { value: "sales_contacts", label: "Sales Contacts" },
  { value: "sales_organizations", label: "Sales Organizations" },
  { value: "sales_opportunities", label: "Sales Opportunities" },
  { value: "finance_io", label: "Finance Insertion Orders" },
  { value: "tasks", label: "Tasks" },
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

async function fetchTemplates(): Promise<MessageTemplate[]> {
  const res = await apiFetch("/message-templates?include_inactive=true");
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body?.results ?? [];
}

export default function MessageTemplatesPage() {
  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);

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
        variables: textToVariables(draft.variables),
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
              <p className="mt-1 text-sm text-neutral-500">Use variables like {"{{contact_first_name}}"} in the body.</p>
            </div>
            {editingId ? (
              <Button type="button" variant="outline" size="sm" onClick={() => { setEditingId(null); setDraft(emptyDraft); }}>
                Cancel
              </Button>
            ) : null}
          </div>

          <FieldGroup className="mt-4 grid gap-4">
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
                    {MODULE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
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
            </Field>
            <Field>
              <FieldLabel>Variables</FieldLabel>
              <Input value={draft.variables} onChange={(event) => setDraft((current) => ({ ...current, variables: event.target.value }))} placeholder="contact_first_name, organization_name" />
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

        <ModuleTableShell>
          <Table className="min-w-[950px]">
            <TableHeader>
              <TableHeaderRow>
                <TableHead>Name</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Variables</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableHeaderRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-neutral-500">Loading templates...</TableCell>
                </TableRow>
              ) : query.data?.length ? (
                query.data.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell>
                      <div className="font-medium text-neutral-100">{template.name}</div>
                      <div className="mt-1 max-w-md truncate text-xs text-neutral-500">{template.description || template.template_key}</div>
                    </TableCell>
                    <TableCell className="capitalize text-neutral-300">{template.channel}</TableCell>
                    <TableCell className="text-neutral-400">{template.module_key || "-"}</TableCell>
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
                  <TableCell colSpan={6} className="py-10 text-center text-neutral-500">No templates found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ModuleTableShell>
      </div>
    </div>
  );
}
