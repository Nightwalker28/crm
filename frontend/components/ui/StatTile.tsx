import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A dashboard metric: its label, one figure, and at most one line of context (§3.3, §4.7
 * archetype 5).
 *
 * Four implementations drew this at three sizes — `text-3xl` on the dashboard's snapshot and
 * module tiles, `text-xl` on the reports metrics and the pipeline stage tiles — and every one
 * of them drew a bordered box inside a panel that was already a box. The role is fixed here:
 * **the stat figure is `text-2xl font-bold tabular-nums`, once**, and there is deliberately no
 * size prop. A figure that needs to be smaller is a `Fact`.
 *
 * **It draws no border.** A tile is an ink group; the row it sits in is `StatGroup`, and the
 * rules between tiles are the group's. `tabular-nums` is kept because the figures re-render in
 * place when the period changes, and proportional digits make a tile's width jitter.
 */
export function StatTile({
  label,
  value,
  context,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  /** One line of metadata — the period, the count behind a value. Not a sentence. */
  context?: ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="stat-tile" className={cn("min-w-0", className)}>
      <div className="truncate text-xs font-medium text-copy-label">{label}</div>
      <div className="mt-2 truncate text-2xl font-bold tabular-nums text-copy-primary">{value}</div>
      {context ? <div className="mt-1 truncate text-xs text-copy-muted">{context}</div> : null}
    </div>
  );
}

/**
 * A row of `StatTile`s, separated by hairline rules.
 *
 * The rules are drawn on each cell's own leading and top edge, one pixel outside it, and the
 * group clips them. So the cell in the first column loses its left rule and the first row
 * loses its top rule wherever the grid happens to wrap — which a `divide-x` cannot do across a
 * responsive breakpoint, and a `gap-px` over a coloured ground can only do by assuming the
 * ground behind the tiles.
 *
 * It fills its container edge to edge: the cells carry the padding, so a panel holding a
 * group draws no body padding of its own (§4.7 archetype 5).
 */
export function StatGroup({
  children,
  label,
  className,
}: {
  children: ReactNode;
  /** Names the group for assistive tech when no visible heading does. */
  label?: string;
  className?: string;
}) {
  return (
    <div
      data-slot="stat-group"
      role={label ? "group" : undefined}
      aria-label={label}
      className={cn(
        "grid overflow-hidden md:grid-cols-2 xl:grid-cols-4",
        "[&>[data-slot=stat-tile]]:relative [&>[data-slot=stat-tile]]:p-4",
        "[&>[data-slot=stat-tile]]:before:absolute [&>[data-slot=stat-tile]]:before:inset-y-0 [&>[data-slot=stat-tile]]:before:-left-px [&>[data-slot=stat-tile]]:before:w-px [&>[data-slot=stat-tile]]:before:bg-line-subtle",
        "[&>[data-slot=stat-tile]]:after:absolute [&>[data-slot=stat-tile]]:after:inset-x-0 [&>[data-slot=stat-tile]]:after:-top-px [&>[data-slot=stat-tile]]:after:h-px [&>[data-slot=stat-tile]]:after:bg-line-subtle",
        className,
      )}
    >
      {children}
    </div>
  );
}
