"use client";

import type { ReactNode } from "react";

import { SaveStateIndicator, type SaveState } from "@/components/ui/SaveStateIndicator";
import { cn } from "@/lib/utils";

type SettingsRowProps = {
  /** The setting's name. Plain text unless it has to label a control by `id`. */
  label: ReactNode;
  /** What changing it does, or what it applies to. Wraps at reading length (§3.3). */
  description?: ReactNode;
  /** The control — a `SegmentedBoolean`, a `Select`, an `Input`. */
  children: ReactNode;
  /**
   * Autosave feedback for *this* control (R1). Omit on a row inside a configuration record
   * that commits through a footer — a `Saved` beside a field the operator has not saved yet
   * is worse than no indicator at all.
   */
  saveState?: SaveState;
  onRetry?: () => void;
  className?: string;
};

/**
 * The unit archetype 4 is built from: one setting, its explanation, its control, and the
 * confirmation that the control committed.
 *
 * Settings had eight editing patterns across 19 pages, and the reason was that the pairing
 * of a control with its feedback had no owner — so `authentication` autosaved a `Select` at
 * `:45` and put an explicit Save/Discard footer forty lines below it, with nothing on screen
 * telling the operator which half had already written. The row owns the pairing, so a page
 * cannot express that state any more: a control that autosaves is drawn beside its
 * `SaveStateIndicator`, and one that does not has no indicator to draw.
 *
 * It replaces `SettingsSwitchRow`, which was the same shape welded to a hand-rolled
 * boolean. The control is a slot because a setting is as often a `Select` or a text input
 * as it is a toggle, and the boolean it does take is `SegmentedBoolean` (§7.1).
 */
export function SettingsRow({
  label,
  description,
  children,
  saveState,
  onRetry,
  className,
}: SettingsRowProps) {
  return (
    <div
      data-slot="settings-row"
      className={cn(
        "flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6",
        "border-b border-line-subtle last:border-b-0",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-copy-primary">{label}</div>
        {description ? <p className="mt-0.5 text-p-xs text-copy-muted">{description}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {children}
        {saveState ? <SaveStateIndicator state={saveState} onRetry={onRetry} /> : null}
      </div>
    </div>
  );
}
