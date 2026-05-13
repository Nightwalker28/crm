"use client";

import { FormEvent, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { Save, X } from "lucide-react";

import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CustomModuleField, CustomModuleRecord } from "@/hooks/useModuleBuilder";

type CustomModuleRecordPayload = {
  title?: string;
  values: Record<string, unknown>;
};

type Props = {
  open: boolean;
  mode: "create" | "edit";
  fields: CustomModuleField[];
  record?: CustomModuleRecord | null;
  isSaving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: CustomModuleRecordPayload) => Promise<void>;
};

const EMPTY_SELECT_VALUE = "__none__";

function getInitialValues(fields: CustomModuleField[], record?: CustomModuleRecord | null) {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    values[field.key] = record?.values?.[field.key] ?? field.default_value ?? (field.field_type === "boolean" ? false : "");
  }
  return values;
}

function getInputType(field: CustomModuleField) {
  if (field.field_type === "number" || field.field_type === "currency") return "number";
  if (field.field_type === "date") return "date";
  if (field.field_type === "datetime") return "datetime-local";
  if (field.field_type === "email") return "email";
  if (field.field_type === "url") return "url";
  if (field.field_type === "phone") return "tel";
  return "text";
}

function CustomFieldInput({
  field,
  value,
  onChange,
}: {
  field: CustomModuleField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const options = field.validation_json?.options ?? [];

  if (field.field_type === "single_select" && options.length) {
    const selectedValue = typeof value === "string" && value ? value : EMPTY_SELECT_VALUE;
    return (
      <Select value={selectedValue} onValueChange={(next) => onChange(next === EMPTY_SELECT_VALUE ? "" : next)}>
        <SelectTrigger className="w-full border-neutral-800 bg-neutral-950 text-neutral-200">
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={EMPTY_SELECT_VALUE}>Select...</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.field_type === "multi_select" && options.length) {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <div className="flex flex-wrap gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/60 px-2 py-1.5 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...selected, option]
                  : selected.filter((item) => item !== option);
                onChange(next);
              }}
              className="h-4 w-4 rounded border-neutral-700 bg-neutral-950"
            />
            {option}
          </label>
        ))}
      </div>
    );
  }

  if (field.field_type === "textarea") {
    return (
      <Textarea
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder ?? field.label}
        required={field.is_required}
        className="bg-neutral-950"
      />
    );
  }

  if (field.field_type === "boolean") {
    return (
      <label className="flex min-h-9 items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
        <span className="flex items-center gap-2">
          {field.label}
          {field.is_required ? <RequiredMark /> : null}
        </span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 rounded border-neutral-700 bg-neutral-950"
        />
      </label>
    );
  }

  return (
    <Input
      type={getInputType(field)}
      value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      placeholder={field.placeholder ?? field.label}
      required={field.is_required}
      className="bg-neutral-950"
    />
  );
}

export function CustomModuleRecordDialog({
  open,
  mode,
  fields,
  record,
  isSaving = false,
  error,
  onClose,
  onSubmit,
}: Props) {
  const sortedFields = useMemo(
    () => fields.filter((field) => field.is_active).sort((a, b) => a.sort_order - b.sort_order),
    [fields],
  );
  const [title, setTitle] = useState(record?.title ?? "");
  const [values, setValues] = useState<Record<string, unknown>>(() => getInitialValues(sortedFields, record));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await onSubmit({
      title: title.trim() || record?.title || undefined,
      values,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} className="z-50">
      <DialogBackdrop />
      <div className="fixed inset-0 flex items-start justify-center overflow-y-auto px-4 py-[10vh]">
        <DialogPanel size="3xl" className="scrollbar-hide border-white/10 bg-neutral-950 p-0">
          <form onSubmit={handleSubmit}>
            <DialogHeader className="border-b border-neutral-800 px-5 py-4">
              <div>
                <DialogTitle className="text-base font-semibold text-neutral-100">
                  {mode === "create" ? "New Record" : "Edit Record"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-sm text-neutral-500">
                  {mode === "create" ? "Create a record in this custom module." : `Update ${record?.title ?? "this record"}.`}
                </DialogDescription>
              </div>
              <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-900 hover:text-neutral-100" aria-label="Close record dialog">
                <X size={15} />
              </button>
            </DialogHeader>

            <div className="space-y-4 px-5 py-5">
              {error ? <div className="rounded-md border border-red-900/70 bg-red-950/30 px-4 py-3 text-sm text-red-100">{error}</div> : null}
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field className="sm:col-span-2">
                  <FieldLabel>Record Title</FieldLabel>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Record title" className="bg-neutral-950" />
                </Field>
                {sortedFields.map((field) => (
                  <Field key={field.id} className={field.field_type === "textarea" || field.field_type === "multi_select" ? "sm:col-span-2" : undefined}>
                    {field.field_type !== "boolean" ? (
                      <FieldLabel>
                        {field.label}
                        {field.is_required ? <RequiredMark /> : null}
                      </FieldLabel>
                    ) : null}
                    <CustomFieldInput
                      field={field}
                      value={values[field.key]}
                      onChange={(next) => setValues((current) => ({ ...current, [field.key]: next }))}
                    />
                  </Field>
                ))}
              </FieldGroup>
            </div>

            <DialogFooter className="border-t border-neutral-800 px-5 py-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving || sortedFields.length === 0} className="border border-neutral-700 bg-neutral-100 text-neutral-950 hover:bg-white">
                <Save size={15} />
                {mode === "create" ? "Create Record" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
