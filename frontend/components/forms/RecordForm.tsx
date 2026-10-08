"use client";

import type { ReactNode } from "react";

import { CategorySelect } from "@/components/catalog/CategorySelect";
import LinkedRecordPicker, { type LinkedRecordType } from "@/components/crm/LinkedRecordPicker";
import RecordTagInput from "@/components/crm/RecordTagInput";
import { StateSelect } from "@/components/forms/AddressFields";
import { WarehouseSelect } from "@/components/inventory/WarehouseSelect";
import { OwnerSelect } from "@/components/forms/OwnerSelect";
import {
  LayoutDrivenQuickCreateFields,
  QuickCreateField,
  quickCreateInputType,
  type LayoutDrivenQuickCreateFieldContext,
  type LayoutFormSlots,
} from "@/components/forms/quickCreateLayout";
import type { ResolvedRecordLayoutViewport } from "@/components/forms/ResolvedRecordLayout";
import { PicklistSelect } from "@/components/picklists/PicklistSelect";
import { Input } from "@/components/ui/input";
import { SegmentedBoolean } from "@/components/ui/SegmentedControl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useBaseCurrency, useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import type {
  ResolvedRecordLayout as ResolvedRecordLayoutContract,
  ResolvedRecordLayoutField,
} from "@/hooks/useResolvedRecordLayout";

/**
 * One layout-driven form for every module and surface (13b Phase 4 slice 4e, 13a E7).
 *
 * The resolved layout says which fields, in what order, how wide, required or read-only; the
 * field's type says which control draws it. A module passes `renderField` only for what its
 * domain decides — a deal's stage, a contact picker that fills the account — and returns
 * `undefined` for everything else.
 *
 * Values are a flat record keyed by field key. A reference keeps its display name next to
 * it under `<key without _id>_name` (`organization_id` → `organization_name`,
 * `assigned_to` → `assigned_to_name`), the shape every CRM form value already has.
 */

export type RecordFormValue = Record<string, unknown>;

export type RecordFormFieldContext = LayoutDrivenQuickCreateFieldContext & {
  /** Merges a patch into the form value. */
  set: (patch: RecordFormValue) => void;
};

/** An address's state and the country whose states it lists (13b §3.6). */
const STATE_COUNTRY: Record<string, string> = {
  mailing_state: "country",
  billing_state: "billing_country",
  shipping_state: "shipping_country",
};
const COUNTRY_STATE: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_COUNTRY).map(([state, country]) => [country, state]),
);

/** Reference field types the shared picker can search. */
const LINKED_RECORD_TYPES: Record<string, LinkedRecordType> = {
  organization_reference: "organization",
  contact_reference: "contact",
  opportunity_reference: "opportunity",
  team_reference: "team",
  order_reference: "order",
};

/**
 * References to the document a new one is started from: a receipt from its purchase order, a
 * return from its delivery, a credit note from its invoice. The action that starts the
 * document sets them and the server never changes them, so the form shows them, not a
 * picker. A module whose reference is chosen (a delivery's order) passes `renderField`.
 */
const SOURCE_DOCUMENT_REFERENCES = new Set([
  "purchase_order_reference",
  "purchase_receipt_reference",
  "delivery_reference",
  "invoice_reference",
  "return_reference",
  // 13c §3.6–3.7: a vendor credit from its bill or vendor return.
  "purchase_bill_reference",
  "vendor_return_reference",
]);

/** Currency fields: a `select` of the company's currencies, the base one first by default. */
const CURRENCY_KEYS = new Set(["currency", "currency_type"]);

