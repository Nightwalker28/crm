"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import type { CustomFieldDefinition } from "@/hooks/useModuleCustomFields";

const MODULE_OPTIONS = [
  { value: "finance_io", label: "Finance Insertion Orders" },
  { value: "sales_contacts", label: "Sales Contacts" },
  { value: "sales_organizations", label: "Sales Organizations" },
  { value: "sales_opportunities", label: "Sales Opportunities" },
];

const FIELD_TYPE_OPTIONS: Array<CustomFieldDefinition["field_type"]> = ["text", "long_text", "number", "date", "boolean"];

type DraftField = {
  field_key: string;
  label: string;
  field_type: CustomFieldDefinition["field_type"];
  placeholder: string;
  help_text: string;
  is_required: boolean;
};

const emptyDraft: DraftField = {
  field_key: "",
  label: "",
  field_type: "text",
  placeholder: "",
  help_text: "",
  is_required: false,
};

async function fetchAdminCustomFields(moduleKey: string): Promise<CustomFieldDefinition[]> {
  const res = await apiFetch(`/admin/custom-fields/${moduleKey}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
  return res.json();
}

export default function CustomFieldsPage() {
  const queryClient = useQueryClient();
  const [moduleKey, setModuleKey] = useState("sales_contacts");
  const [draft, setDraft] = useState<DraftField>(emptyDraft);

  const query = useQuery({
    queryKey: ["admin-custom-fields", moduleKey],
    queryFn: () => fetchAdminCustomFields(moduleKey),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/admin/custom-fields/${moduleKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      return body as CustomFieldDefinition;
    },
    onSuccess: async () => {
      setDraft(emptyDraft);
      await Promise.all([
        query.refetch(),
        queryClient.invalidateQueries({ queryKey: ["custom-fields", moduleKey] }),
      ]);
      toast.success("Custom field created.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ fieldId, payload }: { fieldId: number; payload: Partial<CustomFieldDefinition> }) => {
      const res = await apiFetch(`/admin/custom-fields/${fieldId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      return body as CustomFieldDefinition;
    },
    onSuccess: async () => {
      await Promise.all([
        query.refetch(),
        queryClient.invalidateQueries({ queryKey: ["custom-fields", moduleKey] }),
      ]);
      toast.success("Custom field updated.");
    },
  });

  useEffect(() => {
    setDraft(emptyDraft);
  }, [moduleKey]);

  return (
    <div className="flex flex-col gap-5 text-neutral-200">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold leading-none">Custom Fields</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Add configurable fields to existing modules without changing the protected core schema.
          </p>
        </div>
        <Select value={moduleKey} onValueChange={setModuleKey}>
          <SelectTrigger className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODULE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <Card className="px-5 py-5">
          <h2 className="text-lg font-semibold text-neutral-100">Add Field</h2>
          <p className="mt-1 text-sm text-neutral-500">These fields appear in the active create and edit flows for this module.</p>

          <FieldGroup className="mt-4 grid gap-4">
            <Field>
              <FieldLabel>Field Key</FieldLabel>
              <Input value={draft.field_key} onChange={(event) => setDraft((current) => ({ ...current, field_key: event.target.value }))} placeholder="contract_term" />
            </Field>
            <Field>
              <FieldLabel>Label</FieldLabel>
              <Input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Contract Term" />
            </Field>
            <Field>
              <FieldLabel>Field Type</FieldLabel>
              <Select
                value={draft.field_type}
                onValueChange={(value) => setDraft((current) => ({ ...current, field_type: value as DraftField["field_type"] }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Placeholder</FieldLabel>
              <Input value={draft.placeholder} onChange={(event) => setDraft((current) => ({ ...current, placeholder: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel>Help Text</FieldLabel>
              <Input value={draft.help_text} onChange={(event) => setDraft((current) => ({ ...current, help_text: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel>Required</FieldLabel>
              <div className="flex items-center gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2">
                <Checkbox
                  checked={draft.is_required}
                  onCheckedChange={(checked) => setDraft((current) => ({ ...current, is_required: checked === true }))}
                  className="h-4 w-4 rounded border border-neutral-700 bg-neutral-900"
                >
                  <CheckboxIndicator className="h-3 w-3" />
                </Checkbox>
                <span className="text-sm text-neutral-300">Require this value on save</span>
              </div>
              <FieldDescription>Core fields still remain protected and cannot be removed here.</FieldDescription>
            </Field>
          </FieldGroup>

          <div className="mt-5">
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!draft.field_key.trim() || !draft.label.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create Field"}
            </Button>
          </div>
        </Card>

        <Card className="overflow-hidden px-0 py-0">
          <div className="border-b border-neutral-800 px-5 py-4">
            <h2 className="text-lg font-semibold text-neutral-100">Configured Fields</h2>
            <p className="mt-1 text-sm text-neutral-500">Disable fields instead of deleting them so historical data remains intact.</p>
          </div>

          {query.isLoading ? (
            <div className="px-5 py-5 text-sm text-neutral-500">Loading custom fields…</div>
          ) : !query.data?.length ? (
            <div className="px-5 py-8">
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-800 bg-neutral-950/50 px-6 py-10 text-center">
                <Sparkles className="h-8 w-8 text-neutral-600" />
                <div className="mt-3 text-sm font-medium text-neutral-200">No custom fields yet</div>
                <div className="mt-1 text-sm text-neutral-500">
                  Use the form on the left to add the first custom field for this module.
                </div>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-neutral-800">
              {query.data.map((field) => (
                <div key={field.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-neutral-100">{field.label}</div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {field.field_key} · {field.field_type} {field.is_required ? "· required" : ""} {field.is_active ? "· active" : "· inactive"}
                    </div>
                    {field.help_text ? <div className="mt-2 text-sm text-neutral-400">{field.help_text}</div> : null}
                  </div>
                  <Button
                    variant="outline"
                    onClick={() =>
                      updateMutation.mutate({
                        fieldId: field.id,
                        payload: { is_active: !field.is_active },
                      })
                    }
                    disabled={updateMutation.isPending}
                  >
                    {field.is_active ? "Disable" : "Enable"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
