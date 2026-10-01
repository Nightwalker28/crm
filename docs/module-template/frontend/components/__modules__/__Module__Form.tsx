"use client";

import { useMemo, useState } from "react";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/forms/TextField";
import { Card } from "@/components/ui/Card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
        <FieldGroup columns={2}>
          {fieldEnabled("name") ? (
            <TextField id="__module__-name" label="Name" value={form.name} onChange={(name) => setForm((current) => ({ ...current, name }))} />
          ) : null}
          {fieldEnabled("status") ? (
            <Field>
              <FieldLabel htmlFor="__module__-status">Status</FieldLabel>
              <Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value }))}>
                <SelectTrigger id="__module__-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </FieldGroup>
        {fieldEnabled("description") ? (
          <TextField id="__module__-description" label="Description" value={form.description} onChange={(description) => setForm((current) => ({ ...current, description }))} />
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
