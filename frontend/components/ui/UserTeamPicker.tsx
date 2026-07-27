"use client";

import { useId, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search, UserRound, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type UserTeamPickerUser = {
  id: number;
  name: string;
  email?: string | null;
  team_name?: string | null;
};

export type UserTeamPickerTeam = {
  id: number;
  name: string;
};

export type UserTeamPickerSelection = {
  key: string;
  type: "user" | "team";
  id: number;
  label: string;
  typeLabel: string;
};

type Props = {
  users: UserTeamPickerUser[];
  teams: UserTeamPickerTeam[];
  selectedEntries: UserTeamPickerSelection[];
  isSelected: (type: "user" | "team", id: number) => boolean;
  onToggle: (type: "user" | "team", id: number) => void;
  disabled?: boolean;
  selectedSummary: (count: number) => string;
  emptySelectedText: string;
  initialHelpText: string;
  noResultsText: string;
  userGroupLabel?: string;
  teamGroupLabel?: string;
  teamDescription: string;
  triggerLabel?: string;
  searchLabel?: string;
};

export function UserTeamPicker({
  users,
  teams,
  selectedEntries,
  isSelected,
  onToggle,
  disabled = false,
  selectedSummary,
  emptySelectedText,
  initialHelpText,
  noResultsText,
  userGroupLabel = "Users",
  teamGroupLabel = "Teams",
  teamDescription,
  triggerLabel = "Select users or teams",
  searchLabel = "Search users or teams",
}: Props) {
  const searchId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const filteredUsers = useMemo(() => {
    if (!normalizedQuery) return [];
    return users
      .filter((user) =>
        [user.name, user.email, user.team_name]
          .filter(Boolean)
          .some((part) => String(part).toLowerCase().includes(normalizedQuery)),
      )
      .slice(0, 6);
  }, [normalizedQuery, users]);

  const filteredTeams = useMemo(() => {
    if (!normalizedQuery) return [];
    return teams.filter((team) => team.name.toLowerCase().includes(normalizedQuery)).slice(0, 6);
  }, [normalizedQuery, teams]);

  return (
    <div className="space-y-3">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="w-full justify-between text-left font-normal"
            aria-label={triggerLabel}
          >
            <span className="truncate">
              {selectedEntries.length ? selectedSummary(selectedEntries.length) : "Search users or teams"}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-copy-muted" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] border-line-default bg-surface-raised p-0 text-copy-primary shadow-xl sm:w-[440px]"
        >
          <div className="border-b border-line-default p-3">
            <label htmlFor={searchId} className="sr-only">{searchLabel}</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-copy-muted" />
              <Input
                id={searchId}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Type a name, email, or team"
                className="bg-surface-muted pl-9"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto p-2 custom-scrollbar">
            {!normalizedQuery ? (
              <div className="px-3 py-8 text-center text-sm text-copy-muted">{initialHelpText}</div>
            ) : !filteredUsers.length && !filteredTeams.length ? (
              <div role="status" className="px-3 py-8 text-center text-sm text-copy-muted">{noResultsText}</div>
            ) : (
              <div className="space-y-3">
                {filteredUsers.length ? (
                  <div className="overflow-hidden rounded-[var(--radius-control)] border border-line-default bg-surface p-1">
                    <div className="flex items-center gap-2 px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-copy-muted">
                      <UserRound className="h-3.5 w-3.5" />
                      {userGroupLabel}
                    </div>
                    {filteredUsers.map((user) => {
                      const selected = isSelected("user", user.id);
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => onToggle("user", user.id)}
                          aria-pressed={selected}
                          className="flex w-full items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-left text-sm text-copy-secondary transition-colors hover:bg-surface-muted hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium text-copy-primary">{user.name}</div>
                            <div className="truncate text-xs text-copy-muted">
                              {user.team_name ? `${user.team_name} · ` : ""}
                              {user.email || "No email"}
                            </div>
                          </div>
                          {selected ? <Check className="ml-3 h-4 w-4 shrink-0 text-primary" /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {filteredTeams.length ? (
                  <div className="overflow-hidden rounded-[var(--radius-control)] border border-line-default bg-surface p-1">
                    <div className="flex items-center gap-2 px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-copy-muted">
                      <Users className="h-3.5 w-3.5" />
                      {teamGroupLabel}
                    </div>
                    {filteredTeams.map((team) => {
                      const selected = isSelected("team", team.id);
                      return (
                        <button
                          key={team.id}
                          type="button"
                          onClick={() => onToggle("team", team.id)}
                          aria-pressed={selected}
                          className="flex w-full items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-left text-sm text-copy-secondary transition-colors hover:bg-surface-muted hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium text-copy-primary">{team.name}</div>
                            <div className="truncate text-xs text-copy-muted">{teamDescription}</div>
                          </div>
                          {selected ? <Check className="ml-3 h-4 w-4 shrink-0 text-primary" /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {selectedEntries.length ? (
        <div className="flex flex-wrap gap-2">
          {selectedEntries.map((entry) => (
            <div key={entry.key} className="inline-flex items-center gap-2 rounded-full border border-line-default bg-surface-muted px-3 py-1.5 text-xs text-copy-secondary">
              <span className="font-medium">{entry.label}</span>
              <span className="text-copy-muted">{entry.typeLabel}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onToggle(entry.type, entry.id)}
                className="rounded-full p-0.5 text-copy-muted transition-colors hover:bg-surface-raised hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={`Remove ${entry.label}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-copy-muted">{emptySelectedText}</div>
      )}
    </div>
  );
}
