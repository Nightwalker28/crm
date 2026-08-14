"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  /**
   * Names the page, rendered as an `sr-only` h1 (design.md §8). Optional only for the
   * record action row, which sits under a shell that has already named the page;
   * `PageShell` requires it.
   */
  title?: string;
  description?: string;
  eyebrow?: ReactNode;
  /** Quiet left-hand line: what is being scoped, a count, an unsaved-changes note. */
  context?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/**
 * The heading row every page carries: an `sr-only` h1, an optional quiet context line,
 * and a right-aligned action group.
 *
 * This absorbed `PageToolbar`, which was the same component with a `context` slot and a
 * `min-h-9`. Keeping both meant a page picked one at random, and only this one emitted the
 * h1. The deprecated alias is gone: every page is on `PageShell`, which renders this.
 * See design.md §4.4.
 *
 * The h1 is deliberately `sr-only`: the heading belongs in the accessibility tree, while
 * the visible row carries only actions (§8). Do not make it visible.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  context,
  actions,
  className,
}: PageHeaderProps) {
  const hasVisibleRow = Boolean(context || actions);

  if (!title && !description && !eyebrow && !hasVisibleRow) return null;

  return (
    <div
      data-slot="page-header"
      className={cn(
        // With nothing visible to show, the row must not become a flex item — it would
        // otherwise draw a full `gap` of empty space under the shell's stack. The
        // sr-only children are absolutely positioned, so they add no gap of their own.
        hasVisibleRow
          ? "flex min-h-9 min-w-0 flex-wrap items-center justify-between gap-2"
          : "contents",
        className,
      )}
      aria-label={title ? `${title} actions` : undefined}
    >
      {title ? <h1 className="sr-only">{title}</h1> : null}
      {eyebrow ? <div className="sr-only">{eyebrow}</div> : null}
      {description ? <p className="sr-only">{description}</p> : null}
      {context ? <div className="min-w-0 text-xs font-medium text-copy-muted">{context}</div> : null}
      {actions ? (
        <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:shrink-0">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
