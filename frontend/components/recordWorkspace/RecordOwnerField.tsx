"use client";

import { InlineFieldEdit, type InlineFieldEditOption } from "@/components/ui/InlineFieldEdit";
import { RecordSpineField } from "@/components/ui/RecordSpine";
import { StatusValue } from "@/components/ui/StatusValue";
import { useUserOptions, USER_OPTIONS_LIMIT } from "@/hooks/useUserOptions";

/**
 * The empty owner, as a value.
 *
 * `""` rather than a word, because it is what the record's own column holds and the round
 * trip through `Number()` stays honest. design.md §4.7 rules that this is a *value* and not
 * an absent one: a record can be handed back to the pool, so the option exists and the field
 * renders its name rather than `EmptyValue`'s `Not set`.
 */
export const UNASSIGNED_OWNER = "";
const UNASSIGNED_OWNER_LABEL = "Unassigned";

/** Never selectable, and never a real user id — see `cappedNote` below. */
const CAPPED_NOTE_VALUE = "__owner_options_capped__";

/**
 * The record's owner, in the spine's State block, on every record type that has one.
 *
 * **Why this is a component and not nine copies of six lines.** The render is small; the
 * options are not. Every one of the nine needs the same four answers — the tenant's users,
 * the unassigned value, the current owner kept selectable when the list does not contain them
 * (deactivated, or the request still in flight), and the cap disclosure — and the two pages
 * that had already hand-rolled the equivalent for `customer_group_id` had drifted from each
 * other by the time this was written. §0: reuse before extending.
 *
 * **What the call site still owns:** the write. Nine modules disagree about the column name
 * (`assigned_to`, `owner_id`, `user_id`, `assigned_to_id`), the verb (`PUT` and `PATCH`), and
 * the cache shape the optimistic update has to move — the pages' own `updateStatus` functions
 * differ for the same reasons. Hiding that behind a shared endpoint prop would buy nothing
 * and cost the rollback.
 *
 * **Read-only is not a lesser state here.** Without the edit permission, or when the user
 * list cannot be loaded at all, the field renders the name and no chevron: a picker whose
 * only options are `Unassigned` and the person already selected is §7.9's lie — it looks like
 * a choice and it is not.
 */
export function RecordOwnerField({
  label = "Owner",
  moduleKey,
  ownerId,
  ownerName,
  canEdit,
  onCommit,
}: {
  /** The module's own word for the field. `Assignee` on a support case; the behaviour is the
   *  same either way (§4.7). */
  label?: string;
  moduleKey: string;
  ownerId?: number | null;
  ownerName?: string | null;
  canEdit: boolean;
  /** Persists the reassignment. Throw to put the field's indicator into `error` — the caller
   *  rolls its own optimistic update back, exactly as the status fields do. */
  onCommit: (ownerId: number | null) => Promise<void>;
}) {
  const { users, hasMore, isLoading, isError } = useUserOptions(moduleKey, { enabled: canEdit });

  const value = ownerId ? String(ownerId) : UNASSIGNED_OWNER;
  // Never `User #7`: §5.9 has a whole row about raw foreign keys reaching the operator, and
  // this branch is only reachable if the response carried an id whose name it could not
  // resolve — a fact about the data, not a number the operator can use.
  const displayName = ownerName || (ownerId ? "Unknown user" : UNASSIGNED_OWNER_LABEL);

  if (!canEdit || isError) {
    // `StatusValue`, not plain text, so the field is drawn identically whether or not it turns
    // out to be editable — R6's affordance is the chevron, and nothing else should move.
    return (
      <RecordSpineField label={label}>
        <StatusValue status={{ tone: null, label: displayName }} context="record" />
      </RecordSpineField>
    );
  }

  const options: InlineFieldEditOption[] = [
    { value: UNASSIGNED_OWNER, tone: null, label: UNASSIGNED_OWNER_LABEL },
    ...users.map((user) => ({
      value: String(user.id),
      tone: null,
      label: user.label,
      // Two people share a first name more often than a tenant would like, and the email is
      // what tells them apart. It is searched as well as drawn (§7.8).
      description: user.email,
    })),
  ];

  // The record arrives before the user list does, and a deactivated owner is never in it at
  // all. Without this the rail would render the raw id for the length of that request, and
  // permanently for anyone who has left — `InlineFieldEdit` falls back to the value when no
  // option matches. Same shape as the archived customer group on the contact rail.
  if (value !== UNASSIGNED_OWNER && !options.some((option) => option.value === value)) {
    options.push({ value, tone: null, label: displayName });
  }

  if (hasMore) {
    // A capped list that does not say so reads as "that person does not exist" (§7.8). It is a
    // row rather than a toast because it belongs where the absence is noticed, and it is
    // disabled because it is not an owner — arrow keys skip it and Enter refuses it.
    options.push({
      value: CAPPED_NOTE_VALUE,
      tone: null,
      label: `Only the first ${USER_OPTIONS_LIMIT} users are listed. Search for the rest on the edit page.`,
      disabled: true,
    });
  }

  return (
    <RecordSpineField label={label}>
      <InlineFieldEdit
        fieldLabel={label}
        value={value}
        options={options}
        disabled={isLoading}
        onCommit={(next) => onCommit(next.value === UNASSIGNED_OWNER ? null : Number(next.value))}
      />
    </RecordSpineField>
  );
}
