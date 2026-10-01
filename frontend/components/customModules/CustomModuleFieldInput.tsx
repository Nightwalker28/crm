"use client";

import type { ChangeEvent } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CustomModuleField, CustomModuleRecord } from "@/hooks/useModuleBuilder";
import { cn } from "@/lib/utils";

const EMPTY_SELECT_VALUE = "__none__";

export function getInitialCustomModuleValues(
  fields: CustomModuleField[],
  record?: CustomModuleRecord | null,
) {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    values[field.key] =
      record?.values?.[field.key] ??
      field.default_value ??
      (field.field_type === "boolean" ? false : "");
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

export function CustomModuleFieldInput({
  field,
  value,
  onChange,
  invalid = false,
  disabled = false,
}: {
  field: CustomModuleField;
  value: unknown;
  onChange: (value: unknown) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const inputId = `custom-field-${field.key}`;
  const options = field.validation_json?.options ?? [];

  if (field.field_type === "single_select" && options.length) {
    const selectedValue = typeof value === "string" && value ? value : EMPTY_SELECT_VALUE;
    return (
      <Select
        value={selectedValue}
        onValueChange={(next) => onChange(next === EMPTY_SELECT_VALUE ? "" : next)}
        disabled={disabled}
      >
        <SelectTrigger id={inputId} className="w-full" aria-invalid={invalid}>
          <SelectValue placeholder="Select an option" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={EMPTY_SELECT_VALUE}>Select an option</SelectItem>
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
      <div
        id={inputId}
        role="group"
        aria-label={field.label}
        data-invalid={invalid || undefined}
        className={cn(
          "grid gap-2 rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3 sm:grid-cols-2",
          invalid && "border-state-danger",
        )}
      >
        {options.map((option) => {
          const checked = selected.includes(option);
          return (
            <label
              key={option}
              className={cn(
                "flex items-center gap-2 rounded-[var(--radius-control-sm)] px-2 py-2 text-sm text-copy-secondary",
                disabled ? "cursor-default opacity-70" : "cursor-pointer hover:bg-surface-raised",
              )}
            >
              <Checkbox
                checked={checked}
                disabled={disabled}
                onCheckedChange={(nextChecked) => {
                  const next = nextChecked
                    ? [...selected, option]
                    : selected.filter((item) => item !== option);
                  onChange(next);
                }}
                aria-label={option}
              />
              {option}
            </label>
          );
        })}
      </div>
    );
  }

  if (field.field_type === "textarea") {
    return (
      <Textarea
        id={inputId}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder ?? field.label}
        required={field.is_required}
        aria-invalid={invalid}
        disabled={disabled}
        rows={5}
      />
    );
  }

  if (field.field_type === "boolean") {
    return (
      <label
        htmlFor={inputId}
        className={cn(
          "flex min-h-10 items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-2 text-sm text-copy-secondary",
          disabled ? "cursor-default opacity-70" : "cursor-pointer",
        )}
      >
        <span className="flex items-center gap-2">
          {field.label}
          {field.is_required ? <RequiredMark /> : null}
        </span>
        <Checkbox
          id={inputId}
          checked={Boolean(value)}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(Boolean(checked))}
          aria-invalid={invalid}
        />
      </label>
    );
  }

  return (
    <Input
      id={inputId}
      type={getInputType(field)}
      value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      placeholder={field.placeholder ?? field.label}
      required={field.is_required}
      aria-invalid={invalid}
      disabled={disabled}
      step={field.field_type === "number" || field.field_type === "currency" ? "any" : undefined}
    />
  );
}
