"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/Card";

/**
 * The `Related records` tab's list: one panel per related module, rows that open a record.
 *
 * Extracted from the account page in rebuild 5.3 batch 1, when the deal page became its
 * second call site. §0's order applies — two pages wanting the same shape is the moment it
 * becomes a primitive, not the moment the second one copies the first.
 *
 * A row is a link and therefore a box (§1.3 earns one by interactivity), unlike the audit
 * and timeline lists R8 turned back into `divide-y` lines. `RecordTable` is not the shape
 * here: these are a handful of headline rows per module, not a sortable, selectable,
 * paginated list — that is archetype 1, one click away through the module itself.
 */
export function RecordRelatedList({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 lg:grid-cols-2">{children}</div>;
}

export function RecordRelatedCard({
  title,
  empty,
  action,
  children,
}: {
  title: string;
  /** What "none" means for *this* relationship, in the module's own words (§7.4). */
  empty: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <Card className="px-5 py-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-copy-primary">{title}</h2>
        {action}
      </div>
      <div className="mt-4 space-y-3">
        {items.length && items.some(Boolean) ? children : <p className="text-sm text-copy-muted">{empty}</p>}
      </div>
    </Card>
  );
}

export function RecordRelatedLink({
  href,
  title,
  detail,
}: {
  href: string;
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-[var(--radius-control)] border border-line-subtle px-4 py-4 transition-colors hover:border-line-strong hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <div className="text-sm font-semibold text-copy-primary">{title}</div>
      <div className="mt-1 text-sm text-copy-muted">{detail}</div>
    </Link>
  );
}
