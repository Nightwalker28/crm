"use client";

import type { ReactNode } from "react";

import { AddressFields, addressFrom, addressPayload, EMPTY_ADDRESS, type AddressValue } from "@/components/forms/AddressFields";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { PicklistField } from "@/components/picklists/PicklistSelect";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * What a quote or an order carries beyond its lines (13b §3.5): billing and shipping
 * addresses, the customer's PO reference, a shipping method and charge, terms, and — once the
 * document is declined or cancelled — why. The addresses are snapshots: left blank, the
 * account's are copied on save, and they travel on to the order and the invoice.
 */
export type DocumentHeaderValue = {
  billing: AddressValue;
  shipping: AddressValue;
  customer_po_reference: string;
  terms_and_conditions: string;
  shipping_method: string;
  shipping_charge: string;
  lost_reason: string;
};

export const EMPTY_DOCUMENT_HEADER: DocumentHeaderValue = {
  billing: EMPTY_ADDRESS,
  shipping: EMPTY_ADDRESS,
  customer_po_reference: "",
  terms_and_conditions: "",
  shipping_method: "",
  shipping_charge: "",
  lost_reason: "",
};

type HeaderSource = Record<string, unknown> & {
  customer_po_reference?: string | null;
  terms_and_conditions?: string | null;
  shipping_method?: string | null;
  shipping_charge?: number | string | null;
  lost_reason?: string | null;
};

export function documentHeaderFrom(record: HeaderSource | null | undefined): DocumentHeaderValue {
  if (!record) return EMPTY_DOCUMENT_HEADER;
  const charge = record.shipping_charge;
  return {
    billing: addressFrom(record, "billing"),
    shipping: addressFrom(record, "shipping"),
    customer_po_reference: record.customer_po_reference ?? "",
    terms_and_conditions: record.terms_and_conditions ?? "",
    shipping_method: record.shipping_method ?? "",
    shipping_charge: charge === null || charge === undefined || Number(charge) === 0 ? "" : String(charge),
    lost_reason: record.lost_reason ?? "",
  };
}

export function documentHeaderPayload(value: DocumentHeaderValue) {
  return {
    ...addressPayload("billing", value.billing),
    ...addressPayload("shipping", value.shipping),
    customer_po_reference: value.customer_po_reference.trim() || null,
    terms_and_conditions: value.terms_and_conditions.trim() || null,
    shipping_method: value.shipping_method || null,
    shipping_charge: value.shipping_charge.trim() || "0",
    lost_reason: value.lost_reason || null,
  };
}

/** The shipping charge as a number, for the running total; blank or invalid is nothing. */
export function shippingChargeAmount(value: DocumentHeaderValue) {
  const amount = Number(value.shipping_charge);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/** Maps a server error path on these fields to the input that shows it. */
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

export function DocumentAddressesSection({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: DocumentHeaderValue;
  onChange: (value: DocumentHeaderValue) => void;
}) {
  return (
    <FormSection
      title="Addresses"
      description="Left blank, the account's addresses are copied when you save. Changing them here changes this document only."
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-copy-secondary">Billing address</h3>
          <AddressFields idPrefix={`${idPrefix}-billing`} value={value.billing} onChange={(billing) => onChange({ ...value, billing })} />
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-copy-secondary">Shipping address</h3>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...value, shipping: value.billing })}>
              Same as billing
            </Button>
          </div>
          <AddressFields idPrefix={`${idPrefix}-shipping`} value={value.shipping} onChange={(shipping) => onChange({ ...value, shipping })} />
        </div>
      </div>
    </FormSection>
  );
}

export function DocumentTermsSection({
  idPrefix,
  value,
  onChange,
  showLostReason,
  lostReasonLabel,
  children,
}: {
  idPrefix: string;
  value: DocumentHeaderValue;
  onChange: (value: DocumentHeaderValue) => void;
  /** Only once the document is declined or cancelled: a field for a state it is not in is noise (§4.7, A12). */
  showLostReason: boolean;
  lostReasonLabel: string;
  /** The module's own fields that belong with these (payment terms, delivery date). */
  children?: ReactNode;
}) {
  return (
    <FormSection title="Shipping and terms" description="What the customer sees on the document and what travels on to the invoice.">
      <FieldGroup columns={2}>
        {children}
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-po-reference`}>Customer PO reference</FieldLabel>
          <Input
            id={`${idPrefix}-po-reference`}
            value={value.customer_po_reference}
            onChange={(event) => onChange({ ...value, customer_po_reference: event.target.value })}
          />
        </Field>
        <PicklistField
          id={`${idPrefix}-shipping-method`}
          listKey="shipping_method"
          label="Shipping method"
          value={value.shipping_method}
          onChange={(shipping_method) => onChange({ ...value, shipping_method })}
        />
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-shipping-charge`}>Shipping charge</FieldLabel>
          <Input
            id={`${idPrefix}-shipping-charge`}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={value.shipping_charge}
            onChange={(event) => onChange({ ...value, shipping_charge: event.target.value })}
            aria-describedby={`${idPrefix}-shipping-charge-description`}
          />
          <FieldDescription id={`${idPrefix}-shipping-charge-description`}>Added to the total, and invoiced with the order&apos;s first invoice.</FieldDescription>
        </Field>
        {showLostReason ? (
          <PicklistField
            id={`${idPrefix}-lost-reason`}
            listKey="lost_reason"
            label={lostReasonLabel}
            value={value.lost_reason}
            onChange={(lost_reason) => onChange({ ...value, lost_reason })}
          />
        ) : null}
        <Field className="md:col-span-2">
          <FieldLabel htmlFor={`${idPrefix}-terms`}>Terms and conditions</FieldLabel>
          <Textarea
            id={`${idPrefix}-terms`}
            rows={5}
            value={value.terms_and_conditions}
            onChange={(event) => onChange({ ...value, terms_and_conditions: event.target.value })}
          />
        </Field>
      </FieldGroup>
    </FormSection>
  );
}
