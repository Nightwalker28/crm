"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import SearchBar from "@/components/ui/SearchBar";
import { Button } from "@/components/ui/button";
import { Filter, SearchX } from "lucide-react";
import { Card } from "../ui/Card";
import { Spinner } from "../ui/spinner";

type FilterChipProps = {
  label: string;
  active: boolean;
  onClick: () => void;
};

function FilterChip({ label, active, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        relative flex items-center justify-center rounded-[var(--radius-control)] border px-3 py-1.5 text-sm font-medium transition-colors motion-reduce:transition-none
        ${
          active
            ? "border-action-primary bg-action-primary-muted text-copy-primary shadow-sm"
            : "border-line-default bg-surface-muted text-copy-muted hover:border-line-strong hover:text-copy-primary"
        }
      `}
    >
      {label}
    </button>
  );
}

export type UserFiltersValue = {
  search: string;
  filtersOpen: boolean;
  selectedTeams: string[];
  selectedRoles: string[];
  selectedStatuses: string[];
};

export type UserFiltersOptions = {
  totalCount: number;
  allTeams: string[];
  allRoles: string[];
  allStatuses: string[];
};

type Props = {
  value: UserFiltersValue;
  options: UserFiltersOptions;
  isLoading?: boolean; // Added isLoading prop
  onChange: (next: UserFiltersValue) => void;
  onClear: () => void;
};

export default function UserFilters({
  value,
  options,
  isLoading = false,
  onChange,
  onClear,
}: Props) {
  const hasActiveFilters = useMemo(() => {
    return (
      value.search.trim().length > 0 ||
      value.selectedTeams.length > 0 ||
      value.selectedRoles.length > 0 ||
      value.selectedStatuses.length > 0
    );
  }, [
    value.search,
    value.selectedRoles,
    value.selectedStatuses,
    value.selectedTeams,
  ]);

  const activeCount =
    value.selectedTeams.length +
    value.selectedRoles.length +
    value.selectedStatuses.length;

  return (
    <div className="flex flex-col gap-4 text-copy-primary">
      {/* Main Control Bar */}
      <Card className="px-4 py-1.5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between">
          {/* Search Input Area */}
          <div className="flex flex-1 items-center gap-3">
            <div className="w-fit">
              <SearchBar
                value={value.search}
                onChange={(next) => onChange({ ...value, search: next })}
                placeholder="Search users..."
              />
            </div>

            {/* Loading Spinner or Total Count Text */}
            <div className="hidden min-w-[140px] text-sm text-copy-muted md:block">
              {isLoading ? (
                <div className="flex animate-pulse items-center gap-2 motion-reduce:animate-none">
                  <Spinner />
                  <span className="text-copy-muted">Updating...</span>
                </div>
              ) : (
                <span className="text-copy-muted">
                  <span className="font-medium text-copy-primary">
                    {options.totalCount}
                  </span>{" "}
                  users from{" "}
                  <span className="font-medium text-copy-primary">
                    {options.allTeams.length}
                  </span>{" "}
                  teams
                </span>
              )}
            </div>
          </div>

          {/* Right Side Actions */}
          <div className="flex items-center gap-2 px-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({ ...value, filtersOpen: !value.filtersOpen })
              }
              className={`
                text-xs font-normal transition-colors
                ${value.filtersOpen ? "bg-surface-raised text-copy-primary" : "text-copy-muted hover:text-copy-primary"}
              `}
            >
              <Filter />
              Filters
              {activeCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-action-primary-muted px-1 text-[9px] font-bold text-copy-primary">
                  {activeCount}
                </span>
              )}
            </Button>

            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClear}
                className="text-xs text-copy-muted hover:text-state-danger"
              >
                <SearchX />
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Expandable Filter Drawer */}
      <AnimatePresence initial={false}>
        {value.filtersOpen && (
          <motion.div
            key="filter-drawer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <Card className="px-4 py-3">
              <div className="grid gap-6 md:grid-cols-3">
                {/* Teams Section */}
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-copy-muted">
                    Teams
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <FilterChip
                      label="All"
                      active={value.selectedTeams.length === 0}
                      onClick={() => onChange({ ...value, selectedTeams: [] })}
                    />
                    {options.allTeams.map((teamName) => (
                      <FilterChip
                        key={teamName}
                        label={teamName}
                        active={value.selectedTeams.includes(teamName)}
                        onClick={() => {
                          const next = value.selectedTeams.includes(teamName)
                            ? value.selectedTeams.filter((t) => t !== teamName)
                            : [...value.selectedTeams, teamName];
                          onChange({ ...value, selectedTeams: next });
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Roles Section */}
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-copy-muted">
                    Roles
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <FilterChip
                      label="All"
                      active={value.selectedRoles.length === 0}
                      onClick={() => onChange({ ...value, selectedRoles: [] })}
                    />
                    {options.allRoles.map((roleName) => (
                      <FilterChip
                        key={roleName}
                        label={roleName}
                        active={value.selectedRoles.includes(roleName)}
                        onClick={() => {
                          const next = value.selectedRoles.includes(roleName)
                            ? value.selectedRoles.filter((r) => r !== roleName)
                            : [...value.selectedRoles, roleName];
                          onChange({ ...value, selectedRoles: next });
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Status Section */}
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-copy-muted">
                    Status
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <FilterChip
                      label="All"
                      active={value.selectedStatuses.length === 0}
                      onClick={() =>
                        onChange({ ...value, selectedStatuses: [] })
                      }
                    />
                    {options.allStatuses.map((statusValue) => {
                      const label =
                        statusValue.charAt(0).toUpperCase() +
                        statusValue.slice(1);

                      return (
                        <FilterChip
                          key={statusValue}
                          label={label}
                          active={value.selectedStatuses.includes(statusValue)}
                          onClick={() => {
                            const next = value.selectedStatuses.includes(
                              statusValue,
                            )
                              ? value.selectedStatuses.filter(
                                  (s) => s !== statusValue,
                                )
                              : [...value.selectedStatuses, statusValue];
                            onChange({ ...value, selectedStatuses: next });
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
