"use client";

import { useState } from "react";

import { ContactQuickCreate } from "@/components/contacts/ContactQuickCreate";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import type { RecordFormFieldContext, RecordFormValue } from "@/components/forms/RecordForm";
import { QuickCreateField } from "@/components/forms/quickCreateLayout";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import type { ResolvedRecordLayoutField } from "@/hooks/useResolvedRecordLayout";

type CustomerValue = RecordFormValue & {
  customer_name?: string;
  organization_id?: number | null;
  organization_name?: string;
  contact_id?: number | null;
  contact_name?: string;
  opportunity_id?: number | null;
  opportunity_name?: string;
};

/**
 * A quote's customer pickers through `RecordForm` (13b Phase 4e), with the rules the
 * hand-written form had: the account narrows the contact and the deal, a new account clears
 * both, a contact or deal fills the account it belongs to, and the first pick names the
 * customer when the name is still blank.
 */
export function customerFieldRenderer({
  value,
  idPrefix,
  namesCustomer = true,
}: {
  value: CustomerValue;
  idPrefix: string;
  /** A quote has a customer-facing name the first pick fills; an order does not. */
  namesCustomer?: boolean;
}) {
  const named = (fallback: string | null | undefined) =>
    namesCustomer ? { customer_name: String(value.customer_name ?? "").trim() || fallback || "" } : {};

  return function renderField(field: ResolvedRecordLayoutField, context: RecordFormFieldContext) {
    const { inputId, error, aria, disabled, set } = context;
    const common = {
      inputId,
      disabled,
      ariaDescribedBy: aria.describedBy,
      ariaInvalid: aria.invalid,
    };
    const noDeal = { opportunity_id: null, opportunity_name: "" };
    const noContact = { contact_id: null, contact_name: "" };

    if (field.field_key === "organization_id") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <LinkedRecordPicker
            {...common}
            recordType="organization"
            valueId={value.organization_id ?? null}
            displayValue={String(value.organization_name ?? "")}
            onDisplayValueChange={(organization_name) => set({ organization_id: null, organization_name, ...noContact, ...noDeal })}
            onSelect={(option) =>
              set({
                organization_id: option.id,
                organization_name: option.label,
                ...named(option.label),
                ...noContact,
                ...noDeal,
              })
            }
            onClear={() => set({ organization_id: null, organization_name: "", ...noContact, ...noDeal })}
            placeholder={field.placeholder ?? "Search accounts"}
            queryKeyPrefix={`${idPrefix}-page-account`}
          />
        </QuickCreateField>
      );
    }
    if (field.field_key === "contact_id") {
      return (
        <ContactField
          field={field}
          context={context}
          value={value}
          idPrefix={idPrefix}
          onPicked={(option) =>
            set({
              contact_id: option.id,
              contact_name: option.label,
              organization_id: option.organization_id ?? value.organization_id ?? null,
              organization_name: option.organization_name ?? value.organization_name ?? "",
              ...named(option.label),
            })
          }
          onTyped={(contact_name) => set({ contact_id: null, contact_name, ...noDeal })}
          onCleared={() => set(noContact)}
        />
      );
    }
    if (field.field_key === "opportunity_id") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <LinkedRecordPicker
            {...common}
            recordType="opportunity"
            valueId={value.opportunity_id ?? null}
            displayValue={String(value.opportunity_name ?? "")}
            onDisplayValueChange={(opportunity_name) => set({ opportunity_id: null, opportunity_name })}
            onSelect={(option) =>
              set({
                opportunity_id: option.id,
                opportunity_name: option.label,
                contact_id: option.contact_id ?? value.contact_id ?? null,
                organization_id: option.organization_id ?? value.organization_id ?? null,
                ...named(option.description?.split(" · ")[0] || option.label),
              })
            }
            onClear={() => set(noDeal)}
            placeholder={field.placeholder ?? "Search deals"}
            queryKeyPrefix={`${idPrefix}-page-deal`}
            filters={{ contactId: value.contact_id ?? null, organizationId: value.organization_id ?? null }}
          />
        </QuickCreateField>
      );
    }
    return undefined;
  };
}

/** "Ada Lovelace" → first and last name for a new contact; one word is the last name. */
function splitName(text: string) {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) return { first_name: "", last_name: parts[0] ?? "" };
  return { first_name: parts.slice(0, -1).join(" "), last_name: parts[parts.length - 1] };
}

/**
 * The contact picker, with *Create contact "…"* when the user may create contacts (13b
 * Phase 5): the new contact takes the typed name and the form's account.
 */
function ContactField({
  field,
  context,
  value,
  idPrefix,
  onPicked,
  onTyped,
  onCleared,
}: {
  field: ResolvedRecordLayoutField;
  context: RecordFormFieldContext;
  value: CustomerValue;
  idPrefix: string;
  onPicked: (option: { id: number; label: string; organization_id?: number | null; organization_name?: string | null }) => void;
  onTyped: (name: string) => void;
  onCleared: () => void;
}) {
  const { inputId, error, aria, disabled } = context;
  const { modules } = useAccessibleModules();
  const canCreate = modules.some((module) => module.name === "sales_contacts" && module.actions?.can_create);
  const [creating, setCreating] = useState<string | null>(null);
  const organizationId = value.organization_id ?? null;

  return (
    <QuickCreateField field={field} aria={aria} error={error}>
      <LinkedRecordPicker
        inputId={inputId}
        disabled={disabled}
        ariaDescribedBy={aria.describedBy}
        ariaInvalid={aria.invalid}
        recordType="contact"
        valueId={value.contact_id ?? null}
        displayValue={String(value.contact_name ?? "")}
        onDisplayValueChange={onTyped}
        onSelect={onPicked}
        onClear={onCleared}
        placeholder={field.placeholder ?? "Search contacts"}
        queryKeyPrefix={`${idPrefix}-page-contact`}
        filters={{ organizationId }}
        createOption={canCreate ? { label: (text) => `Create contact "${text}"`, onCreate: setCreating } : undefined}
      />
      {canCreate ? (
        <ContactQuickCreate
          open={creating !== null}
          onOpenChange={(open) => { if (!open) setCreating(null); }}
          embedded
          context={{
            relationshipIntent: "document_contact",
            defaults: {
              ...splitName(creating ?? ""),
              ...(organizationId ? { organization_id: organizationId, organization_name: String(value.organization_name ?? "") } : {}),
            },
          }}
          onCreated={(contactId, name) => {
            if (contactId !== null) {
              onPicked({ id: contactId, label: name, organization_id: organizationId, organization_name: value.organization_name ?? null });
            }
          }}
        />
      ) : null}
    </QuickCreateField>
  );
}
