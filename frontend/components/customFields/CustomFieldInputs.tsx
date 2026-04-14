"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CustomFieldDefinition } from "@/hooks/useModuleCustomFields";

type Props = {
  definitions: CustomFieldDefinition[];
  values: Record<string, unknown>;
  onChange: (fieldKey: string, value: unknown) => void;
};

function RequiredMark() {
  return <span className="text-red-400">*</span>;
}

export default function CustomFieldInputs({ definitions, values, onChange }: Props) {
  if (!definitions.length) return null;

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-4 py-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">Custom Fields</h3>
        <p className="mt-1 text-sm text-neutral-500">Configured for this module by an administrator.</p>
      </div>

      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        {definitions.map((field) => {
          const value = values[field.field_key];

          if (field.field_type === "long_text") {
            return (
              <Field key={field.id} className="sm:col-span-2">
                <FieldLabel>
                  {field.label} {field.is_required ? <RequiredMark /> : null}
                </FieldLabel>
                <Textarea
                  value={typeof value === "string" ? value : ""}
                  onChange={(event) => onChange(field.field_key, event.target.value)}
                  placeholder={field.placeholder ?? ""}
                  rows={3}
                />
                {field.help_text ? <FieldDescription>{field.help_text}</FieldDescription> : null}
              </Field>
            );
          }

          if (field.field_type === "boolean") {
            return (
              <Field key={field.id}>
                <FieldLabel>
                  {field.label} {field.is_required ? <RequiredMark /> : null}
                </FieldLabel>
                <div className="flex items-center gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2">
                  <Checkbox
                    checked={value === true}
                    onCheckedChange={(checked) => onChange(field.field_key, checked === true)}
                    className="h-4 w-4 rounded border border-neutral-700 bg-neutral-900"
                  />
                  <span className="text-sm text-neutral-300">Enabled</span>
                </div>
                {field.help_text ? <FieldDescription>{field.help_text}</FieldDescription> : null}
              </Field>
            );
          }

          return (
            <Field key={field.id}>
              <FieldLabel>
                {field.label} {field.is_required ? <RequiredMark /> : null}
              </FieldLabel>
              <Input
                type={field.field_type === "number" || field.field_type === "date" ? field.field_type : "text"}
                value={value == null ? "" : String(value)}
                onChange={(event) => onChange(field.field_key, event.target.value)}
                placeholder={field.placeholder ?? ""}
              />
              {field.help_text ? <FieldDescription>{field.help_text}</FieldDescription> : null}
            </Field>
          );
        })}
      </FieldGroup>
    </div>
  );
}
