"use client";

import { RemovableChip } from "@/components/ui/RemovableChip";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/SearchableSelect";
import { picklistOptions, usePicklist } from "@/hooks/usePicklists";

type MultiOptionSelectProps = {
  /** The control's accessible name. */
  label: string;
  options: SearchableSelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  id?: string;
  disabled?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
};

/**
 * Several values from one list: a search to add the next, each chosen value a removable
 * chip (the `RemovableChip` case §1.3 names — a box earned by its remove control).
 */
export function MultiOptionSelect({ label, options, values, onChange, id, disabled, ariaInvalid, ariaDescribedBy }: MultiOptionSelectProps) {
  const labels = new Map(options.map((option) => [option.value, option.label]));
  const remaining = options.filter((option) => !values.includes(option.value));
  return (
    <div className="space-y-2">
      <SearchableSelect
        id={id}
        label={label}
        value=""
        options={remaining}
        disabled={disabled}
        ariaInvalid={ariaInvalid}
        ariaDescribedBy={ariaDescribedBy}
        placeholder={values.length ? "Add another value" : "Choose values"}
        onValueChange={(value) => onChange([...values, value])}
      />
      {values.length ? (
        <div className="flex flex-wrap gap-1">
          {values.map((value) => (
            <RemovableChip
              key={value}
              label={labels.get(value) ?? value}
              removeLabel={`Remove ${labels.get(value) ?? value}`}
              disabled={disabled}
              onRemove={() => onChange(values.filter((item) => item !== value))}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A multi-select picklist field: the list's active values, plus any the record still holds. */
export function PicklistMultiSelect({ listKey, values, ...rest }: Omit<MultiOptionSelectProps, "options"> & { listKey: string }) {
  const { picklist } = usePicklist(listKey);
  const options = picklist
    ? picklist.values
        .filter((value) => value.is_active || values.includes(value.key))
        .map((value) => ({ value: value.key, label: value.is_active ? value.label : `${value.label} (no longer used)` }))
    : picklistOptions(null);
  return <MultiOptionSelect options={options} values={values} {...rest} />;
}
