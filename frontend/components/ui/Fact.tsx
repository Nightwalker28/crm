import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A read-only label over its value (§7.12).
 *
 * The most-repeated shape in the app after the table, and it existed four times — the
 * record spine's field, `profile`'s `SummaryTile`, `settings/authentication`'s local pair,
 * and `settings/backups`' `Fact` — disagreeing on the two axes a call site was left to
 * decide: whether it draws a box, and how loud the value is.
 *
 * **It is an ink group, not a box.** A read-only value is static, so a container is not
 * earned by interactivity (§1.3), and label-above-value already groups. Every call site
 * sits inside a `Card` or a `FormSection`, so a border on each cell is the third container
 * level §1.3 forbids.
 *
 * The label steps *down* to `text-copy-label` so the value is what the eye lands on. That
 * inversion is R7's, and it is deliberate: the operator came for the value.
 */
export function Fact({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs font-medium text-copy-label">{label}</dt>
      <dd className="mt-1 break-words text-sm text-copy-primary">{children}</dd>
    </div>
  );
}

/**
 * The `<dl>` a `Fact` belongs in.
 *
 * `Fact` emits `dt`/`dd`, which are only valid inside a description list — so the list is
 * supplied here rather than left to the call site, where two of the three originals rendered
 * bare `div`s inside a `<dl>` they had written themselves.
 */
export function FactList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <dl className={cn("grid gap-3", className)}>{children}</dl>;
}
