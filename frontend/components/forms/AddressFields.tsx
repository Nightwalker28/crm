"use client";

import { useMemo } from "react";

import { ServerFieldError } from "@/components/forms/ServerFieldErrors";
import { TextField } from "@/components/forms/TextField";
import { PicklistField } from "@/components/picklists/PicklistSelect";
import { EMPTY_FIELD_VALUE } from "@/components/ui/EmptyValue";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useSubdivisions } from "@/hooks/useSubdivisions";

/**
 * One structured address, the shape every record uses (13b §3.5): street, a second street
 * line, city, state or province, postal code, and a country from the locked ISO list. The
 * columns are `<prefix>_address`, `<prefix>_street2`, … — `billing`, `shipping`, `mailing`.
 *
 * The state is a list of the country's states or provinces when the country has them (ISO
 * 3166-2, 13b §3.6) and free text otherwise; it stores the name. Changing the country clears
 * the state, since the server refuses a state its country does not have.
 */
export const ADDRESS_PARTS = ["address", "street2", "city", "state", "postal_code", "country"] as const;
export type AddressPart = (typeof ADDRESS_PARTS)[number];
export type AddressValue = Record<AddressPart, string>;

export const EMPTY_ADDRESS: AddressValue = { address: "", street2: "", city: "", state: "", postal_code: "", country: "" };

/** Reads `<prefix>_*` off a record into form strings. */
export function addressFrom(record: Record<string, unknown> | null | undefined, prefix: string): AddressValue {
  const value = { ...EMPTY_ADDRESS };
  for (const part of ADDRESS_PARTS) {
    const raw = record?.[`${prefix}_${part}`];
    value[part] = typeof raw === "string" ? raw : "";
  }
  return value;
}

/** The `<prefix>_*` payload, blanks sent as `null`. */
export function addressPayload(prefix: string, value: AddressValue): Record<string, string | null> {
  return Object.fromEntries(ADDRESS_PARTS.map((part) => [`${prefix}_${part}`, value[part].trim() || null]));
}

/** The flat `<prefix>_*` form strings for an address, to spread into a flat form value. */
export function flatAddress(prefix: string, value: AddressValue): Record<string, string> {
  return Object.fromEntries(ADDRESS_PARTS.map((part) => [`${prefix}_${part}`, value[part]]));
}

/** Empty `<prefix>_*` strings, for a flat form's initial value. */
export function emptyFlatAddress(prefix: string): Record<string, string> {
  return flatAddress(prefix, EMPTY_ADDRESS);
}

export function isAddressBlank(value: AddressValue) {
  return ADDRESS_PARTS.every((part) => !value[part].trim());
}

export function AddressFields({
  idPrefix,
  value,
  onChange,
  disabled,
}: {
  /** Prefixes every input id, and the server error slot keyed by the column name. */
  idPrefix: string;
  value: AddressValue;
  onChange: (value: AddressValue) => void;
  disabled?: boolean;
}) {
  const set = (part: AddressPart) => (next: string) => onChange({ ...value, [part]: next });
  const setCountry = (country: string) =>
    onChange({ ...value, country, state: country === value.country ? value.state : "" });
  return (
    <FieldGroup columns={2}>
      <TextField id={`${idPrefix}-address`} label="Street" value={value.address} onChange={set("address")} disabled={disabled} className="md:col-span-2" />
      <TextField id={`${idPrefix}-street2`} label="Street line 2" value={value.street2} onChange={set("street2")} disabled={disabled} className="md:col-span-2" />
      <TextField id={`${idPrefix}-city`} label="City" value={value.city} onChange={set("city")} disabled={disabled} />
      <StateField id={`${idPrefix}-state`} country={value.country} value={value.state} onChange={set("state")} disabled={disabled} />
      <TextField id={`${idPrefix}-postal-code`} label="Postal code" value={value.postal_code} onChange={set("postal_code")} disabled={disabled} />
      <PicklistField id={`${idPrefix}-country`} listKey="country" label="Country" value={value.country} onChange={setCountry} disabled={disabled} />
    </FieldGroup>
  );
}

function StateField({
  id,
  country,
  value,
  onChange,
  disabled,
}: {
  id: string;
  country: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const label = "State or province";
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <StateSelect id={id} label={label} country={country} value={value} onChange={onChange} disabled={disabled} />
      <ServerFieldError inputId={id} />
    </Field>
  );
}

/**
 * The state control alone: a list of the country's states or provinces when it has them,
 * a text input otherwise (no country, or one the ISO list does not divide).
 */
export function StateSelect({
  id,
  label,
  country,
  value,
  onChange,
  disabled,
  ariaInvalid,
  ariaDescribedBy,
}: {
  id: string;
  label: string;
  country: string | null | undefined;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}) {
  const { subdivisions, isLoading } = useSubdivisions(country);
  const options = useMemo(() => {
    const names = subdivisions.map((item) => ({ value: item.name, label: item.name }));
    // A value from before the list (or another spelling) stays visible until it is changed.
    if (value && !names.some((option) => option.value === value)) names.unshift({ value, label: value });
    return [{ value: "", label: EMPTY_FIELD_VALUE }, ...names];
  }, [subdivisions, value]);

  if (!country || (!isLoading && subdivisions.length === 0)) {
    return (
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      />
    );
  }
  return (
    <SearchableSelect
      id={id}
      label={label}
      value={value}
      options={options}
      onValueChange={onChange}
      placeholder={isLoading ? "Loading…" : "Select"}
      disabled={disabled || isLoading}
      ariaInvalid={ariaInvalid}
      ariaDescribedBy={ariaDescribedBy}
      renderValue={(selected) => (selected && selected.value ? selected.label : <span className="text-copy-muted">Select</span>)}
    />
  );
}
