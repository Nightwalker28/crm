"use client";

import { useMemo } from "react";

import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/SearchableSelect";
import { useTaxRates, type TaxRate } from "@/hooks/finance/useTaxRates";

const NONE = "none";

function rateOptions(rates: TaxRate[], value: number | null): SearchableSelectOption[] {
  // Inactive rates are offered only where they are already chosen.
  return rates
    .filter((rate) => rate.is_active || rate.id === value)
    .map((rate) => ({
      value: String(rate.id),
      label: rate.is_active ? rate.name : `${rate.name} (inactive)`,
      description: rate.kind === "group" ? rate.members.map((member) => member.name).join(" + ") : undefined,
    }));
}

/**
 * A product's or service's default tax rate (`tax_rate_reference`, 13d §3.1). Blank means the
 * company's default applies.
 */
export function TaxRateSelect({
  id,
  label,
  value,
  onChange,
  disabled,
  emptyLabel = "Company default",
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (rateId: number | null, name: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const rates = useTaxRates();
  const options = useMemo(
    () => [{ value: NONE, label: emptyLabel }, ...rateOptions(rates.data ?? [], value)],
    [rates.data, value, emptyLabel],
  );
  return (
    <SearchableSelect
      id={id}
      label={label}
      value={value === null ? NONE : String(value)}
      options={options}
      onValueChange={(next) => {
        if (next === NONE) onChange(null, "");
        else onChange(Number(next), options.find((option) => option.value === next)?.label ?? "");
      }}
      emptyMessage="No tax rate matches that search."
      disabled={disabled}
    />
  );
}

/** A line's tax: a rate, the automatic rate, no tax, or a typed amount. */
export type LineTaxChoice = {
  tax_rate_id: number | null;
  tax_manual: boolean;
  tax_amount: string;
  /** The editor's own flag: *Custom amount* chosen, even while the amount is still 0. */
  tax_custom?: boolean;
};

export const AUTO_TAX = "auto";
export const NO_TAX = "none";
export const CUSTOM_TAX = "custom";

export function lineTaxValue(choice: LineTaxChoice): string {
  if (choice.tax_manual) return !choice.tax_custom && Number(choice.tax_amount || 0) === 0 && !choice.tax_rate_id ? NO_TAX : CUSTOM_TAX;
  return choice.tax_rate_id ? String(choice.tax_rate_id) : AUTO_TAX;
}

/** The tax cell of a document line (13d §3.1). *Automatic* lets the server pick: the item's
 * rate, none for an exempt account, else the company default. */
export function LineTaxSelect({
  value,
  onChange,
  ariaLabel,
  autoLabel,
  disabled,
}: {
  value: LineTaxChoice;
  onChange: (next: Pick<LineTaxChoice, "tax_rate_id" | "tax_manual" | "tax_custom"> & { tax_amount?: string }) => void;
  ariaLabel: string;
  /** What *Automatic* resolves to here, e.g. "Automatic (VAT 20%)". */
  autoLabel: string;
  disabled?: boolean;
}) {
  const rates = useTaxRates();
  const options = useMemo<SearchableSelectOption[]>(
    () => [
      { value: AUTO_TAX, label: autoLabel },
      ...rateOptions(rates.data ?? [], value.tax_rate_id),
      { value: NO_TAX, label: "No tax" },
      { value: CUSTOM_TAX, label: "Custom amount" },
    ],
    [rates.data, value.tax_rate_id, autoLabel],
  );
  return (
    <SearchableSelect
      label={ariaLabel}
      value={lineTaxValue(value)}
      options={options}
      size="sm"
      disabled={disabled}
      emptyMessage="No tax rate matches that search."
      onValueChange={(next) => {
        if (next === AUTO_TAX) onChange({ tax_rate_id: null, tax_manual: false, tax_custom: false });
        else if (next === NO_TAX) onChange({ tax_rate_id: null, tax_manual: true, tax_custom: false, tax_amount: "0" });
        else if (next === CUSTOM_TAX) onChange({ tax_rate_id: value.tax_rate_id, tax_manual: true, tax_custom: true });
        else onChange({ tax_rate_id: Number(next), tax_manual: false, tax_custom: false });
      }}
    />
  );
}
