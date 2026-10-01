"use client";

import { useMemo } from "react";

import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { getTimezoneOptions } from "@/lib/timezones";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  triggerId?: string;
  ariaLabel?: string;
};

/**
 * The IANA zone list, as a `SearchableSelect`.
 *
 * This file used to be the whole combobox — `Popover` + a `Search` input + a filtered list +
 * a `Check` — and so did `UserTeamPicker` and `LinkedRecordPicker`, three times over,
 * independently (§7.8). What is left here is the part that is actually about timezones: the
 * option mapping and the copy. It passes no `searchable` flag; the list is 400-odd zones and
 * the primitive counts them.
 *
 * The old cap is gone with it. This rendered `options.slice(0, 100)` at every query,
 * including the empty one, so an operator who scrolled without typing reached the end of a
 * list that was not the end — §7.9's failure mode, at a smaller scale.
 */
export default function TimezonePicker({
  value,
  onChange,
  placeholder = "Search country or city",
  triggerId,
  ariaLabel = "Timezone",
}: Props) {
  const options = useMemo(
    () =>
      getTimezoneOptions().map((option) => ({
        value: option.value,
        label: option.label,
        // The IANA id is worth showing, not just matching: two zones can share a city label.
        description: option.value,
      })),
    [],
  );

  return (
    <SearchableSelect
      id={triggerId}
      label={ariaLabel}
      value={value}
      options={options}
      onValueChange={onChange}
      placeholder={placeholder}
      searchPlaceholder={placeholder}
      emptyMessage="No timezone matched that search."
      className="w-full font-normal"
    />
  );
}
