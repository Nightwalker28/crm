"use client";

import { FormEvent, useState } from "react";
import { BadgePercent } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { Textarea } from "@/components/ui/textarea";
import { useCustomerGroupActions, useCustomerGroups, type CustomerGroup } from "@/hooks/useClientPortal";

function formatDiscount(type: string, value?: string | number | null) {
  if (!value || type === "none") return "No discount rule";
  if (type === "percent") return `${value}%`;
  if (type === "fixed") return String(value);
  return `${type}: ${value}`;
}

export default function CustomerGroupsSettingsPage() {
  const groups = useCustomerGroups();
  const { createGroup, updateGroup, isSaving } = useCustomerGroupActions();
  const [editingGroup, setEditingGroup] = useState<CustomerGroup | null>(null);
  const [draft, setDraft] = useState({
    group_key: "",
    name: "",
    description: "",
    discount_type: "none",
    discount_value: "",
    is_default: false,
    is_active: true,
  });

  function editGroup(group: CustomerGroup) {
    setEditingGroup(group);
    setDraft({
      group_key: group.group_key,
      name: group.name,
      description: group.description ?? "",
      discount_type: group.discount_type,
      discount_value: group.discount_value == null ? "" : String(group.discount_value),
      is_default: group.is_default,
      is_active: group.is_active,
    });
  }

  function resetDraft() {
    setEditingGroup(null);
    setDraft({
      group_key: "",
      name: "",
      description: "",
      discount_type: "none",
      discount_value: "",
      is_default: false,
      is_active: true,
    });
  }

  async function saveGroup(event: FormEvent) {
    event.preventDefault();
    const payload = {
      group_key: draft.group_key.trim(),
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      discount_type: draft.discount_type,
      discount_value: draft.discount_type === "none" || draft.discount_value === "" ? null : Number(draft.discount_value),
      is_default: draft.is_default,
      is_active: draft.is_active,
    };
    try {
      if (editingGroup) {
        await updateGroup({
          groupId: editingGroup.id,
          payload: {
            name: payload.name,
            description: payload.description,
            discount_type: payload.discount_type,
            discount_value: payload.discount_value,
            is_default: payload.is_default,
            is_active: payload.is_active,
          },
        });
        toast.success("Customer group updated.");
      } else {
        await createGroup(payload);
        toast.success("Customer group created.");
      }
      resetDraft();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save customer group.");
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Customer Groups"
        description="Manage customer segments used by contacts, accounts, and client portal pricing context."
      />

      <Card className="px-5 py-5">
        <form onSubmit={saveGroup} className="space-y-4">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
              {editingGroup ? "Edit Group" : "Create Group"}
            </h2>
          </div>
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required />
            </Field>
            <Field>
              <FieldLabel>Key</FieldLabel>
              <Input value={draft.group_key} onChange={(event) => setDraft((current) => ({ ...current, group_key: event.target.value }))} disabled={Boolean(editingGroup)} required />
            </Field>
            <Field>
              <FieldLabel>Discount Type</FieldLabel>
              <Select value={draft.discount_type} onValueChange={(value) => setDraft((current) => ({ ...current, discount_type: value }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No discount</SelectItem>
                  <SelectItem value="percent">Percent</SelectItem>
                  <SelectItem value="fixed">Fixed</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Discount Value</FieldLabel>
              <Input type="number" min="0" step="0.01" value={draft.discount_value} onChange={(event) => setDraft((current) => ({ ...current, discount_value: event.target.value }))} disabled={draft.discount_type === "none"} />
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel>Description</FieldLabel>
              <Textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
            </Field>
          </FieldGroup>
          <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-300">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.is_default} onChange={(event) => setDraft((current) => ({ ...current, is_default: event.target.checked }))} />
              Default group
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.is_active} onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))} />
              Active
            </label>
            <div className="ml-auto flex gap-2">
              {editingGroup ? <Button type="button" variant="outline" onClick={resetDraft}>Cancel</Button> : null}
              <Button type="submit" disabled={isSaving || !draft.name.trim() || !draft.group_key.trim()}>
                {isSaving ? "Saving..." : editingGroup ? "Save Group" : "Create Group"}
              </Button>
            </div>
          </div>
        </form>
      </Card>

      <div className="overflow-hidden rounded-md border border-neutral-800 bg-neutral-950/70">
        <Table>
          <TableHeader>
            <TableHeaderRow>
              <TableHead>Group</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Discount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Default</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {groups.isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-neutral-500">
                  Loading customer groups...
                </TableCell>
              </TableRow>
            ) : groups.data?.length ? (
              groups.data.map((group) => (
                <TableRow key={group.id}>
                  <TableCell>
                    <div className="font-medium text-neutral-100">{group.name}</div>
                    {group.description ? <div className="mt-1 text-xs text-neutral-500">{group.description}</div> : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-neutral-500">{group.group_key}</TableCell>
                  <TableCell className="text-neutral-400">{formatDiscount(group.discount_type, group.discount_value)}</TableCell>
                  <TableCell>
                    <span className={group.is_active ? "inline-flex rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300" : "inline-flex rounded-full bg-neutral-800 px-2 py-1 text-xs font-medium text-neutral-400"}>
                      {group.is_active ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell className="text-neutral-400">{group.is_default ? "Default" : "-"}</TableCell>
                  <TableCell className="text-right">
                    <Button type="button" size="sm" variant="outline" onClick={() => editGroup(group)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState
                    icon={BadgePercent}
                    title="No customer groups"
                    description="Customer groups will appear here once the backend provides them."
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
