"use client";

import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

type Props = VariantProps<typeof moduleTableShellVariants> & {
  children: ReactNode;
  className?: string;
  isRefreshing?: boolean;
  /** Names the scroll region. Defaults to the generic name for the hand-rolled callers. */
  label?: string;
};

/**
 * The scroll container for a module list.
 *
 * It is `flex-1`, not a fixed height. Inside a full-height list page (see the
 * `flex h-full min-h-0 flex-col` root those pages use) it takes the space left over
 * by the toolbar and pagination, so those stay pinned and the rows are the only thing
 * that scrolls — one scrollbar on the screen, and the sticky column header keeps
 * working because this element is still the scrolling ancestor.
 *
 * Outside a flex column `flex-1` is inert and the shell simply grows to its content,
 * which is a safe fallback rather than a broken one.
 *
 * It previously capped at `max-h-[70vh]`, which put a second scroll container inside
 * the already-scrolling page: two scrollbars, and the table stole the wheel whenever
 * the pointer was over it. Do not reintroduce a max-height here — constrain the page
 * layout instead. See docs/design/design.md 11.1.
 *
 * `variant="nested"` is for a table that already sits inside a `Card`: the card draws
 * the panel edge, so the shell must not draw a second one one pixel inside it. Three
 * call sites were passing `className="rounded-none border-0"` to say the same thing,
 * which is the divergence 7.3 asks primitives to absorb.
 */
const moduleTableShellVariants = cva(
  "scrollbar-hide relative min-h-56 flex-1 overflow-auto overscroll-contain bg-surface after:pointer-events-none after:sticky after:right-0 after:top-0 after:block after:h-full after:w-8 after:float-right after:bg-gradient-to-l after:from-surface after:to-transparent md:after:hidden",
  {
    variants: {
      variant: {
        standalone: "rounded-[var(--radius-card)] border border-line-default",
        nested: "",
      },
    },
    defaultVariants: { variant: "standalone" },
  },
);

export function ModuleTableShell({ children, className, isRefreshing = false, label = "Data table", variant }: Props) {
  return (
    <div
      className={cn(moduleTableShellVariants({ variant }), className)}
      role="region"
      aria-label={label}
      aria-busy={isRefreshing}
    >
      {isRefreshing ? (
        <div className="pointer-events-none absolute right-3 top-3 z-40 inline-flex items-center gap-2 rounded-full border border-line-default bg-surface-raised/90 px-3 py-1 text-2xs font-medium text-copy-label backdrop-blur-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-copy-muted" />
          Refreshing
        </div>
      ) : null}
      {children}
    </div>
  );
}

export { moduleTableShellVariants };
