"use client";

import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/utils";

/**
 * The page root. Owning it here is the point: `design.md` §4.4 has specified the section
 * stack all along, but no primitive supplied it, so 27 dashboard page roots invented six
 * different rhythms and exactly one used the documented `space-y-6`. A rule with no
 * default behind it does not survive contact with the next page.
 *
 * - `list` — the §11.1 full-height column. The toolbar and pagination stay pinned and
 *   `ModuleTableShell`'s `flex-1` takes the rest, so the rows are the only scroller.
 *   `min-h-0` is load-bearing: without it the flex child refuses to shrink and the whole
 *   page scrolls again.
 * - `document` — a scrolling form or detail page at the documented section stack.
 * - `settings` — the same, at the wider settings stack.
 */
const pageShellVariants = cva("flex min-w-0 flex-col", {
  variants: {
    variant: {
      list: "h-full min-h-0 gap-4",
      document: "gap-6",
      settings: "gap-8",
    },
  },
  defaultVariants: {
    variant: "document",
  },
});

type PageShellProps = VariantProps<typeof pageShellVariants> & {
  /** Required — this is what guarantees the page has an h1 (design.md §8). */
  title: string;
  description?: string;
  eyebrow?: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
};

export function PageShell({
  variant,
  title,
  description,
  eyebrow,
  context,
  actions,
  children,
  className,
  headerClassName,
}: PageShellProps) {
  return (
    <div
      data-slot="page-shell"
      data-variant={variant ?? "document"}
      className={cn(pageShellVariants({ variant }), className)}
    >
      <PageHeader
        title={title}
        description={description}
        eyebrow={eyebrow}
        context={context}
        actions={actions}
        className={headerClassName}
      />
      {children}
    </div>
  );
}

export { pageShellVariants };
