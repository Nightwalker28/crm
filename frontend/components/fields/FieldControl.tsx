"use client";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { PicklistMultiSelect } from "@/components/picklists/MultiOptionSelect";
import { PicklistSelect } from "@/components/picklists/PicklistSelect";
import { Input } from "@/components/ui/input";
import { SegmentedBoolean } from "@/components/ui/SegmentedControl";
import { Textarea } from "@/components/ui/textarea";
import { fieldTypeKey, LOOKUP_TARGETS, referenceId, referenceLabel, type FieldShape } from "@/lib/fieldTypes";

export type FieldControlProps = {
  field: FieldShape;
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
  /** The module the record belongs to, for the people a user field may offer. */
  moduleKey?: string;
  disabled?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  /** A dependent picklist's allowed keys (13b §3.6); `null` or absent offers the whole list. */
  allowedKeys?: string[] | null;
};

const INPUT_TYPES: Record<string, string> = {
  number: "number",
  decimal: "number",
  currency: "number",
  percent: "number",
  date: "date",
  datetime: "datetime-local",
  email: "email",
  phone: "tel",
  url: "url",
};

function textValue(value: unknown, type: string): string {
  if (value == null) return "";
  if (type === "datetime" && typeof value === "string") return value.slice(0, 16);
  return String(value);
}

/**
 * The input for one field of the one field system (13b §3.4), by its type. The caller owns
 * the label, help and error slot; this is only the control, so a quick create, a full form
 * and a custom module record page draw the same thing.
 */
export function FieldControl({ field, id, value, onChange, moduleKey, disabled, ariaInvalid, ariaDescribedBy, allowedKeys }: FieldControlProps) {
  const type = fieldTypeKey(field.field_type);
  const aria = { "aria-invalid": ariaInvalid || undefined, "aria-describedby": ariaDescribedBy };

  if (type === "auto_number") {
    return (
      <p id={id} className="text-sm text-copy-secondary">
        {value ? String(value) : "Assigned when the record is saved"}
      </p>
    );
  }
  if (type === "long_text") {
    return (
      <Textarea id={id} rows={3} value={textValue(value, type)} onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder ?? ""} required={field.is_required} disabled={disabled} {...aria} />
    );
  }
  if (type === "boolean") {
    return (
      <SegmentedBoolean aria-label={field.label} value={value === true} onValueChange={onChange} trueLabel="Yes" falseLabel="No" disabled={disabled} />
    );
  }
  if (type === "picklist" && field.picklist_key) {
    return (
      <PicklistSelect id={id} listKey={field.picklist_key} label={field.label} value={typeof value === "string" ? value : ""}
        onChange={onChange} required={field.is_required} disabled={disabled} ariaInvalid={ariaInvalid} ariaDescribedBy={ariaDescribedBy}
        allowedKeys={allowedKeys} />
    );
  }
  if (type === "multi_picklist" && field.picklist_key) {
    return (
      <PicklistMultiSelect id={id} listKey={field.picklist_key} label={field.label} values={Array.isArray(value) ? value.map(String) : []}
        onChange={onChange} disabled={disabled} ariaInvalid={ariaInvalid} ariaDescribedBy={ariaDescribedBy} allowedKeys={allowedKeys} />
    );
  }
  if (type === "user" || type === "lookup" || type === "file") {
    const recordType = type === "user" ? "user" : type === "file" ? "document" : LOOKUP_TARGETS[field.lookup_module_key ?? ""]?.recordType;
    if (!recordType) return <p className="text-sm text-copy-muted">This lookup points at a module it cannot search.</p>;
    const currentId = referenceId(value);
    return (
      <LinkedRecordPicker
        inputId={id}
        recordType={recordType}
        valueId={currentId}
        displayValue={referenceLabel(value) || (currentId ? `#${currentId}` : "")}
        onDisplayValueChange={() => undefined}
        onSelect={(option) => onChange({ id: Number(option.id), label: option.label })}
        onClear={() => onChange(null)}
        placeholder={field.placeholder ?? `Search ${field.label.toLowerCase()}`}
        disabled={disabled}
        queryKeyPrefix={`field-${field.field_key}`}
        sourceModuleKey={moduleKey}
        ariaInvalid={ariaInvalid}
        ariaDescribedBy={ariaDescribedBy}
        clearLabel={`Clear ${field.label}`}
      />
    );
  }
  return (
    <Input
      id={id}
      type={INPUT_TYPES[type] ?? "text"}
      step={type === "number" ? "1" : type === "currency" ? "0.01" : INPUT_TYPES[type] === "number" ? "any" : undefined}
      inputMode={INPUT_TYPES[type] === "number" ? "decimal" : undefined}
      value={textValue(value, type)}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.placeholder ?? ""}
      required={field.is_required}
      disabled={disabled}
      {...aria}
    />
  );
}
