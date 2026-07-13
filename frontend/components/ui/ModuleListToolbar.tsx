"use client";

import type { ReactNode } from "react";
import { Filter, SearchX, X } from "lucide-react";

import SearchBar from "@/components/ui/SearchBar";
import { Button } from "@/components/ui/button";

type Props = {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filtersOpen: boolean;
  activeFilterCount: number;
  onToggleFilters: () => void;
  onClearFilters: () => void;
  selectedCount?: number;
  onClearSelection?: () => void;
  viewControls?: ReactNode;
  actionControls?: ReactNode;
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
  onClearSelection,
  viewControls,
  actionControls,
}: Props) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line-default bg-surface px-3 py-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <SearchBar value={searchValue} onChange={onSearchChange} placeholder={searchPlaceholder} className="md:w-80" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {viewControls}
          <Button type="button" variant="outline" size="sm" onClick={onToggleFilters} aria-expanded={filtersOpen}>
            <Filter />Filters
            {activeFilterCount ? <span className="rounded-full bg-action-primary-muted px-1.5 py-0.5 text-[10px] font-semibold text-copy-primary">{activeFilterCount}</span> : null}
          </Button>
          {activeFilterCount ? <Button type="button" variant="ghost" size="sm" onClick={onClearFilters}><SearchX />Clear filters</Button> : null}
          <div className="ml-auto flex items-center gap-2">{actionControls}</div>
        </div>
      </div>

      {selectedCount ? (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line-subtle pt-3">
          <span className="text-sm font-medium text-copy-primary">{selectedCount} lead{selectedCount === 1 ? "" : "s"} selected</span>
          {onClearSelection ? <Button type="button" variant="ghost" size="sm" onClick={onClearSelection}><X />Clear selection</Button> : null}
        </div>
      ) : null}
    </div>
  );
}
