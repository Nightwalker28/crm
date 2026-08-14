"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Edit3, FileText, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { Pill } from "@/components/ui/Pill";
import { RecordTable } from "@/components/ui/RecordTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import { apiFetch } from "@/lib/api";
import { getModuleDisplayName } from "@/lib/module-display";
import { CHANNEL_OPTIONS, fetchMessageTemplates, MODULE_OPTIONS, type MessageTemplate, variablesToText } from "@/lib/message-templates";

type TemplateSortState = { key: "name" | "channel" | "module_key" | "is_active"; direction: "asc" | "desc" };

function nextTemplateSort(current: TemplateSortState, key: TemplateSortState["key"]): TemplateSortState {
  return current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" };
}

export default function MessageTemplatesPage() {
  const { confirm } = useConfirm();
  const { modules } = useAccessibleModules();
  const actions = modules.find((module) => module.name === "message_templates")?.actions;
  const canCreate = Boolean(actions?.can_create);
  const canEdit = Boolean(actions?.can_edit);
  const canDelete = Boolean(actions?.can_delete);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [sort, setSort] = useState<TemplateSortState>({ key: "name", direction: "asc" });
  const query = useQuery({ queryKey: ["message-templates", "all"], queryFn: fetchMessageTemplates });

  const updateMutation = useMutation({
    mutationFn: async ({ template, is_active }: { template: MessageTemplate; is_active: boolean }) => {
      const res = await apiFetch(`/message-templates/${template.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active }),
      });
      if (!res.ok) throw new Error("template-update-failed");
    },
    onSuccess: async () => {
      await query.refetch();
      toast.success("Template updated.");
    },
    onError: () => toast.error("We could not update this template. Try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: async (template: MessageTemplate) => {
      const res = await apiFetch(`/message-templates/${template.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("template-delete-failed");
    },
    onSuccess: async () => {
      await query.refetch();
      toast.success("Template deleted.");
    },
    onError: () => toast.error("We could not delete this template. Try again."),
  });

  async function deleteTemplate(template: MessageTemplate) {
    const confirmed = await confirm({
      title: "Delete message template?",
      description: `Delete "${template.name}"? Existing messages are unchanged, but this template will no longer be available for future communication.`,
      confirmLabel: "Delete template",
      variant: "destructive",
    });
    if (confirmed) deleteMutation.mutate(template);
  }

  const templates = useMemo(() => query.data ?? [], [query.data]);
  const visibleTemplates = useMemo(() => {
    const searchText = search.trim().toLowerCase();
    return [...templates]
      .filter((template) => {
        if (channelFilter !== "all" && template.channel !== channelFilter) return false;
        if (moduleFilter !== "all" && (template.module_key ?? "") !== moduleFilter) return false;
        if (!searchText) return true;
        return [template.name, template.template_key, template.description ?? "", template.channel, template.module_key ? getModuleDisplayName(template.module_key) : "", variablesToText(template.variables)].some((value) => value.toLowerCase().includes(searchText));
      })
      .sort((left, right) => {
        const leftValue = left[sort.key];
        const rightValue = right[sort.key];
        const result = typeof leftValue === "boolean" || typeof rightValue === "boolean" ? Number(leftValue) - Number(rightValue) : String(leftValue ?? "").localeCompare(String(rightValue ?? ""));
        return sort.direction === "asc" ? result : -result;
      });
  }, [channelFilter, moduleFilter, search, sort, templates]);
  const isMutating = updateMutation.isPending || deleteMutation.isPending;

  return (
    <PageShell
      variant="settings"
      title="Templates"
      description="Reusable message bodies for mail and WhatsApp."
      actions={canCreate ? <Button asChild><Link href="/dashboard/settings/message-templates/new"><Plus />Create template</Link></Button> : null}
    >
      <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line-default bg-surface px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search templates" className="lg:max-w-sm" />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={channelFilter} onValueChange={setChannelFilter}><SelectTrigger className="sm:w-40" aria-label="Channel filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All channels</SelectItem>{CHANNEL_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>
          <Select value={moduleFilter} onValueChange={setModuleFilter}><SelectTrigger className="sm:w-48" aria-label="Module filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All modules</SelectItem>{MODULE_OPTIONS.map((moduleName) => <SelectItem key={moduleName} value={moduleName}>{getModuleDisplayName(moduleName)}</SelectItem>)}</SelectContent></Select>
        </div>
      </div>
      <RecordTable
        label="Templates"
        columns={[
          {
            key: "name",
            label: "Name",
            size: "lg",
            sortable: true,
            render: (template) => (
              <div className="min-w-0">
                <div className="font-medium text-copy-primary">{template.name}</div>
                <div className="mt-1 max-w-md truncate text-xs text-copy-muted">{template.description || template.template_key}</div>
              </div>
            ),
          },
          { key: "channel", label: "Channel", size: "sm", sortable: true, render: (template) => <span className="capitalize text-copy-secondary">{template.channel}</span> },
          { key: "module_key", label: "Module", sortable: true, render: (template) => <span className="text-copy-secondary">{template.module_key ? getModuleDisplayName(template.module_key) : "Not set"}</span> },
          {
            key: "is_active",
            label: "Status",
            size: "sm",
            sortable: true,
            render: (template) => (
              <div className="flex flex-wrap gap-2">
                <Pill bg={template.is_active ? "bg-state-success-muted" : "bg-state-danger-muted"} text={template.is_active ? "text-state-success" : "text-state-danger"} border={template.is_active ? "border-state-success/40" : "border-state-danger/40"}>{template.is_active ? "Active" : "Inactive"}</Pill>
                {template.is_system ? <Pill bg="bg-surface-muted" text="text-copy-secondary" border="border-line-default">System</Pill> : null}
              </div>
            ),
          },
          { key: "variables", label: "Variables", render: (template) => <span className="block max-w-xs truncate text-copy-muted">{variablesToText(template.variables) || "Not set"}</span> },
        ]}
        rows={visibleTemplates}
        rowKey={(template) => template.id}
        sort={{ column: sort.key, direction: sort.direction }}
        onSortChange={(next) => setSort((current) => nextTemplateSort(current, next.column as typeof sort.key))}
        isLoading={query.isLoading}
        isRefreshing={query.isFetching && !query.isLoading}
        hasError={Boolean(query.error)}
        onRetry={() => void query.refetch()}
        hasActiveFilters={Boolean(search.trim()) || channelFilter !== "all" || moduleFilter !== "all"}
        onClearFilters={() => { setSearch(""); setChannelFilter("all"); setModuleFilter("all"); }}
        emptyState={{
          icon: FileText,
          title: "No templates yet",
          description: "Create a reusable message body for mail or WhatsApp.",
          action: canCreate ? <Button asChild><Link href="/dashboard/settings/message-templates/new"><Plus />Create template</Link></Button> : undefined,
        }}
        rowActions={canEdit || canDelete ? (template) => (
          <div className="flex justify-end gap-2">
            {canEdit ? <Button asChild variant="outline" size="icon-sm"><Link href={`/dashboard/settings/message-templates/${template.id}/edit`} aria-label={`Edit ${template.name}`}><Edit3 /></Link></Button> : null}
            {canEdit ? <Button type="button" variant="outline" size="icon-sm" aria-label={`${template.is_active ? "Disable" : "Enable"} ${template.name}`} disabled={isMutating} onClick={() => updateMutation.mutate({ template, is_active: !template.is_active })}><Power /></Button> : null}
            {canDelete ? <Button type="button" variant="outline" size="icon-sm" aria-label={`Delete ${template.name}`} disabled={isMutating} onClick={() => void deleteTemplate(template)}><Trash2 /></Button> : null}
          </div>
        ) : undefined}
      />
    </PageShell>
  );
}
