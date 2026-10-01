"use client";

import { Check, Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SaveState = "idle" | "saving" | "saved" | "error";

type SaveStateIndicatorProps = {
  state: SaveState;
  /** Required when `state` is `"error"` — an error the operator cannot retry is a dead end. */
  onRetry?: () => void;
  className?: string;
};

/**
 * The feedback that replaces the Save button.
 *
 * R1 makes settings toggles and detail-page state fields autosave, which removes the button —
 * and the button was the operator's only signal that a write happened at all. An autosaving
 * field with no indicator does not look "cleaner", it looks like it did nothing.
 *
 * The three states are fixed by R1: `Saving…` / `Saved` / `Couldn't save — retry`. The error
 * names the fix rather than the failure (7.5), which is why it carries the retry control
 * rather than an apology.
 *
 * It is `aria-live="polite"`: a screen-reader operator who just changed a stage needs the same
 * confirmation a sighted one gets from the tick, and `polite` rather than `assertive` because
 * a save confirmation should not interrupt whatever they are reading. `idle` renders nothing
 * but keeps the live region mounted — a region announced only once it appears is announced
 * inconsistently across screen readers.
 */
export function SaveStateIndicator({ state, onRetry, className }: SaveStateIndicatorProps) {
  return (
    <div
      data-slot="save-state-indicator"
      data-state={state}
      role="status"
      aria-live="polite"
      className={cn("flex min-h-[var(--size-control-sm)] items-center gap-1.5 text-xs", className)}
    >
      {state === "saving" ? (
        <span className="flex items-center gap-1.5 text-copy-muted">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Saving…
        </span>
      ) : null}

      {state === "saved" ? (
        <span className="flex items-center gap-1.5 text-copy-muted">
          <Check className="size-3.5 text-state-success" aria-hidden="true" />
          Saved
        </span>
      ) : null}

      {state === "error" ? (
        <span className="flex items-center gap-1.5 text-state-danger">
          Couldn&rsquo;t save
          {onRetry ? (
            <Button type="button" variant="destructiveGhost" size="sm" onClick={onRetry}>
              <RotateCcw />
              Retry
            </Button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
