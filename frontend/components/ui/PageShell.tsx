"use client";

import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
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
 * - `record` — archetype 2's full-height column, on the same mechanism as `list`: the
 *   header row is pinned and the spine and content region split what is left, so the
 *   content region is the only scroller (R9). The height only applies from `lg`, because
 *   below it the rail stacks and the page deliberately reverts to a document scroll.
 * - `document` — a scrolling form or detail page at the documented section stack.
 * - `settings` — the same, at the wider settings stack.
 */
const pageShellVariants = cva("flex min-w-0 flex-col", {
  variants: {
    variant: {
      list: "h-full min-h-0 gap-4",
      record: "gap-4 lg:h-full lg:min-h-0",
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

  /**
   * The §7.4 states, in the order the operator can act on them. A page opts out of one by
   * supplying its own slot; it does not opt out by omitting it.
   *
   * These are here rather than per page because when each page had to remember them, most
   * did not — `PermissionDeniedState` reached 1 of 23 settings pages and 7 settings pages
   * carried no error state at all. A page that renders its own loading skeleton inside the
   * content (a table, a list) leaves these unset and keeps doing that; these are for the
   * whole-route case, where the page has nothing to show yet.
   */
  isPermissionDenied?: boolean;
  permissionDeniedState?: ReactNode;
  isLoading?: boolean;
  loadingState?: ReactNode;
  hasError?: boolean;
  errorState?: ReactNode;
  /** Wired to the error state's "Try again". Without it the state offers only the back link. */
  onRetry?: () => void;
  /** Names the fix, not the failure (§7.5). Defaults to a retry-and-connection line. */
  errorDescription?: string;
  /** Where the error and permission-denied states send the operator back to. */
  backHref?: string;
  backLabel?: string;
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
  isPermissionDenied = false,
  permissionDeniedState,
  isLoading = false,
  loadingState,
  hasError = false,
  errorState,
  onRetry,
  errorDescription,
  backHref,
  backLabel,
}: PageShellProps) {
  // Denied, then loading, then failed — the order the operator can act on them. A page
  // whose permission check is still in flight must not claim `isPermissionDenied` yet, or
  // it flashes a wall before the answer arrives.
  const state = isPermissionDenied
    ? (permissionDeniedState ?? (
        <PermissionDeniedState
          titleAs="p"
          description={`Ask an administrator for access to ${title.toLocaleLowerCase()}.`}
          {...(backHref ? { backHref } : {})}
          {...(backLabel ? { backLabel } : {})}
        />
      ))
    : isLoading
      ? (loadingState ?? <RouteLoadingState label={title.toLocaleLowerCase()} />)
      : hasError
        ? (errorState ?? (
            <RouteErrorState
              titleAs="p"
              title={`${title} could not be loaded`}
              description={errorDescription ?? "Check your connection and try again."}
              reset={() => onRetry?.()}
              {...(backHref ? { backHref } : {})}
              {...(backLabel ? { backLabel } : {})}
            />
          ))
        : null;

  return (
    <div
      data-slot="page-shell"
      data-variant={variant ?? "document"}
      // A state replaces the page's content, and a full-height list column would stretch
      // it against a pinned toolbar that is no longer there. Scroll it as a document.
      className={cn(pageShellVariants({ variant: state ? "document" : variant }), className)}
    >
      <PageHeader
        title={title}
        description={description}
        eyebrow={eyebrow}
        context={state ? undefined : context}
        // An action row over a permission wall or a failed load offers work the operator
        // cannot do. The heading stays; the buttons go.
        actions={state ? undefined : actions}
        className={headerClassName}
      />
      {state ?? children}
    </div>
  );
}

export { pageShellVariants };
