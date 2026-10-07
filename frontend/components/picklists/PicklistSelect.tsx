"use client";

import { useMemo } from "react";

import { ServerFieldError } from "@/components/forms/ServerFieldErrors";
import { EMPTY_FIELD_VALUE } from "@/components/ui/EmptyValue";
import { Field, FieldLabel } from "@/components/ui/field";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { picklistOptions, usePicklist } from "@/hooks/usePicklists";

type PicklistSelectProps = {
  /** The list whose active values are offered (13b §3.1). */
  listKey: string;
  /** The control's accessible name. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  /** Optional fields offer `Not set` first, so a value can be cleared. */
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  size?: "sm" | "default";
  /** A dependent picklist's allowed keys (13b §3.6); `null` or absent offers the whole list. */
  allowedKeys?: string[] | null;
};

/**
 * A field whose values come from a tenant picklist. It stores the value's key; the label is
 * what the operator sees. A value that has since been switched off stays selectable on the
 * record that holds it, marked as no longer used.
 */
export function PicklistSelect({
  listKey,
  label,
  value,
  onChange,
  id,
  required,
  disabled,
  placeholder = "Select",
  ariaInvalid,
  ariaDescribedBy,
  size,
  allowedKeys,
}: PicklistSelectProps) {
  const { picklist, isLoading } = usePicklist(listKey);
  const options = useMemo(() => {
    let values = picklistOptions(picklist, value);
    if (!picklist && value) values.push({ value, label: value });
    if (allowedKeys) {
      // The held value stays visible even when no longer allowed, so the change is the user's.
      const allowed = new Set(allowedKeys);
      values = values.filter((option) => allowed.has(option.value) || option.value === value);
    }
    return required ? values : [{ value: "", label: EMPTY_FIELD_VALUE }, ...values];
  }, [allowedKeys, picklist, required, value]);

  return (
    <SearchableSelect
      id={id}
      label={label}
      value={value ?? ""}
      options={options}
      onValueChange={onChange}
      placeholder={isLoading ? "Loading…" : placeholder}
      disabled={disabled}
      required={required}
      ariaInvalid={ariaInvalid}
      ariaDescribedBy={ariaDescribedBy}
      size={size}
      renderValue={(selected) => (selected && selected.value ? selected.label : <span className="text-copy-muted">{placeholder}</span>)}
    />
  );
}

type PicklistFieldProps = Omit<PicklistSelectProps, "id"> & { id: string };

/** A labelled picklist control in a form, with its server error slot (H2). */
export function PicklistField({ id, label, required, ...rest }: PicklistFieldProps) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {label}
        {required ? <RequiredMark /> : null}
      </FieldLabel>
      <PicklistSelect id={id} label={label} required={required} {...rest} />
      <ServerFieldError inputId={id} />
    </Field>
  );
}
