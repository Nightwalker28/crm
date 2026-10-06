"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A selected value in a multi-select, with the control that removes it.
 *
 * **This is not `Pill` coming back.** R5 deleted `Pill` because a capsule with a border, a
 * tint, a blur and a noise overlay said nothing about a *status* that ink could not, and it
 * said it hundreds of times per table. This is the other case §1.3 names: a box earned by
 * interactivity. The capsule marks where one removable unit ends and the next begins, and
 * the `×` inside it is a control, not decoration. It carries no tint and no blur.
 *
 * Three call sites wrote it by hand and no two agreed — `px-3 py-1` / `px-3 py-1.5` /
 * `px-2.5 py-1`, `h-3 w-3` / `h-3.5 w-3.5`, `text-copy-secondary` / `text-copy-primary`, and
 * one remove control with no hover state at all. One of them was also the app's last
 * standing §4.2 guard failure: `ClientPageCreateForm` passed `size-6` to a `Button` to force
 * the control smaller than its variant, which is the rule's exact prohibition. Here the
 * remove control is a plain `button` sized by its own padding, so there is no control-height
 * class at any call site.
 */
export function RemovableChip({
  label,
  meta,
  onRemove,
  removeLabel,
  disabled = false,
  className,
}: {
  label: ReactNode;
  /** A quieter second value on the same line — a type, a count. */
  meta?: ReactNode;
  onRemove: () => void;
  /** The remove control's accessible name. Names the thing, per §8. */
  removeLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <span
      data-slot="removable-chip"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-line-default bg-surface-muted px-3 py-1 text-xs text-copy-secondary",
        className,
      )}
    >
      <span className="font-medium text-copy-primary">{label}</span>
      {meta ? <span className="text-copy-muted">{meta}</span> : null}
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        aria-label={removeLabel}
        className={cn(
          "-mr-1 rounded-full p-0.5 text-copy-muted transition-colors",
          "hover:bg-surface-raised hover:text-copy-primary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}
