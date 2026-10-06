"use client";

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { SegmentedBoolean, SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Textarea } from "@/components/ui/textarea";
import { usePicklists } from "@/hooks/usePicklists";
import {
  canBeUnique,
  FIELD_TYPE_KEYS,
  FIELD_TYPE_LABELS,
  fieldTypeKey,
  isNumberType,
  LOOKUP_TARGETS,
} from "@/lib/fieldTypes";

/** What a new field's type needs beyond its label (13b §3.4). */
export type FieldTypeDraft = {
  field_type: string;
  list_source: "existing" | "new";
  picklist_key: string;
  picklist_values: string;
  lookup_module_key: string;
  min: string;
  max: string;
  precision: string;
  max_length: string;
  prefix: string;
  is_unique: boolean;
};

export const EMPTY_FIELD_TYPE_DRAFT: FieldTypeDraft = {
  field_type: "text",
  list_source: "new",
  picklist_key: "",
  picklist_values: "",
  lookup_module_key: "sales_organizations",
  min: "",
  max: "",
  precision: "",
  max_length: "",
  prefix: "",
  is_unique: false,
};

/** The create request's type fields: `field_type`, list or values, lookup target, `config`. */
export function fieldTypePayload(draft: FieldTypeDraft) {
  const type = fieldTypeKey(draft.field_type);
  const config: Record<string, unknown> = {};
  const number = (value: string) => (value.trim() === "" ? undefined : Number(value));
  if (isNumberType(type)) {
    if (number(draft.min) !== undefined) config.min = number(draft.min);
    if (number(draft.max) !== undefined) config.max = number(draft.max);
    if (type === "decimal" && number(draft.precision) !== undefined) config.precision = number(draft.precision);
  }
  if ((type === "text" || type === "long_text") && number(draft.max_length) !== undefined) config.max_length = number(draft.max_length);
  if (type === "auto_number" && draft.prefix.trim()) config.prefix = draft.prefix.trim().toUpperCase();
  const isList = type === "picklist" || type === "multi_picklist";
  return {
    field_type: type,
    picklist_key: isList && draft.list_source === "existing" ? draft.picklist_key || null : null,
    picklist_values: isList && draft.list_source === "new"
      ? draft.picklist_values.split("\n").map((line) => line.trim()).filter(Boolean)
      : null,
    lookup_module_key: type === "lookup" ? draft.lookup_module_key : null,
    config: Object.keys(config).length ? config : null,
    is_unique: canBeUnique(type) ? draft.is_unique : false,
  };
}

/** A sentence naming what is missing, or null when the draft can be sent. */
export function fieldTypeDraftProblem(draft: FieldTypeDraft): string | null {
  const type = fieldTypeKey(draft.field_type);
  if (type === "picklist" || type === "multi_picklist") {
    if (draft.list_source === "existing" && !draft.picklist_key) return "Choose the list this field uses.";
    if (draft.list_source === "new" && !draft.picklist_values.trim()) return "Enter the list's values, one per line.";
  }
  return null;
}

type Props = {
  idPrefix: string;
  value: FieldTypeDraft;
  onChange: (value: FieldTypeDraft) => void;
  disabled?: boolean;
};

