"use client";

import { createContext, useContext, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ActionBarSize = "sm" | "default" | "lg";

const ActionBarSizeContext = createContext<ActionBarSize | null>(null);

/**
 * Read by `Button` when the call site did not pass an explicit `size`. Exported for the other
 * controls that share the closed height set (4.2) — an input beside a button in a toolbar has
 * to resolve to the same token.
 */
export function useActionBarSize() {
  return useContext(ActionBarSizeContext);
}

type ActionBarProps = {
  children: ReactNode;
  /**
   * Named by the row's job, per R4:
   * `sm` in a toolbar or a table row action, `default` in a page header or a form,
   * `lg` only on auth screens and empty-state calls to action (4.2).
   */
  size?: ActionBarSize;
  align?: "start" | "end" | "between";
  className?: string;
};

/**
 * An action row, and the owner of its children's control height.
 *
 * 4.2 already said an input and the button beside it resolve to the same token, but it never
 * extended that to two buttons beside each other and nothing guarded it — so with `default`
 * (38px) at 364 call sites and `sm` (32px) at 228, a mixed row was near-certain. R4's answer
 * is that **the row sets the size, so a call site cannot mix them**.
 *
 * It also absorbs the ~38 external spacing overrides on `Button`. Those existed because the
 * missing thing was a container for the row, not another button variant: with nothing owning
 * the gap, each call site added its own `ml-2` / `mr-3` / `gap-2`.
 *
 * Width may still differ — an icon-only button beside a labelled one is the same height and
 * narrower, and that is not a mismatch (R4). The 5.10 guard compares heights, not widths.
 *
 * **This is not sticky.** R3 deletes all ten `sticky bottom-0` save bars; an action row is a
 * flex sibling of the scroll region, like the list page's toolbar and pagination (11.1).
 */
export function ActionBar({ children, size = "default", align = "end", className }: ActionBarProps) {
  return (
    <ActionBarSizeContext.Provider value={size}>
      <div
        data-slot="action-bar"
        data-size={size}
        className={cn(
          "flex flex-wrap items-center gap-2",
          align === "end" && "justify-end",
          align === "between" && "justify-between",
          className,
        )}
      >
        {children}
      </div>
    </ActionBarSizeContext.Provider>
  );
}

type FormFooterProps = {
  children: ReactNode;
  /** `SaveStateIndicator`, an unsaved-changes line, or a `role="alert"` error. Sits left. */
  status?: ReactNode;
  className?: string;
};

/**
 * The action row at the end of a form that genuinely commits manually — a `/new` page or a
 * line-item document (R1). Every other form footer disappears with autosave.
 *
 * The top border is the one §1.3 allows: it separates the actions from scrolling content,
 * which is a separation rather than a grouping. What it no longer does is `position: sticky`
 * — that was ten implementations on three recipes, one of them a verbatim copy of this
 * component's class string (R3).
 */
export function FormFooter({ children, status, className }: FormFooterProps) {
  return (
    <div
      data-slot="form-footer"
      className={cn(
        "flex flex-col gap-3 border-t border-line-default pt-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 text-sm text-copy-muted">{status}</div>
      <ActionBar size="default">{children}</ActionBar>
    </div>
  );
}
