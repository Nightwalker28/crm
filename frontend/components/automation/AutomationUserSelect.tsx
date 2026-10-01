"use client";

import { USER_TARGET_ACTOR, USER_TARGET_LABELS, USER_TARGET_OWNER, valueAsString } from "./utils";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/SearchableSelect";
import { USER_OPTIONS_LIMIT, useUserOptions } from "@/hooks/useUserOptions";

const CAPPED_NOTE_VALUE = "__automation_users_capped__";

/**
 * Who an action targets, or which user a condition compares against.
 *
 * This was a text box that took "actor" or a user ID, so pointing a rule at a person meant
 * looking their ID up somewhere else. It is a list of people now, led by the two roles a
 * rule usually means: the record's owner and whoever made the change. Conditions compare
 * against a stored user, so they get the people only (`withRoles={false}`).
 */
export function AutomationUserSelect({
  label,
  value,
  onChange,
  moduleKey,
  withRoles = true,
  required,
}: {
  label: string;
  value: unknown;
  onChange: (value: string | number) => void;
  moduleKey: string | null;
  withRoles?: boolean;
  required?: boolean;
}) {
  // An admin reads any module's user list; `tasks` stands in when a rule has no module yet.
  const query = useUserOptions(moduleKey || "tasks", { action: "view" });
  const current = valueAsString(value);
  const options: SearchableSelectOption[] = [
    ...(withRoles
      ? [USER_TARGET_OWNER, USER_TARGET_ACTOR].map((target) => ({ value: target, label: USER_TARGET_LABELS[target] }))
      : []),
    ...query.users.map((user) => ({ value: String(user.id), label: user.label, description: user.email })),
  ];
  if (current && !options.some((option) => option.value === current)) {
    options.push({ value: current, label: query.isLoading ? "Loading users…" : "A user who is no longer listed" });
  }
  if (query.hasMore) {
    options.push({ value: CAPPED_NOTE_VALUE, label: `Only the first ${USER_OPTIONS_LIMIT} users are listed.`, disabled: true });
  }

  return (
    <SearchableSelect
      label={label}
      value={current}
      options={options}
      required={required}
      placeholder={withRoles ? "Choose who" : "Choose a user"}
      searchPlaceholder="Search people"
      emptyMessage={query.isError ? "We could not load the list of users." : "No user matches."}
      onValueChange={(next) => {
        if (next === CAPPED_NOTE_VALUE) return;
        onChange(next === USER_TARGET_OWNER || next === USER_TARGET_ACTOR ? next : Number(next));
      }}
    />
  );
}
