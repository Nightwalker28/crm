import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The "we could not save this" banner at the top of a form (design.md §7.5).
 *
 * Twelve form routes had hand-written this exact markup and two more showed only a toast.
 * A toast is the wrong instrument for a save failure on its own: it is transient, it is not
 * in the tab order, and it has usually gone by the time the operator has finished reading
 * the field it was about.
 *
 * `title` names what failed in the product's own words; `children` carries the recoverable
 * detail. Neither ever carries the backend's message — that is the redaction rule the
 * `*-revamp` specs assert on every module.
 */
export function FormErrorBanner({
  title,
  children,
  className,
}: {
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      data-slot="form-error-banner"
      className={cn(
        "rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary",
        className,
      )}
    >
      <div className="font-medium">{title}</div>
      {children ? <div className="mt-1 text-copy-secondary">{children}</div> : null}
    </div>
  );
}
