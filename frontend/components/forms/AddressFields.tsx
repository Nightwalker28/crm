"use client";

import { TextField } from "@/components/forms/TextField";
import { PicklistField } from "@/components/picklists/PicklistSelect";
import { FieldGroup } from "@/components/ui/field";

/**
 * One structured address, the shape every record uses (13b §3.5): street, a second street
 * line, city, state or province, postal code, and a country from the locked ISO list. The
 * columns are `<prefix>_address`, `<prefix>_street2`, … — `billing`, `shipping`, `mailing`.
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
  return (
    <FieldGroup columns={2}>
      <TextField id={`${idPrefix}-address`} label="Street" value={value.address} onChange={set("address")} disabled={disabled} className="md:col-span-2" />
      <TextField id={`${idPrefix}-street2`} label="Street line 2" value={value.street2} onChange={set("street2")} disabled={disabled} className="md:col-span-2" />
      <TextField id={`${idPrefix}-city`} label="City" value={value.city} onChange={set("city")} disabled={disabled} />
      <TextField id={`${idPrefix}-state`} label="State or province" value={value.state} onChange={set("state")} disabled={disabled} />
      <TextField id={`${idPrefix}-postal-code`} label="Postal code" value={value.postal_code} onChange={set("postal_code")} disabled={disabled} />
      <PicklistField id={`${idPrefix}-country`} listKey="country" label="Country" value={value.country} onChange={set("country")} disabled={disabled} />
    </FieldGroup>
  );
}
