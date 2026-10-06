import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A marker that is **not** a status: a tag, a scope name, a field type, a "System" or "Draft"
 * marker, a count.
 *
 * R5 deletes `Pill` and names this explicitly — "where a genuine badge is still needed (a
 * count, a tag), that is a different component with a different name." The distinction is not
 * cosmetic. A *status* is one value from a closed set that says how a record is doing, so it
 * renders as ink and only deviation is painted (`StatusValue`). A *tag* names what something
 * is; it has no better or worse, so it never carries tone at all — but it does need a visible
 * edge, because it is usually one of several sitting in a row and the reader has to see where
 * one ends and the next begins.
 *
 * That edge is the separation 1.3 allows. What it is not:
 *
 * - not `rounded-full` — 4.3 reserves that corner for avatars, and a capsule per row is the
 *   density complaint R5 was written about. This is `--radius-control-sm`, the token whose
 *   own definition reads "small buttons, chips";
 * - not tinted, not blurred, and with **no noise-texture overlay** — `Pill` rendered a
 *   decorative `<div>` inside every chip, hundreds of times per table, carrying no
 *   information;
 * - not coloured. A tag that needs colour is a status, and belongs in `statusStyles.ts`.
 */
export function Chip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-slot="chip"
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-[var(--radius-control-sm)]",
        "border border-line-subtle bg-surface-muted px-1.5 py-0.5",
        "text-2xs font-medium text-copy-secondary",
        "[&_svg]:size-3 [&_svg]:shrink-0",
        className,
      )}
    >
      {children}
    </span>
  );
}
