"use client";

import type { ReactNode } from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Pick one of a small set — a view switcher, or a two-state Active/Inactive toggle.
 *
 * This did not exist, so 16 files hand-rolled it out of `Button`, using the `secondary`
 * variant to mean *selected*. design.md 2.2 measured `secondary` at 8 call sites and ruled it
 * a redundant `outline`; the real figure is 47, and 38 of them are the selected half of a
 * two-state control. The variant was not redundant — it was a missing primitive wearing a
 * button's clothes, which is 7.3 exactly: three call sites passing the same override are a
 * missing variant, and forty-seven are a missing component.
 *
 * Vendored from shadcn's `ToggleGroup` (7.2) rather than hand-rolled, which is what supplies
 * the roving tabindex and arrow-key navigation. The hand-rolled version had neither: every
 * segment was its own tab stop, so a three-way switcher cost three tabs to pass.
 *
 * **Selection is carried by ground and ink, not by a fill.** The selected segment takes
 * `bg-surface-raised` and `text-copy-primary` against the group's recessed `bg-surface-muted`
 * — the same one-step-lighter move 2.1 uses everywhere else. It is deliberately *not* the
 * neutral primary fill: 2.2 allows exactly one filled button per view, and `settings/backups`
 * alone carries three of these pairs on one page.
 */

type SegmentedControlProps<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  children: ReactNode;
  /** Names the group for assistive tech — "Deal display", "Table density". */
  "aria-label": string;
  size?: "sm" | "default";
  className?: string;
};

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  children,
  size = "sm",
  className,
  ...props
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      // Radix emits "" when the pressed item is clicked again. A segmented control has no
      // empty state — one option is always in force — so a deselect is ignored rather than
      // pushed up as a falsy value the caller would have to defend against.
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      data-slot="segmented-control"
      data-size={size}
      className={cn(
        // No border and no padding, deliberately. A bordered group with inset segments makes
        // the segments 28px — off the closed height set (4.2) — and makes the group 34px, which
        // matches nothing beside it. Ground alone separates the group, which is what 1.3 asks
        // for anyway, and the segments then carry the real `--size-control-sm` token so a
        // switcher is exactly as tall as the search field and buttons in the same toolbar.
        "group/segmented inline-flex items-center rounded-[var(--radius-control)] bg-surface-muted",
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Root>
  );
}

type SegmentedBooleanProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** Names the group for assistive tech — "Group availability", "Backup schedule". */
  "aria-label": string;
  trueLabel: string;
  falseLabel: string;
  disabled?: boolean;
  className?: string;
};

/**
 * The two-state case, which is 21 of the 47 sites this component replaces — Active/Inactive,
 * Default/Not default, Enabled/Disabled.
 *
 * It exists so those call sites stop re-deriving `!value` for the second button's pressed
 * state, which is where the bug lived: several pairs wrote `aria-pressed={value}` on both
 * halves, announcing the off option as pressed.
 *
 * Inline rather than the `grid grid-cols-2` the call sites used. A full-width control for a
 * two-word choice is exactly the whitespace 1.5 rules out.
 */
export function SegmentedBoolean({
  value,
  onValueChange,
  trueLabel,
  falseLabel,
  disabled,
  className,
  ...props
}: SegmentedBooleanProps) {
  return (
    <SegmentedControl
      value={value ? "true" : "false"}
      onValueChange={(next) => onValueChange(next === "true")}
      className={className}
      {...props}
    >
      <SegmentedItem value="true" disabled={disabled}>
        {trueLabel}
      </SegmentedItem>
      <SegmentedItem value="false" disabled={disabled}>
        {falseLabel}
      </SegmentedItem>
    </SegmentedControl>
  );
}

type SegmentedItemProps = {
  value: string;
  children: ReactNode;
  disabled?: boolean;
  /** Square the segment for a glyph with no label. `aria-label` becomes required. */
  iconOnly?: boolean;
  /** Required when the segment is icon-only. */
  "aria-label"?: string;
};

export function SegmentedItem({ value, children, disabled, iconOnly, ...props }: SegmentedItemProps) {
  return (
    <ToggleGroupPrimitive.Item
      value={value}
      disabled={disabled}
      data-slot="segmented-item"
      className={cn(
        "inline-flex h-[var(--size-control-sm)] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-medium",
        iconOnly ? "w-[var(--size-control-sm)]" : "px-3",
        "text-copy-secondary transition-[background-color,color] duration-150",
        "hover:text-copy-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset",
        "disabled:pointer-events-none disabled:text-copy-disabled",
        "data-[state=on]:bg-surface-raised data-[state=on]:text-copy-primary",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // `[data-size=default]` on the group lifts every segment to the 38px row height, for
        // a switcher sitting beside form controls rather than in a toolbar (4.2).
        "group-data-[size=default]/segmented:h-[var(--size-control)]",
        iconOnly && "group-data-[size=default]/segmented:w-[var(--size-control)]",
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
}
