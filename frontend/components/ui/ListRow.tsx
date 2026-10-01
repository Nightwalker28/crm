"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";

import { ActionBar } from "@/components/ui/ActionBar";
import { cn } from "@/lib/utils";

const RowListInsetContext = createContext(false);

/**
 * The list a `ListRow` sits in: the `<ol>` / `<ul>`, its accessible name, and the rules between
 * rows (§7.15).
 *
 * `inset` says where the list sits, which is why it is the list's and not the row's. A list in a
 * padded panel lives in the panel's content box, so its first and last rows drop their outer
 * padding. A list that runs to its container's edge — a popover body, a flush card section — is
 * inset, and every row pads itself so the hover and selected grounds reach that edge.
 */
export function RowList({
  children,
  label,
  ordered = false,
  inset = false,
  className,
}: {
  children: ReactNode;
  /** The list's accessible name — *Timeline entries*, *Pending invites*. */
  label?: string;
  /** An `<ol>` when order carries meaning: a feed, a history, a ranking. */
  ordered?: boolean;
  inset?: boolean;
  className?: string;
}) {
  const List = ordered ? "ol" : "ul";
  return (
    <RowListInsetContext.Provider value={inset}>
      <List
        data-slot="row-list"
        data-inset={inset || undefined}
        aria-label={label}
        className={cn("divide-y divide-line-subtle", className)}
      >
        {children}
      </List>
    </RowListInsetContext.Provider>
  );
}

type ListRowProps = {
  title: ReactNode;
  /** The row opens a page. The title is the link, stretched over the row. */
  href?: string;
  /** The row opens something in place — a dialog, a reading pane. The title is the button. */
  onSelect?: () => void;
  /** Called alongside the link's navigation — marking a notification read. */
  onNavigate?: () => void;
  /** With `onSelect`: this row is the one shown. Elevation, never the action tint. */
  selected?: boolean;
  unread?: boolean;
  /** A type icon, an avatar. Decorative — the title and metadata carry the meaning. */
  leading?: ReactNode;
  /** One value on the title's line: a time, an amount, a status. */
  trailing?: ReactNode;
  /** One quieter line under the title. Not a sentence. */
  meta?: ReactNode;
  /** Controls. Never inside the open gesture. */
  actions?: ReactNode;
  /** The body — a summary, a snippet, a set of `Fact`s. */
  children?: ReactNode;
  className?: string;
};

/**
 * One line of a feed, an inbox or a history (§7.15).
 *
 * Fourteen hand-written rows drew this shape and disagreed on every class a call site was left to
 * pick; four of them drew a box inside a panel. The ink, the open gesture, the actions' place and
 * the unread and selected marks are fixed here, and the call site supplies only content.
 *
 * **The title is the open gesture, stretched over the row.** Its `after:` box covers the `<li>`,
 * so the whole row is the target and a link can still be opened in a new tab; actions sit above
 * that box and stay reachable. The focus outline is drawn on the stretched box, so it outlines
 * the row rather than the title's words.
 */
export function ListRow({
  title,
  href,
  onSelect,
  onNavigate,
  selected,
  unread = false,
  leading,
  trailing,
  meta,
  actions,
  children,
  className,
}: ListRowProps) {
  const inset = useContext(RowListInsetContext);
  const interactive = Boolean(href || onSelect);

  const targetClass = cn(
    "min-w-0 break-words text-left",
    "after:absolute after:inset-0 after:rounded-[var(--radius-control-sm)]",
    "focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-focus",
    inset ? "focus-visible:after:-outline-offset-2" : "focus-visible:after:outline-offset-2",
    // In a padded list there is no ground to raise, so the title says it is a link.
    !inset && "hover:underline",
  );
  const titleClass = cn(
    "text-sm text-copy-primary",
    unread ? "font-semibold" : "font-medium",
  );

  let titleNode: ReactNode;
  if (href) {
    titleNode = (
      <Link href={href} onClick={onNavigate} className={cn(targetClass, titleClass)}>
        {title}
      </Link>
    );
  } else if (onSelect) {
    titleNode = (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(targetClass, titleClass)}
      >
        {title}
      </button>
    );
  } else {
    titleNode = <p className={cn("min-w-0 break-words", titleClass)}>{title}</p>;
  }

  return (
    <li
      data-slot="list-row"
      data-selected={selected || undefined}
      className={cn(
        "relative flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 py-3",
        inset ? "px-4" : "first:pt-0 last:pb-0",
        inset && interactive && "transition-colors duration-100 hover:bg-surface-row-hover",
        selected && "bg-surface-raised hover:bg-surface-raised",
        className,
      )}
    >
      {leading || unread ? (
        <div className="mt-0.5 flex shrink-0 items-center gap-2">
          {unread ? (
            <span className="size-2 shrink-0 rounded-full bg-copy-primary" role="img" aria-label="Unread" />
          ) : null}
          {leading}
        </div>
      ) : null}
      <div className="min-w-48 flex-1 basis-0">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {titleNode}
          {trailing ? (
            <div className="shrink-0 text-xs tabular-nums text-copy-muted">{trailing}</div>
          ) : null}
        </div>
        {meta ? <div className="mt-0.5 min-w-0 break-words text-xs text-copy-muted">{meta}</div> : null}
        {children ? <div className="mt-2 min-w-0 text-p-sm text-copy-secondary">{children}</div> : null}
      </div>
      {actions ? (
        <ActionBar size="sm" className="relative z-10 ml-auto shrink-0">
          {actions}
        </ActionBar>
      ) : null}
    </li>
  );
}
