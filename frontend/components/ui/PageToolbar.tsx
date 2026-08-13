import type { ReactNode } from "react";

import { PageHeader } from "@/components/ui/PageHeader";

/**
 * @deprecated Use `PageHeader`, or `PageShell` — which renders one for you.
 *
 * `PageToolbar` and `PageHeader` were the same component: a right-aligned action row.
 * They differed only in a `min-h-9` and in which one emitted the page's h1, so a page
 * picked one at random and 20 files ended up on this side of the coin flip. They are now
 * one component (design.md §4.4); this alias exists so those call sites keep compiling
 * while Phase 4 of docs/design/consistency-pass.md migrates them onto `PageShell`.
 *
 * Note the shapes are not identical: this alias passes no `title`, so a page still on it
 * emits no h1 of its own. Supplying that title is part of the migration, not optional.
 */
export function PageToolbar({
  children,
  context,
  className,
}: {
  children?: ReactNode;
  context?: ReactNode;
  className?: string;
}) {
  return <PageHeader context={context} actions={children} className={className} />;
}
