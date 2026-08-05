"use client";

import type { ReactNode } from "react";
import { Filter, SearchX, X } from "lucide-react";

import SearchBar from "@/components/ui/SearchBar";
import { Button } from "@/components/ui/button";
import { TableDensityToggle } from "@/components/ui/TableDensityToggle";

type Props = {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filtersOpen: boolean;
  activeFilterCount: number;
  onToggleFilters: () => void;
  onClearFilters: () => void;
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
  filtersOpen,
  activeFilterCount,
  onToggleFilters,
  onClearFilters,
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
          <Button type="button" variant="outline" size="sm" onClick={onToggleFilters} aria-expanded={filtersOpen}>
            <Filter />Filters
            {activeFilterCount ? <span className="rounded-full bg-action-primary-muted px-1.5 py-0.5 text-[10px] font-semibold text-copy-primary">{activeFilterCount}</span> : null}
          </Button>
          {activeFilterCount ? <Button type="button" variant="ghost" size="sm" onClick={onClearFilters}><SearchX />Clear filters</Button> : null}
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
