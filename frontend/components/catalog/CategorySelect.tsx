"use client";

import { useMemo } from "react";

import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useCatalogCategories } from "@/hooks/catalog/useCatalogCategories";

const NO_CATEGORY = "none";

/** A product's or service's category (`category_reference`), searchable by its full path. */
export function CategorySelect({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (categoryId: number | null, name: string) => void;
  disabled?: boolean;
}) {
  const categories = useCatalogCategories();
  const options = useMemo(
    () => [
      { value: NO_CATEGORY, label: "No category" },
      ...(categories.data ?? []).map((category) => ({ value: String(category.id), label: category.full_name })),
    ],
    [categories.data],
  );
  return (
    <SearchableSelect
      id={id}
      label={label}
      value={value === null ? NO_CATEGORY : String(value)}
      options={options}
      onValueChange={(next) => {
        if (next === NO_CATEGORY) onChange(null, "");
        else onChange(Number(next), options.find((option) => option.value === next)?.label ?? "");
      }}
      emptyMessage="No category matches that search."
      disabled={disabled}
    />
  );
}
