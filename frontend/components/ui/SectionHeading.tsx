import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type SectionHeadingProps = {
  children: ReactNode;
  /**
   * The heading level. Defaults to `h2` because a section heading sits under the surface
   * title, which `PageShell` has already emitted as the page's one `h1` (design.md 8).
   */
  as?: "h2" | "h3" | "h4";
  /** Wraps at reading length, so it takes a prose token rather than `text-xs` (3.3). */
  description?: ReactNode;
  /** Trailing action for the section — a "Add task", a filter, a count. */
  action?: ReactNode;
  /** A group marker above the heading. `text-2xs font-semibold text-copy-label` (3.3). */
  eyebrow?: ReactNode;
  className?: string;
};

/**
 * The named group inside a surface.
 *
 * 137 hand-written `<h2>`s carried one role at four sizes — `text-lg` x45, `text-base` x41,
 * `text-sm` x17 and bare `font-semibold` x16 — because no primitive supplied the answer and a
 * step that reads as almost-the-same gets picked whenever neither neighbour feels right.
 *
 * The role is fixed by design.md 3.3 (R7): **14px, semibold, `text-copy-label`**. That is one
 * ink step *quieter* than the values underneath it, and the inversion is the ruling rather
 * than a side effect — on a record page the operator came for *Jane Doe*, not for the words
 * *Contact details*. Heading and value differ on weight and ink and on neither size, which is
 * a stronger signal than the 2px it replaces and costs no vertical space.
 *
 * There is deliberately **no size or tone prop**. A section heading that needed to be louder
 * was the drift; if a heading is the only content on its surface it is a surface title or a
 * state title, and those are `PageShell` and `EmptyState`, not this.
 */
export function SectionHeading({
  children,
  as: Heading = "h2",
  description,
  action,
  eyebrow,
  className,
}: SectionHeadingProps) {
  return (
    <div
      data-slot="section-heading"
      className={cn("flex flex-wrap items-start justify-between gap-3", className)}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-1 text-2xs font-semibold text-copy-label">{eyebrow}</div>
        ) : null}
        <Heading className="text-sm font-semibold text-copy-label">{children}</Heading>
        {description ? (
          <p className="mt-1 text-p-sm text-copy-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
