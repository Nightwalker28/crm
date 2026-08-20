"use client";

import type { ReactNode } from "react";
import { Filter, SearchX, X } from "lucide-react";

import SearchBar from "@/components/ui/SearchBar";
import { Button } from "@/components/ui/button";
import { ColumnPicker } from "@/components/ui/ColumnPicker";
import { TableDensityToggle } from "@/components/ui/TableDensityToggle";
import type { TableColumnOption } from "@/types/table";

type Props = {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  /**
   * The filter group is optional, and a module whose request layer cannot carry conditions
   * passes none of it — no `Filters` button, no badge, no `Clear filters` (7.9). Custom
   * modules are the case: `useCustomModuleRecords` serialises search and sort only, so the
   * badge used to count conditions the backend never received and the table returned every
   * row anyway.
   */
  filtersOpen?: boolean;
  activeFilterCount?: number;
  onToggleFilters?: () => void;
  onClearFilters?: () => void;
  /**
   * A2 — column visibility. `ColumnPicker` existed and was wired into **1 of 16** pages,
   * so hiding a column cost 6+ clicks through the saved-view editor and left the operator
   * owning a view they did not want. It belongs here because archetype 1 draws it here
   * (design.md §4.7), and because a page that has to assemble a nine-line block for it is
   * a page that will not.
   *
   * It is drawn only when there is something to pick — a list whose definition has not
   * loaded yet gets no dead control (§7.9).
   */
  columnOptions?: TableColumnOption[];
  visibleColumns?: string[];
  onVisibleColumnsChange?: (visibleColumns: string[]) => void;
  selectedCount?: number;
  selectionNoun?: string;
  onClearSelection?: () => void;
  viewControls?: ReactNode;
  actionControls?: ReactNode;
  primaryAction?: ReactNode;
};

export function ModuleListToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  filtersOpen = false,
  activeFilterCount = 0,
  onToggleFilters,
  onClearFilters,
  columnOptions,
  visibleColumns,
  onVisibleColumnsChange,
  selectedCount = 0,
  selectionNoun = "record",
  onClearSelection,
  viewControls,
  actionControls,
  primaryAction,
}: Props) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line-default bg-surface">
      {viewControls ? (
        <div className="border-b border-line-subtle px-2 py-1.5">
          {viewControls}
        </div>
      ) : null}
      <div className="flex flex-col gap-3 px-3 py-2.5 xl:flex-row xl:items-center">
        <SearchBar value={searchValue} onChange={onSearchChange} placeholder={searchPlaceholder} className="md:w-80" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {onToggleFilters ? (
            <Button type="button" variant="outline" size="sm" onClick={onToggleFilters} aria-expanded={filtersOpen}>
              <Filter />Filters
              {activeFilterCount ? <span className="rounded-full bg-action-primary-muted px-1.5 py-0.5 text-2xs font-semibold text-copy-primary">{activeFilterCount}</span> : null}
            </Button>
          ) : null}
          {activeFilterCount && onClearFilters ? <Button type="button" variant="ghost" size="sm" onClick={onClearFilters}><SearchX />Clear filters</Button> : null}
          {columnOptions?.length && visibleColumns && onVisibleColumnsChange ? (
            <ColumnPicker options={columnOptions} visibleColumns={visibleColumns} onChange={onVisibleColumnsChange} />
          ) : null}
          <TableDensityToggle />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{actionControls}{primaryAction}</div>
        </div>
      </div>

      {selectedCount ? (
        <div className="flex items-center justify-between gap-3 border-t border-line-subtle bg-action-primary-muted px-3 py-2.5">
          <span className="text-sm font-medium text-copy-primary">{selectedCount} {selectionNoun}{selectedCount === 1 ? "" : "s"} selected</span>
          {onClearSelection ? <Button type="button" variant="ghost" size="sm" onClick={onClearSelection}><X />Clear selection</Button> : null}
        </div>
      ) : null}
    </div>
  );
}
