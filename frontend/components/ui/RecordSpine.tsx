"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, History } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyValue } from "@/components/ui/EmptyValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * The record's spine — archetype 2's signature (R9), and the only editable region on the
 * page.
 *
 * A left rail on a CRM is ordinary. A left rail that *is* the editable surface of the
 * record is not, and that is the whole reason this was chosen over the two alternatives in
 * `rebuild.md` 5.0: R2 draws a categorical boundary between state and content and then
 * names its own risk — a half-editable page where nothing signals what is clickable is
 * worse than either pure model. Position answers that where a convention cannot, because a
 * control that drifts out of the rail is *visibly* in the wrong place.
 *
 * What "editable" means here is narrower than it sounds, and §4.7 carries the test: the
 * spine owns the record's own fields, while related objects — tasks, files, notes, logged
 * interactions — are records in their own right and keep their affordances in the content
 * region. Does the control write a column on this row, or create a row pointing at it?
 *
 * The rail is a flex sibling of the content region rather than `position: sticky`, so it
 * adds no exception to R3 and no second scroller (§4.5). Below `lg` it stacks above the
 * content and the page reverts to a document scroll — the deliberate fallback of a desktop
 * product, not a responsive feature.
 */
export function RecordSpine({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside
      data-slot="record-spine"
      aria-label="Record state and relationships"
      className={cn("flex w-full shrink-0 flex-col gap-6 lg:w-80", className)}
    >
      {children}
    </aside>
  );
}

/**
 * A named cluster in the rail — State, Connected, or a module's own.
 *
 * An ink group, never a box: §1.3 earns a border by interactivity or by separation, and a
 * heading over a short list of fields is neither. The heading is R7's section role, which
 * sits one ink step *quieter* than the values under it.
 */
export function RecordSpineBlock({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section data-slot="record-spine-block" className={cn("grid gap-3", className)}>
      <SectionHeading action={action}>{title}</SectionHeading>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

/**
 * One field in the rail: a label, and either an `InlineFieldEdit` or a read-only value.
 *
 * The two look deliberately alike. `InlineFieldEdit` renders its closed value through the
 * same `StatusValue` a read-only status uses, so a field is not visibly "a control" until
 * the operator notices R6's always-present chevron — which is the point. A hover-only
 * affordance would be invisible until pointed at, and invisible to anyone on a keyboard.
 */
export function RecordSpineField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="record-spine-field" className={cn("min-w-0", className)}>
      <div className="text-xs font-medium text-copy-label">{label}</div>
      <div className="mt-1 text-sm text-copy-primary">{children}</div>
    </div>
  );
}

/**
 * A Connected entry: the record this one points at, as a link.
 *
 * Relationships are *content* under R2, so the spine displays them and `/[id]/edit` changes
 * them — which is why this is an anchor rather than `LinkedRecordPicker`. The census
 * anticipated a "link-display mode" on the picker; a 389-line combobox growing a read-only
 * mode to render one link is the wrong direction, so the display role lives with the block
 * that needs it.
 *
 * Unlinked is not an error and not a disabled state — the relationship simply has no value
 * yet (§2.1), so it reads as `EmptyValue` and draws no chevron to click.
 */
export function RecordSpineLink({
  label,
  value,
  href,
  className,
}: {
  label: string;
  value?: ReactNode;
  href?: string | null;
  className?: string;
}) {
  const hasValue = value !== null && value !== undefined && value !== "";

  return (
    <div data-slot="record-spine-link" className={cn("min-w-0", className)}>
      <div className="text-xs font-medium text-copy-label">{label}</div>
      {href && hasValue ? (
        <Link
          href={href}
          className={cn(
            "-mx-2 mt-1 flex items-center justify-between gap-2 rounded-[var(--radius-control)] px-2 py-1",
            "text-sm text-copy-primary transition-colors hover:bg-surface-muted",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          )}
        >
          <span className="truncate">{value}</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-copy-muted" aria-hidden="true" />
        </Link>
      ) : (
        <div className="mt-1 text-sm text-copy-primary">
          {hasValue ? value : <EmptyValue context="field" />}
        </div>
      )}
    </div>
  );
}

/**
 * A Connected entry for a *collection* rather than a record: how many, and the way to them.
 *
 * The pre-5.3 relationship rail carried these as a grid of ink tiles — `Open deals 3`,
 * `Quotes 2` — which put the rail's densest region out of reach: the operator learns the
 * account has six invoices and has nowhere to click. §4.7 makes both Connected shapes
 * links for that reason. The count is the glance; the module tab is the answer.
 *
 * Zero is a real answer and stays legible rather than reading as missing — an account with
 * no quotes is not an account whose quotes failed to load (§2.1) — but it draws no link,
 * because a list of nothing is not worth the trip.
 */
