"use client";

import { ADDRESS_PARTS } from "@/components/forms/AddressFields";
import type { RecordFormValue } from "@/components/forms/RecordForm";
import { Button } from "@/components/ui/button";

/**
 * What a quote or an order carries beyond its lines (13b §3.5): billing and shipping
 * addresses, the customer's PO reference, a shipping method and charge, terms, and — once the
 * document is declined or cancelled — why. The addresses are snapshots: left blank, the
 * account's are copied on save, and they travel on to the order and the invoice.
 *
 * Since 13b Phase 4e the form draws these from the `full_form` layout, so the value is flat,
 * keyed by field key (`billing_city`, `shipping_charge`), like the rest of the form.
 */
export type DocumentHeaderValue = RecordFormValue;

const ADDRESS_KEYS = (["billing", "shipping"] as const).flatMap((prefix) => ADDRESS_PARTS.map((part) => `${prefix}_${part}`));
const TEXT_KEYS = ["customer_po_reference", "terms_and_conditions", "shipping_method", "lost_reason"] as const;

export const EMPTY_DOCUMENT_HEADER: DocumentHeaderValue = Object.fromEntries(
  [...ADDRESS_KEYS, ...TEXT_KEYS, "shipping_charge"].map((key) => [key, ""]),
);

export function documentHeaderFrom(record: Record<string, unknown> | null | undefined): DocumentHeaderValue {
  if (!record) return EMPTY_DOCUMENT_HEADER;
  const value: Record<string, string> = {};
  for (const key of [...ADDRESS_KEYS, ...TEXT_KEYS]) {
    const raw = record[key];
    value[key] = typeof raw === "string" ? raw : "";
  }
  const charge = record.shipping_charge;
  value.shipping_charge = charge === null || charge === undefined || Number(charge) === 0 ? "" : String(charge);
  return value;
}

export function documentHeaderPayload(value: RecordFormValue) {
  const text = (key: string) => String(value[key] ?? "").trim() || null;
  return {
    ...Object.fromEntries(ADDRESS_KEYS.map((key) => [key, text(key)])),
    customer_po_reference: text("customer_po_reference"),
    terms_and_conditions: text("terms_and_conditions"),
    shipping_method: text("shipping_method"),
    shipping_charge: text("shipping_charge") ?? "0",
    lost_reason: text("lost_reason"),
  };
}

/** The shipping charge as a number, for the running total; blank or invalid is nothing. */
export function shippingChargeAmount(value: RecordFormValue) {
  const amount = Number(value.shipping_charge);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/**
 * The element id of a header field: the ids these fields had before the layout drew them,
 * so focus, server errors and browser tests still find them.
 */
export function documentHeaderInputId(idPrefix: string, path: string): string | null {
  const address = /^(billing|shipping)_(address|street2|city|state|postal_code|country)$/.exec(path);
  if (address) return `${idPrefix}-${address[1]}-${address[2].replace("_", "-")}`;
  const plain: Record<string, string> = {
    customer_po_reference: "po-reference",
    terms_and_conditions: "terms",
    shipping_method: "shipping-method",
    shipping_charge: "shipping-charge",
    lost_reason: "lost-reason",
  };
  return plain[path] ? `${idPrefix}-${plain[path]}` : null;
}

/** *Same as billing* in the shipping section's heading: copies the billing address over. */
export function SameAsBillingButton({ value, set }: { value: RecordFormValue; set: (patch: RecordFormValue) => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => set(Object.fromEntries(ADDRESS_PARTS.map((part) => [`shipping_${part}`, value[`billing_${part}`] ?? ""])))}
    >
      Same as billing
    </Button>
  );
}
