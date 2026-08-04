"use client";

import { motion, AnimatePresence } from "motion/react";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
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
      aria-pressed={active}
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
  isLoading?: boolean;
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
  const activeCount =
    value.selectedTeams.length +
    value.selectedRoles.length +
    value.selectedStatuses.length;

  return (
    <div className="flex flex-col gap-4 text-copy-primary">
      <ModuleListToolbar
        searchValue={value.search}
        onSearchChange={(search) => onChange({ ...value, search })}
        searchPlaceholder="Search users..."
        filtersOpen={value.filtersOpen}
        activeFilterCount={activeCount}
        onToggleFilters={() => onChange({ ...value, filtersOpen: !value.filtersOpen })}
        onClearFilters={onClear}
        actionControls={
          <div className="min-w-[140px] text-sm text-copy-muted" aria-live="polite">
            {isLoading ? (
              <span className="flex items-center gap-2">
                <Spinner />
                Updating...
              </span>
            ) : (
              <span>
                <span className="font-medium text-copy-primary">{options.totalCount}</span>{" "}
                users · <span className="font-medium text-copy-primary">{options.allTeams.length}</span>{" "}
                teams
              </span>
            )}
          </div>
        }
      />

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
            <Card>
              <div className="divide-y divide-line-subtle">
                <section className="px-4 py-4" aria-labelledby="user-filter-teams">
                  <h3 id="user-filter-teams" className="text-sm font-semibold text-copy-primary">Teams</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
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
                </section>

                <section className="px-4 py-4" aria-labelledby="user-filter-roles">
                  <h3 id="user-filter-roles" className="text-sm font-semibold text-copy-primary">Roles</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
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
                </section>

                <section className="px-4 py-4" aria-labelledby="user-filter-status">
                  <h3 id="user-filter-status" className="text-sm font-semibold text-copy-primary">Status</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
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
                </section>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
