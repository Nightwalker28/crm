"use client";

import type { FormEvent, ReactNode } from "react";
import { X } from "lucide-react";

import { FormFooter } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const panelWidths = {
  /** A single-column form. The width `RecordSpine` and `QuickCreateSurface` already agreed on. */
  default: "sm:max-w-[36rem]",
  /** A body holding a grid or a repeating multi-column row. */
  wide: "sm:max-w-[42rem]",
} as const;

type EditorPanelProps = {
  open: boolean;
  /**
   * The one dismissal path. Escape, the overlay and the close button all arrive here, so a
   * panel holding a draft asks for its discard confirmation in a single place.
   */
  onOpenChange: (open: boolean) => void;
  /** The panel's name — `Edit booking link`, `Configure backups`. */
  title: ReactNode;
  /** What the panel edits. Omit only when the title genuinely says everything. */
  description?: ReactNode;
  /** `aria-label` for the close button. Names *this* panel, not "the dialog". */
  closeLabel: string;
  size?: keyof typeof panelWidths;
  children: ReactNode;
  /**
   * Cancel and the commit. `FormFooter` supplies the `ActionBar`, so R4's height holds.
   * Omitted on a read-only panel, which then has nothing to commit.
   */
  footer?: ReactNode;
  /** The dirty line or an error, left of the actions. Prose, not a status (§7.11). */
  status?: ReactNode;
  /**
   * Makes the panel body a `<form>`, so Enter commits. The handler is called with the
   * event already `preventDefault`ed.
   */
  onSubmit?: () => void;
  className?: string;
};

/**
 * The editing drawer over a page (§7.11).
 *
 * `dialog.tsx` was given a styled panel and a closed size set in rebuild 5.1 and `sheet.tsx`
 * was not, so twelve call sites re-typed thirty lines of portal, overlay, header, scroll
 * body and footer — and drifted on every axis left to them: three widths chosen for no
 * stated reason, two inks for the same description, and a dirty line painted
 * `text-state-warning` / `text-state-success`, which is colour carrying *unsaved* (§1.2).
 *
 * The body is the only slot. Everything a call site was previously free to get wrong — the
 * scroll container's `min-h-0`, the close button's accessible name, which of the three
 * dismissal gestures runs the guard — is drawn here once.
 */
export function EditorPanel({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  size = "default",
  children,
  footer,
  status,
  onSubmit,
  className,
}: EditorPanelProps) {
  // `min-h-0` on the flex child is what lets the body scroll instead of the panel growing
  // past the viewport — the single most-copied line of the recipe, and the one a call site
  // could silently omit.
  const bodyClassName = "flex min-h-0 flex-1 flex-col";

  const body = (
    <>
      <SheetHeader className="flex items-start justify-between gap-4 border-b border-line-default px-5 py-4">
        <div className="min-w-0">
          <SheetTitle className="text-lg font-semibold text-copy-primary">{title}</SheetTitle>
          {description ? (
            <SheetDescription className="mt-1 text-p-sm text-copy-muted">{description}</SheetDescription>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={closeLabel}
          onClick={() => onOpenChange(false)}
        >
          <X />
        </Button>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

      {footer ? (
        // R3: not sticky. The footer is pinned by the flex column, which is a layout rather
        // than a bar floating over content — and it is `FormFooter`, so the panel's two
        // rules are one ink and the actions inherit R4's height.
        <FormFooter status={status} className="bg-surface px-5 py-4">
          {footer}
        </FormFooter>
      ) : null}
    </>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPortal>
        <SheetOverlay className="fixed inset-0 z-40 bg-overlay" />
        <SheetContent
          side="right"
          className={cn(
            "z-50 flex h-dvh w-full max-w-none flex-col bg-surface-raised outline-none",
            "sm:border-l sm:border-line-default",
            panelWidths[size],
            className,
          )}
        >
          {onSubmit ? (
            <form
              className={bodyClassName}
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                onSubmit();
              }}
            >
              {body}
            </form>
          ) : (
            <div className={bodyClassName}>{body}</div>
          )}
        </SheetContent>
      </SheetPortal>
    </Sheet>
  );
}