export function RecordSpineCollection({
  label,
  count,
  href,
  className,
}: {
  label: string;
  count: number;
  href?: string | null;
  className?: string;
}) {
  const content = (
    <>
      <span className="truncate text-copy-secondary">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        <span className="tabular-nums text-copy-primary">{count}</span>
        {href && count > 0 ? (
          <ChevronRight className="h-4 w-4 text-copy-muted" aria-hidden="true" />
        ) : null}
      </span>
    </>
  );

  return (
    <div data-slot="record-spine-collection" className={cn("min-w-0 text-sm", className)}>
      {href && count > 0 ? (
        <Link
          href={href}
          className={cn(
            "-mx-2 flex items-center justify-between gap-2 rounded-[var(--radius-control)] px-2 py-1",
            "transition-colors hover:bg-surface-muted",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          )}
        >
          {content}
        </Link>
      ) : (
        // The same row geometry minus the interaction, so a zero lines up with the rest of
        // the block instead of stepping out of the column.
        <div className="flex items-center justify-between gap-2 py-1">{content}</div>
      )}
    </div>
  );
}

/**
 * The rail's foot: when the record was created, when it last moved, and the way into its
 * audit history.
 *
 * History is deliberately **not** a fifth tab. It is a reference surface consulted
 * occasionally, and a tab that is always present but rarely opened is furniture competing
 * with three that are opened constantly — none of Salesforce, HubSpot, Pipedrive or
 * Dynamics gives field history a tab beside the timeline either. It is also a genuinely
 * separate store: `record_activity` projects the relationship feed and deliberately
 * excludes `activity_logs`, with a different permission surface, so a merged feed would
 * mean either overturning that or interleaving two cursors client-side.
 *
 * Hanging it off `Updated 2h ago` puts the answer where the question gets asked.
 */
export function RecordSpineMeta({
  createdLabel,
  updatedLabel,
  history,
  historyTitle = "History",
  historyDescription = "Every change recorded against this record.",
  className,
}: {
  createdLabel?: ReactNode;
  updatedLabel?: ReactNode;
  /** The audit timeline. Passed in rather than imported: this is `components/ui`. */
  history?: ReactNode;
  historyTitle?: string;
  historyDescription?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      data-slot="record-spine-meta"
      className={cn("mt-auto grid gap-1 border-t border-line-subtle pt-4", className)}
    >
      {createdLabel ? <div className="text-xs text-copy-muted">{createdLabel}</div> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {updatedLabel ? <div className="text-xs text-copy-muted">{updatedLabel}</div> : null}
        {history ? (
          // `SheetTrigger` rather than an `onClick` that only sets state: Radix restores
          // focus to the element that opened a dialog, and with no trigger registered it has
          // nowhere to put it — closing the sheet dropped focus to the body, so the next Tab
          // restarted at the sidebar instead of the rail. Found by tabbing through, which is
          // the only way it shows up: the sheet opened, closed and read correctly throughout.
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                <History />
                {historyTitle}
              </Button>
            </SheetTrigger>
            <SheetPortal>
              <SheetOverlay className="fixed inset-0 z-40 bg-overlay sm:bg-overlay/60" />
              <SheetContent
                side="right"
                className="z-50 flex h-dvh w-full max-w-none flex-col bg-surface-raised outline-none sm:max-w-[36rem] sm:border-l sm:border-line-default"
              >
                <SheetHeader className="flex min-h-16 items-start justify-between gap-4 border-b border-line-subtle px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <SheetTitle className="text-lg font-semibold text-copy-primary">
                      {historyTitle}
                    </SheetTitle>
                    <SheetDescription className="mt-1 text-p-sm text-copy-muted">
                      {historyDescription}
                    </SheetDescription>
                  </div>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
                  {history}
                </div>
              </SheetContent>
            </SheetPortal>
          </Sheet>
        ) : null}
      </div>
    </div>
  );
}

export type RecordSpineTrackStep = {
  id: string;
  label: string;
};

/**
 * The lifecycle track, for the four record types that have a real pipeline — lead, deal,
 * quote, order. §4.7 makes it optional for exactly that reason: a track over a status set
 * with no direction would be decoration claiming a sequence that does not exist.
 *
 * It reads, it does not write. Advancing a stage is the State block's `InlineFieldEdit`,
 * so the track carries no click target and cannot become a second, quieter control for the
 * same field.
 */
export function RecordSpineTrack({
  steps,
  currentId,
  label = "Lifecycle",
  className,
}: {
  steps: RecordSpineTrackStep[];
  currentId?: string | null;
  label?: string;
  className?: string;
}) {
  const currentIndex = steps.findIndex((step) => step.id === currentId);

  return (
    <div
      data-slot="record-spine-track"
      className={cn("grid gap-2", className)}
      role="img"
      aria-label={
        currentIndex >= 0
          ? `${label}: ${steps[currentIndex]?.label}, step ${currentIndex + 1} of ${steps.length}`
          : label
      }
    >
      <div className="flex items-center gap-1" aria-hidden="true">
        {steps.map((step, index) => (
          <span
            key={step.id}
            className={cn(
              "h-1 flex-1 rounded-full",
              // Reached, current and unreached read as one ink ramp rather than three
              // colours — a pipeline position is not an exception (R5).
              index <= currentIndex && currentIndex >= 0
                ? "bg-copy-primary"
                : "bg-line-default",
            )}
          />
        ))}
      </div>
      <div className="text-xs text-copy-muted" aria-hidden="true">
        {currentIndex >= 0 ? steps[currentIndex]?.label : label}
      </div>
    </div>
  );
}
