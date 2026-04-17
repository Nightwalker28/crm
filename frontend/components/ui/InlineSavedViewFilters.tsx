"use client";

import { Filter, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { SavedViewConditionEditor, getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import type { ModuleFilterField } from "@/lib/moduleViewConfigs";

type Props = {
  filterFields: ModuleFilterField[];
  filters: SavedViewFilters;
  onChange: (next: SavedViewFilters) => void;
};

export function InlineSavedViewFilters({ filterFields, filters, onChange }: Props) {
  const isOpen = Boolean(filters.filtersOpen);
  const { allConditions, anyConditions } = getConditionGroups(filters);
  const activeCount = allConditions.length + anyConditions.length;

  return (
    <div className="flex flex-col gap-4 text-neutral-200">
      <Card className="px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Quick Filters</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Apply reusable AND/OR conditions directly from this module page.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange({ ...filters, filtersOpen: !isOpen })}
            >
              <Filter className="h-4 w-4" />
              {isOpen ? "Hide Filters" : "Show Filters"}
              {activeCount > 0 ? (
                <span className="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-neutral-200 px-1 text-[9px] font-bold text-neutral-950">
                  {activeCount}
                </span>
              ) : null}
            </Button>

            {activeCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange({
                    ...filters,
                    all_conditions: [],
                    any_conditions: [],
                    conditions: [],
                  })
                }
              >
                <SearchX className="h-4 w-4" />
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {isOpen ? (
        <SavedViewConditionEditor
          filterFields={filterFields}
          filters={filters}
          onChange={onChange}
          title="Filter Conditions"
          description="Use both groups together when needed: AND conditions must all pass, OR conditions allow any match."
        />
      ) : null}
    </div>
  );
}