function CurrencySelect({
  id,
  value,
  onChange,
  disabled,
  ariaInvalid,
  ariaDescribedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}) {
  const currencies = useCompanyCurrencies(true);
  const baseCurrency = useBaseCurrency();
  const current = value || baseCurrency.data || currencies.data?.[0] || "";
  const codes = Array.from(new Set([current, ...(currencies.data ?? [])].filter(Boolean)));
  return (
    <Select value={current} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-invalid={ariaInvalid || undefined} aria-describedby={ariaDescribedBy}>
        <SelectValue placeholder="Select currency" />
      </SelectTrigger>
      <SelectContent>
        {codes.map((code) => (
          <SelectItem key={code} value={code}>
            {code}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Whether `RecordForm` has a control for this field on its own. A `select` other than a
 * currency, and a reference with no shared picker, need the module's
 * `renderField`; a preview with no module draws a placeholder for them instead.
 */
export function recordFormDraws(field: ResolvedRecordLayoutField) {
  if (field.field_source === "custom_field") return true;
  if (field.field_type === "select") return CURRENCY_KEYS.has(field.field_key);
  if (field.field_type === "picklist") return Boolean(field.picklist_key);
  if (field.field_type.endsWith("_reference")) {
    return (
      field.field_type in LINKED_RECORD_TYPES
      || field.field_type === "user_reference"
      || field.field_type === "warehouse_reference"
      || field.field_type === "category_reference"
      || SOURCE_DOCUMENT_REFERENCES.has(field.field_type)
    );
  }
  return true;
}

export function referenceNameKey(fieldKey: string) {
  return fieldKey.endsWith("_id") ? `${fieldKey.slice(0, -3)}_name` : `${fieldKey}_name`;
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

type Props<TValue extends RecordFormValue> = {
  moduleKey: string;
  layout: ResolvedRecordLayoutContract;
  value: TValue;
  onChange: (value: TValue) => void;
  customValues: Record<string, unknown>;
  onCustomChange: (fieldKey: string, value: unknown) => void;
  /** Element ids per field key; the server-error slots and tests address fields by them. */
  inputId: (fieldKey: string) => string;
  /** `create` or `edit`: what the owner picker asks permission for. */
  action?: "create" | "edit";
  errors?: Record<string, string | null | undefined>;
  /** Keys the opening record already set (a deal started from an account). Shown, not re-asked. */
  lockedFieldKeys?: readonly string[];
  viewport?: ResolvedRecordLayoutViewport;
  /** The module's own controls. Return `undefined` to let the field's type decide. */
  renderField?: (field: ResolvedRecordLayoutField, context: RecordFormFieldContext) => ReactNode | undefined;
  /** Lines, totals, section actions and fields this form leaves out (`ResolvedRecordLayout`). */
  slots?: LayoutFormSlots;
};

export function RecordForm<TValue extends RecordFormValue>({
  moduleKey,
  layout,
  value,
  onChange,
  customValues,
  onCustomChange,
  inputId,
  action = "create",
  errors = {},
  lockedFieldKeys = [],
  viewport = "auto",
  renderField,
  slots,
}: Props<TValue>) {
  const set = (patch: RecordFormValue) => {
    const next: RecordFormValue = { ...value, ...patch };
    // A new country clears its address's state: the old one may not belong to it.
    for (const [countryKey, stateKey] of Object.entries(COUNTRY_STATE)) {
      if (countryKey in patch && patch[countryKey] !== value[countryKey] && !(stateKey in patch) && stateKey in value) {
        next[stateKey] = "";
      }
    }
    onChange(next as TValue);
  };

  function renderSystemField(field: ResolvedRecordLayoutField, base: LayoutDrivenQuickCreateFieldContext) {
    const context: RecordFormFieldContext = { ...base, set };
    const custom = renderField?.(field, context);
    if (custom !== undefined) return custom;
    const control = defaultControl(field, context);
    if (control === null) return null;
    return (
      <QuickCreateField field={field} aria={base.aria} error={base.error}>
        {control}
      </QuickCreateField>
    );
  }

  function defaultControl(field: ResolvedRecordLayoutField, context: RecordFormFieldContext): ReactNode {
    const { inputId: id, aria, disabled } = context;
    const key = field.field_key;
    const ariaProps = { "aria-invalid": aria.invalid || undefined, "aria-describedby": aria.describedBy };

    if (field.field_type === "select" && CURRENCY_KEYS.has(key)) {
      return (
        <CurrencySelect
          id={id}
          value={text(value[key])}
          onChange={(next) => set({ [key]: next })}
          disabled={disabled}
          ariaInvalid={aria.invalid}
          ariaDescribedBy={aria.describedBy}
        />
      );
    }

    if (key in STATE_COUNTRY) {
      return (
        <StateSelect
          id={id}
          label={field.label}
          country={text(value[STATE_COUNTRY[key]])}
          value={text(value[key])}
          onChange={(next) => set({ [key]: next })}
          disabled={disabled}
          ariaInvalid={aria.invalid}
          ariaDescribedBy={aria.describedBy}
        />
      );
    }

    switch (field.field_type) {
      case "picklist":
        if (!field.picklist_key) return null;
        return (
          <PicklistSelect
            id={id}
            listKey={field.picklist_key}
            label={field.label}
            value={text(value[key])}
            onChange={(next) => set({ [key]: next })}
            required={field.required}
            disabled={disabled}
            ariaInvalid={aria.invalid}
            ariaDescribedBy={aria.describedBy}
            allowedKeys={context.allowedKeys}
          />
        );
      case "user_reference": {
        const nameKey = referenceNameKey(key);
        return (
          <OwnerSelect
            id={id}
            label={field.label}
            moduleKey={moduleKey}
            action={action}
            ownerId={(value[key] as number | null | undefined) ?? null}
            ownerName={text(value[nameKey])}
            onChange={(ownerId, ownerName) => set({ [key]: ownerId, [nameKey]: ownerName })}
            disabled={disabled}
            required={field.required}
            placeholder={field.placeholder}
            ariaDescribedBy={aria.describedBy}
            ariaInvalid={aria.invalid}
          />
        );
      }
      case "tags":
        return (
          <RecordTagInput
            inputId={id}
            value={Array.isArray(value[key]) ? (value[key] as string[]) : []}
            onChange={(tags) => set({ [key]: tags })}
            moduleKey={moduleKey}
            action={action}
            disabled={disabled}
            ariaDescribedBy={aria.describedBy}
            ariaInvalid={aria.invalid}
          />
        );
      case "boolean":
        return (
          <SegmentedBoolean
            aria-label={field.label}
            value={value[key] === true}
            onValueChange={(next) => set({ [key]: next })}
            trueLabel="Yes"
            falseLabel="No"
            disabled={disabled}
          />
        );
      case "long_text":
        return (
          <Textarea
            id={id}
            rows={3}
            value={text(value[key])}
            placeholder={field.placeholder ?? ""}
            required={field.required}
            disabled={disabled}
            onChange={(event) => set({ [key]: event.target.value })}
            {...ariaProps}
          />
        );
      case "warehouse_reference": {
        const nameKey = referenceNameKey(key);
        return (
          <WarehouseSelect
            id={id}
            value={(value[key] as number | null | undefined) ?? null}
            name={text(value[nameKey]) || null}
            onChange={(warehouseId, name) => set({ [key]: warehouseId, [nameKey]: name })}
            // Where stock goes (a transfer's `to_warehouse_id`) is chosen, never assumed.
            emptyMeansDefault={!key.startsWith("to_")}
            disabled={disabled}
            ariaInvalid={aria.invalid}
            ariaDescribedBy={aria.describedBy}
          />
        );
      }
      case "category_reference": {
        const nameKey = referenceNameKey(key);
        return (
          <CategorySelect
            id={id}
            label={field.label}
            value={(value[key] as number | null | undefined) ?? null}
            onChange={(categoryId, name) => set({ [key]: categoryId, [nameKey]: name })}
            disabled={disabled}
          />
        );
      }
      default:
        break;
    }

    if (SOURCE_DOCUMENT_REFERENCES.has(field.field_type)) {
      if (value[key] === null || value[key] === undefined) return null;
      return <Input id={id} value={text(value[referenceNameKey(key)])} readOnly disabled {...ariaProps} />;
    }

    const recordType = LINKED_RECORD_TYPES[field.field_type];
    if (recordType) {
      const nameKey = referenceNameKey(key);
      return (
        <LinkedRecordPicker
          inputId={id}
          recordType={recordType}
          valueId={(value[key] as number | null | undefined) ?? null}
          displayValue={text(value[nameKey])}
          onDisplayValueChange={(name) => set({ [key]: null, [nameKey]: name })}
          onSelect={(option) => set({ [key]: option.id, [nameKey]: option.label })}
          onClear={() => set({ [key]: null, [nameKey]: "" })}
          placeholder={field.placeholder ?? `Search ${field.label.toLowerCase()}`}
          disabled={disabled}
          queryKeyPrefix={`record-form-${moduleKey}-${key}`}
          noResultsText={`No ${field.label.toLowerCase()} matched this search.`}
          sourceModuleKey={moduleKey}
          sourceAction={action}
          ariaDescribedBy={aria.describedBy}
          ariaInvalid={aria.invalid}
        />
      );
    }

    // A reference with no picker yet, or a `select` only the module can fill: nothing generic
    // would be honest, so the module must draw it (or the layout leaves it out).
    if (field.field_type === "select" || field.field_type.endsWith("_reference")) return null;

    const inputType = quickCreateInputType(field.field_type);
    return (
      <Input
        id={id}
        type={inputType}
        inputMode={inputType === "number" ? "decimal" : undefined}
        step={inputType === "number" ? "any" : undefined}
        required={field.required}
        disabled={disabled}
        value={text(value[key])}
        placeholder={field.placeholder ?? ""}
        onChange={(event) => set({ [key]: event.target.value })}
        {...ariaProps}
      />
    );
  }

  return (
    <LayoutDrivenQuickCreateFields
      moduleKey={moduleKey}
      layout={layout}
      inputId={inputId}
      customValues={customValues}
      onCustomChange={onCustomChange}
      errors={errors}
      lockedFieldKeys={lockedFieldKeys}
      viewport={viewport}
      systemValues={value}
      renderSystemField={renderSystemField}
      slots={slots}
    />
  );
}
