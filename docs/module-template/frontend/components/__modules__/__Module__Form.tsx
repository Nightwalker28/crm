"use client";

import { useMemo, useState } from "react";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { isModuleFieldEnabled, pickEnabledModulePayload, useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import type { __Module__, __Module__CreateRequest, __Module__UpdateRequest } from "@/types/__modules__";

type __Module__FormState = {
  name: string;
  description: string;
  status: string;
};

function toForm(record?: __Module__ | null): __Module__FormState {
  return {
    name: record?.name ?? "",
    description: record?.description ?? "",
    status: record?.status ?? "active",
  };
}

type Props = {
  initialRecord?: __Module__ | null;
  submitLabel: string;
  isSubmitting?: boolean;
  error?: string | null;
  onSubmit: (payload: __Module__CreateRequest | __Module__UpdateRequest) => Promise<void> | void;
};

export default function __Module__Form({ initialRecord, submitLabel, isSubmitting = false, error, onSubmit }: Props) {
  const [form, setForm] = useState<__Module__FormState>(() => toForm(initialRecord));
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>(initialRecord?.custom_fields ?? {});
  const customFieldsQuery = useModuleCustomFields("__MODULE_KEY__");
  const { fields: moduleFields } = useModuleFieldConfigs("__MODULE_KEY__");
  const fieldEnabled = (fieldKey: string) => isModuleFieldEnabled(moduleFields, fieldKey);
  const canSubmit = useMemo(() => Boolean(form.name.trim()) && !isSubmitting, [form.name, isSubmitting]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = pickEnabledModulePayload({
      name: form.name.trim(),
      description: form.description.trim() || null,
      status: form.status,
      custom_fields: customFieldValues,
    }, moduleFields, ["name", "custom_fields"]);
    await onSubmit(payload);
  }

  return (
    <Card className="px-5 py-5">
      <form onSubmit={submit} className="space-y-4">
        {error ? <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}
        <FieldGroup className="grid gap-4 md:grid-cols-2">
          {fieldEnabled("name") ? (
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </Field>
          ) : null}
          {fieldEnabled("status") ? (
            <Field>
              <FieldLabel>Status</FieldLabel>
              <Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </FieldGroup>
        {fieldEnabled("description") ? (
          <Field>
            <FieldLabel>Description</FieldLabel>
            <Input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </Field>
        ) : null}
        <CustomFieldInputs
          definitions={customFieldsQuery.data ?? []}
          values={customFieldValues}
          onChange={(fieldKey, value) => setCustomFieldValues((current) => ({ ...current, [fieldKey]: value }))}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={!canSubmit}>{isSubmitting ? "Saving..." : submitLabel}</Button>
        </div>
      </form>
    </Card>
  );
}
