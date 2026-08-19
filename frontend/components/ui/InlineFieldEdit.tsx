"use client";

import { useEffect, useRef, useState } from "react";

import { SaveStateIndicator, type SaveState } from "@/components/ui/SaveStateIndicator";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { StatusValue } from "@/components/ui/StatusValue";
import type { StatusDescriptor } from "@/lib/statusStyles";
import { cn } from "@/lib/utils";

export type InlineFieldEditOption = StatusDescriptor & {
  value: string;
  /** A second line under the option — a user's email. Searched as well as shown, and never
   *  drawn on the closed value, which stays the label alone. */
  description?: string;
  /** Reaches `SearchableSelect` as an unselectable row. Used for the note that says an option
   *  list was capped (design.md §7.8), not for options the operator merely may not pick. */
  disabled?: boolean;
};

type InlineFieldEditProps = {
  /** The field's name — the trigger's accessible name. Not shown; the value is. */
  fieldLabel: string;
  /** The committed value. `InlineFieldEdit` does not hold its own copy — the caller's
   *  optimistic update (or rollback on failure) is what moves this. */
  value: string;
  options: InlineFieldEditOption[];
  /** Persists the change. Throw (or reject) on failure — the indicator reads that as `error`
   *  and the caller is responsible for rolling `value` back to what it was. */
  onCommit: (next: InlineFieldEditOption) => Promise<void>;
  /**
   * R1's "explicit confirm, never a silent commit" row — required for a value that fires an
   * automation or an email. Resolve `false` to cancel; `onCommit` never runs.
   */
  confirm?: (next: InlineFieldEditOption) => Promise<boolean>;
  disabled?: boolean;
  className?: string;
};

const SAVED_RESET_MS = 2000;

/**
 * The R2/R6 state-field control: a dropdown-shaped value that autosaves (R1) rather than a
 * detail page's content, which stays read-only until `/[id]/edit`.
 *
 * The closed value renders through `StatusValue` at `context="record"`, so a field looks the
 * same whether or not it turns out to be editable, until the operator notices the chevron —
 * R6's affordance is deliberately quiet rather than a hover reveal (see the `ghost` trigger
 * variant).
 *
 * The control underneath is `SearchableSelect`, which grows a search field once the option
 * list passes `SEARCHABLE_SELECT_MIN_OPTIONS` (7.8). No call site passes a flag: status has
 * five options and never searches, Owner has as many as the tenant has users and always does,
 * and neither of them says so.
 *
 * Its own `SaveStateIndicator` sits beside it and is what replaces the Save button R1 removes:
 * `saved` reverts to `idle` after a couple of seconds, `error` does not revert on its own,
 * because an unretryable failure is a dead end.
 *
 * Full contract in `docs/design/design.md`, archetype 2.
 */
export function InlineFieldEdit({
  fieldLabel,
  value,
  options,
  onCommit,
  confirm,
  disabled,
  className,
}: InlineFieldEditProps) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [pending, setPending] = useState<InlineFieldEditOption | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const wasSaving = useRef(false);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  /**
   * Give the trigger its focus back when the write lands.
   *
   * The control is disabled while saving, and a *disabled element cannot hold focus* — so
   * Radix's restore-on-close puts focus on a button that is about to be taken away, the
   * browser drops it to `<body>`, and the next Tab restarts at the top of the page. Every
   * keyboard commit of every state field did this. Found by driving the rail from the
   * keyboard; nothing in the suite could see it, because the value saved correctly the whole
   * time (§8, and the same class of defect as the History sheet's missing `SheetTrigger`).
   *
   * Only when focus actually went nowhere: an operator who has already moved on keeps their
   * place.
   */
  useEffect(() => {
    if (saveState === "saving") {
      wasSaving.current = true;
      return;
    }
    if (!wasSaving.current) return;
    wasSaving.current = false;
    if (document.activeElement && document.activeElement !== document.body) return;
    rootRef.current
      ?.querySelector<HTMLButtonElement>('[data-slot="searchable-select-trigger"]')
      ?.focus();
  }, [saveState]);

  const current: InlineFieldEditOption =
    options.find((option) => option.value === value) ?? { value, tone: null, label: value };

  async function commit(next: InlineFieldEditOption) {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setPending(next);
    setSaveState("saving");
    try {
      await onCommit(next);
      setSaveState("saved");
      resetTimer.current = setTimeout(() => setSaveState("idle"), SAVED_RESET_MS);
    } catch {
      setSaveState("error");
    }
  }

  async function handleValueChange(nextValue: string) {
    if (nextValue === value) return;
    const next = options.find((option) => option.value === nextValue);
    if (!next) return;
    if (confirm) {
      const confirmed = await confirm(next);
      if (!confirmed) return;
    }
    await commit(next);
  }

  return (
    <div ref={rootRef} className={cn("flex flex-wrap items-center gap-3", className)}>
      <SearchableSelect
        label={fieldLabel}
        value={value}
        options={options}
        onValueChange={(next) => void handleValueChange(next)}
        renderValue={() => <StatusValue status={current} context="record" />}
        variant="ghost"
        size="sm"
        disabled={disabled || saveState === "saving"}
      />
      <SaveStateIndicator
        state={saveState}
        onRetry={saveState === "error" && pending ? () => void commit(pending) : undefined}
      />
    </div>
  );
}
