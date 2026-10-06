"use client";

import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/SearchableSelect";
import {
  USER_OPTIONS_LIMIT,
  useUserOptions,
  type UserOptionsAction,
} from "@/hooks/useUserOptions";

export const UNASSIGNED_OWNER = "";
export const UNASSIGNED_OWNER_LABEL = "Unassigned";
const CAPPED_NOTE_VALUE = "__owner_options_capped__";

/**
 * The option set shared by the record spine and create/edit forms. Keeping the current owner
 * in the set matters for deactivated users and while the list request is still in flight.
 */
export function useOwnerSelectOptions({
  moduleKey,
  action,
  ownerId,
  ownerName,
  enabled = true,
}: {
  moduleKey: string;
  action: UserOptionsAction;
  ownerId?: number | null;
  ownerName?: string | null;
  enabled?: boolean;
}) {
  const query = useUserOptions(moduleKey, { action, enabled });
  const value = ownerId ? String(ownerId) : UNASSIGNED_OWNER;
  const displayName = ownerName || (ownerId ? "Unknown user" : UNASSIGNED_OWNER_LABEL);
  const options: SearchableSelectOption[] = [
    { value: UNASSIGNED_OWNER, label: UNASSIGNED_OWNER_LABEL },
    ...query.users.map((user) => ({
      value: String(user.id),
      label: user.label,
      description: user.email,
    })),
  ];

  if (value !== UNASSIGNED_OWNER && !options.some((option) => option.value === value)) {
    options.push({ value, label: displayName });
  }
  if (query.hasMore) {
    options.push({
      value: CAPPED_NOTE_VALUE,
      label: `Only the first ${USER_OPTIONS_LIMIT} users are listed. Find the rest in Users settings.`,
      disabled: true,
    });
  }

  return { ...query, value, displayName, options };
}

/** Owner is a field value, not a server-searched record reference (design.md §4.7, §7.8). */
export function OwnerSelect({
  id,
  label = "Owner",
  moduleKey,
  action,
  ownerId,
  ownerName,
  onChange,
  disabled,
  required,
  placeholder,
  ariaDescribedBy,
  ariaInvalid,
}: {
  id?: string;
  label?: string;
  moduleKey: string;
  action: UserOptionsAction;
  ownerId?: number | null;
  ownerName?: string | null;
  onChange: (ownerId: number | null, ownerName: string) => void;
  disabled?: boolean;
  required?: boolean;
  /** The resolved layout's own placeholder, when a tenant configured one. */
  placeholder?: string | null;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
}) {
  const { value, options, isLoading, isError } = useOwnerSelectOptions({
    moduleKey,
    action,
    ownerId,
    ownerName,
    enabled: !disabled,
  });

  const resolvedPlaceholder =
    placeholder || (action === "create" ? "Select owner (defaults to you)" : "Select owner");
  // A list that could not be loaded is a fact about the request, not about the record: the
  // control goes quiet, and this says why rather than leaving an inert box (§5.9).
  const loadErrorId = isError ? `${id ?? `${moduleKey}-owner`}-load-error` : undefined;
  const describedBy = [ariaDescribedBy, loadErrorId].filter(Boolean).join(" ") || undefined;

  return (
    <>
      <SearchableSelect
        id={id}
        label={label}
        value={value}
        options={options}
        onValueChange={(nextValue) => {
          const option = options.find((candidate) => candidate.value === nextValue);
          if (!option || option.disabled) return;
          onChange(nextValue === UNASSIGNED_OWNER ? null : Number(nextValue), option.label);
        }}
        /* `Unassigned` is a real value on a saved record, but on a create form it would assert
           something untrue — an owner left empty is the creator, not nobody. So the empty
           create state draws the placeholder that says so, and only `edit` draws the option. */
        renderValue={(selected) =>
          !selected || (action === "create" && selected.value === UNASSIGNED_OWNER) ? (
            <span className="text-copy-muted">{resolvedPlaceholder}</span>
          ) : (
            selected.label
          )
        }
        placeholder={resolvedPlaceholder}
        searchPlaceholder="Search owners"
        emptyMessage="No active users matched this search."
        disabled={disabled || isLoading || isError}
        required={required}
        ariaDescribedBy={describedBy}
        ariaInvalid={ariaInvalid}
        className="w-full"
      />
      {isError ? (
        <p id={loadErrorId} role="status" data-slot="owner-load-error" className="text-sm text-state-danger">
          {action === "create"
            ? "We could not load the list of users. This record will be assigned to you."
            : "We could not load the list of users. The owner cannot be changed right now."}
        </p>
      ) : null}
    </>
  );
}