/** The type of a new field and the settings that type takes. A field's type never changes. */
export function FieldTypeSettings({ idPrefix, value, onChange, disabled }: Props) {
  const { data: lists } = usePicklists();
  const type = fieldTypeKey(value.field_type);
  const update = (change: Partial<FieldTypeDraft>) => onChange({ ...value, ...change });
  const listOptions = (lists ?? []).filter((list) => !list.is_locked).map((list) => ({ value: list.key, label: list.label }));

  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-type`}>Field type</FieldLabel>
        <SearchableSelect
          id={`${idPrefix}-type`}
          label="Field type"
          value={type}
          options={FIELD_TYPE_KEYS.map((key) => ({ value: key, label: FIELD_TYPE_LABELS[key] }))}
          onValueChange={(field_type) => update({ field_type })}
          disabled={disabled}
        />
        <FieldDescription>A field&rsquo;s type cannot change once it is created.</FieldDescription>
      </Field>

      {type === "picklist" || type === "multi_picklist" ? (
        <>
          <Field>
            <FieldLabel>Values from</FieldLabel>
            <SegmentedControl aria-label="Values from" size="default" value={value.list_source} onValueChange={(list_source) => update({ list_source })}>
              <SegmentedItem value="new" disabled={disabled}>Its own list</SegmentedItem>
              <SegmentedItem value="existing" disabled={disabled}>A shared list</SegmentedItem>
            </SegmentedControl>
          </Field>
          {value.list_source === "existing" ? (
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-list`}>List</FieldLabel>
              <SearchableSelect id={`${idPrefix}-list`} label="List" value={value.picklist_key} options={listOptions}
                onValueChange={(picklist_key) => update({ picklist_key })} placeholder="Choose a list" disabled={disabled} />
              <FieldDescription>Manage lists under Settings → Picklists.</FieldDescription>
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-values`}>Values</FieldLabel>
              <Textarea id={`${idPrefix}-values`} rows={4} value={value.picklist_values} disabled={disabled}
                onChange={(event) => update({ picklist_values: event.target.value })} aria-describedby={`${idPrefix}-values-help`} />
              <FieldDescription id={`${idPrefix}-values-help`}>One per line. They become this field&rsquo;s own picklist.</FieldDescription>
            </Field>
          )}
        </>
      ) : null}

      {type === "lookup" ? (
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-lookup`}>Links to</FieldLabel>
          <SearchableSelect id={`${idPrefix}-lookup`} label="Links to" value={value.lookup_module_key}
            options={Object.entries(LOOKUP_TARGETS).map(([key, target]) => ({ value: key, label: target.label }))}
            onValueChange={(lookup_module_key) => update({ lookup_module_key })} disabled={disabled} />
        </Field>
      ) : null}

      {isNumberType(type) ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-min`}>Lowest value</FieldLabel>
            <Input id={`${idPrefix}-min`} type="number" value={value.min} onChange={(event) => update({ min: event.target.value })} disabled={disabled} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-max`}>Highest value</FieldLabel>
            <Input id={`${idPrefix}-max`} type="number" value={value.max} onChange={(event) => update({ max: event.target.value })} disabled={disabled} />
          </Field>
          {type === "decimal" ? (
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-precision`}>Decimal places</FieldLabel>
              <Input id={`${idPrefix}-precision`} type="number" min={0} max={8} value={value.precision} onChange={(event) => update({ precision: event.target.value })} disabled={disabled} />
            </Field>
          ) : null}
        </div>
      ) : null}

      {type === "text" || type === "long_text" ? (
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-max-length`}>Longest value</FieldLabel>
          <Input id={`${idPrefix}-max-length`} type="number" min={1} value={value.max_length} onChange={(event) => update({ max_length: event.target.value })}
            disabled={disabled} aria-describedby={`${idPrefix}-max-length-help`} />
          <FieldDescription id={`${idPrefix}-max-length-help`}>In characters. Leave empty for no limit.</FieldDescription>
        </Field>
      ) : null}

      {type === "auto_number" ? (
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-prefix`}>Prefix</FieldLabel>
          <Input id={`${idPrefix}-prefix`} maxLength={20} value={value.prefix} onChange={(event) => update({ prefix: event.target.value })}
            disabled={disabled} aria-describedby={`${idPrefix}-prefix-help`} />
          <FieldDescription id={`${idPrefix}-prefix-help`}>Each new record gets the next number, such as PRE-20261006-0001.</FieldDescription>
        </Field>
      ) : null}

      {canBeUnique(type) ? (
        <Field>
          <FieldLabel>Values</FieldLabel>
          <SegmentedBoolean aria-label="Unique values" value={value.is_unique} onValueChange={(is_unique) => update({ is_unique })}
            trueLabel="Unique" falseLabel="Can repeat" disabled={disabled} />
          <FieldDescription>A unique field refuses a value another record already has.</FieldDescription>
        </Field>
      ) : null}
    </>
  );
}
