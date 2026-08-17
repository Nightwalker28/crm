"use client";

import { useEffect, useRef, useState } from "react";

import { SaveStateIndicator, type SaveState } from "@/components/ui/SaveStateIndicator";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
import type { StatusDescriptor } from "@/lib/statusStyles";
import { cn } from "@/lib/utils";

export type InlineFieldEditOption = StatusDescriptor & { value: string };

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
 * R6's affordance is deliberately quiet rather than a hover reveal (see `SelectTrigger
 * variant="ghost"`). Its own `SaveStateIndicator` sits beside it and is what replaces the Save
 * button R1 removes: `saved` reverts to `idle` after a couple of seconds, `error` does not
 * revert on its own, because an unretryable failure is a dead end.
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

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

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
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <Select
        value={value}
        onValueChange={(next) => void handleValueChange(next)}
        disabled={disabled || saveState === "saving"}
      >
        <SelectTrigger variant="ghost" size="sm" aria-label={fieldLabel}>
          <StatusValue status={current} context="record" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <SaveStateIndicator
        state={saveState}
        onRetry={saveState === "error" && pending ? () => void commit(pending) : undefined}
      />
    </div>
  );
}
