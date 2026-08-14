"use client";

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { LoaderCircle, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
} from "@/components/ui/sheet";

export type QuickCreateOutcome = "create" | "create-and-open";

export type QuickCreateControls = {
  isSubmitting: boolean;
  submit: (outcome?: QuickCreateOutcome) => Promise<void>;
};

export type QuickCreateSurfaceProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode | ((controls: QuickCreateControls) => ReactNode);
  onSubmit: (outcome: QuickCreateOutcome) => Promise<void>;
  onSubmitError?: (error: unknown) => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  isDirty?: boolean;
  isPending?: boolean;
  isLoading?: boolean;
  error?: ReactNode;
  validationSummary?: ReactNode;
  statusMessage?: ReactNode;
  onMoreDetails?: () => void;
  createLabel?: string;
  /**
   * Contextual actions that produce one thing and have nowhere to "open"
   * (sending an email, for example) opt out of the secondary outcome rather
   * than showing a button that cannot mean anything.
   */
  showCreateAndOpen?: boolean;
  createAndOpenLabel?: string;
  moreDetailsLabel?: string;
  pendingLabel?: string;
  submitErrorMessage?: ReactNode;
  discardTitle?: string;
  discardDescription?: string;
};

export function QuickCreateSurface({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  onSubmitError,
  initialFocusRef,
  returnFocusRef,
  isDirty = false,
  isPending = false,
  isLoading = false,
  error,
  validationSummary,
  statusMessage,
  onMoreDetails,
  createLabel = "Create",
  showCreateAndOpen = true,
  createAndOpenLabel = "Create & open",
  moreDetailsLabel = "More details",
  pendingLabel = "Creating...",
  submitErrorMessage = "We could not create this record. Check your entries and try again.",
  discardTitle = "Discard quick create draft?",
  discardDescription = "Your unsaved changes will be lost.",
}: QuickCreateSurfaceProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const submitLockRef = useRef(false);
  const [isSubmittingInternally, setIsSubmittingInternally] = useState(false);
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
  const [internalSubmitError, setInternalSubmitError] = useState<ReactNode>(null);
  const isSubmitting = isPending || isSubmittingInternally;

  useEffect(() => {
    if (!open) {
      setDiscardConfirmationOpen(false);
      setInternalSubmitError(null);
    }
  }, [open]);

  const submit = useCallback(
    async (outcome: QuickCreateOutcome = "create") => {
      if (submitLockRef.current || isPending || isLoading) return;

      submitLockRef.current = true;
      setIsSubmittingInternally(true);
      setInternalSubmitError(null);
      try {
        await onSubmit(outcome);
      } catch (submitError) {
        setInternalSubmitError(submitErrorMessage);
        onSubmitError?.(submitError);
      } finally {
        submitLockRef.current = false;
        setIsSubmittingInternally(false);
      }
    },
    [isLoading, isPending, onSubmit, onSubmitError, submitErrorMessage],
  );

  const requestClose = useCallback(() => {
    if (isSubmitting || discardConfirmationOpen) return;
    if (isDirty) {
      setDiscardConfirmationOpen(true);
      return;
    }
    onOpenChange(false);
  }, [discardConfirmationOpen, isDirty, isSubmitting, onOpenChange]);

  const content =
    typeof children === "function" ? children({ isSubmitting, submit }) : children;

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) onOpenChange(true);
        else requestClose();
      }}
    >
      <SheetPortal>
        <SheetOverlay className="fixed inset-0 z-40 bg-overlay sm:bg-overlay/60" />
        <SheetContent
          ref={panelRef}
          side="right"
          aria-busy={isSubmitting}
          data-quick-create-surface="true"
          className="z-50 flex h-dvh w-full max-w-none flex-col bg-surface-raised outline-none sm:max-w-[36rem] sm:border-l sm:border-line-default"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const target =
              initialFocusRef?.current ??
              panelRef.current?.querySelector<HTMLElement>("[data-quick-create-initial-focus]") ??
              bodyRef.current?.querySelector<HTMLElement>(
                "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
              ) ??
              panelRef.current?.querySelector<HTMLElement>("button:not([disabled])");
            target?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (!returnFocusRef?.current) return;
            event.preventDefault();
            returnFocusRef.current.focus();
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            requestClose();
          }}
          onPointerDownOutside={(event) => {
            event.preventDefault();
            requestClose();
          }}
        >
          <SheetHeader className="flex min-h-16 items-start justify-between gap-4 border-b border-line-subtle px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <SheetTitle className="text-lg font-semibold text-copy-primary">{title}</SheetTitle>
              <SheetDescription className="mt-1 text-p-sm text-copy-muted">
                {description}
              </SheetDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              aria-label={`Close ${title}`}
              disabled={isSubmitting}
              onClick={requestClose}
            >
              <X />
            </Button>
          </SheetHeader>

          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
            {isLoading ? (
              <div role="status" aria-label={`Loading ${title}`} className="grid gap-4">
                <Skeleton className="h-[var(--size-control)] w-full" />
                <Skeleton className="h-[var(--size-control)] w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : (
              <div className="grid gap-4">
                {error ?? internalSubmitError ? (
                  <div
                    role="alert"
                    className="rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary"
                  >
                    {error ?? internalSubmitError}
                  </div>
                ) : null}
                {validationSummary ? (
                  <div
                    role="alert"
                    className="rounded-[var(--radius-control)] border border-state-warning/40 bg-state-warning-muted px-4 py-3 text-sm text-copy-primary"
                  >
                    {validationSummary}
                  </div>
                ) : null}
                {content}
              </div>
            )}
          </div>

          <SheetFooter className="flex flex-col gap-3 border-t border-line-subtle bg-surface px-4 py-3 sm:px-5">
            <div className="min-h-5 text-sm text-copy-muted" role="status" aria-live="polite">
              {isSubmitting ? pendingLabel : statusMessage}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {onMoreDetails ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    disabled={isSubmitting || isLoading}
                    onClick={onMoreDetails}
                    className="w-full sm:w-auto"
                  >
                    {moreDetailsLabel}
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  disabled={isSubmitting}
                  onClick={requestClose}
                >
                  Cancel
                </Button>
                {showCreateAndOpen ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    disabled={isSubmitting || isLoading}
                    onClick={() => void submit("create-and-open")}
                  >
                    {createAndOpenLabel}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="lg"
                  disabled={isSubmitting || isLoading}
                  onClick={() => void submit("create")}
                >
                  {isSubmitting ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
                  {isSubmitting ? pendingLabel : createLabel}
                </Button>
              </div>
            </div>
          </SheetFooter>

          <DialogPrimitive.Root open={discardConfirmationOpen} onOpenChange={setDiscardConfirmationOpen}>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-overlay" />
              <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-dialog)] border border-line-default bg-surface-raised p-5 shadow-[var(--shadow-panel)] outline-none">
                <DialogPrimitive.Title className="text-base font-semibold text-copy-primary">
                  {discardTitle}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-2 text-p-sm text-copy-secondary">
                  {discardDescription}
                </DialogPrimitive.Description>
                <div className="mt-5 flex justify-end gap-2">
                  <Button type="button" variant="outline" size="lg" onClick={() => setDiscardConfirmationOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="lg"
                    onClick={() => {
                      setDiscardConfirmationOpen(false);
                      onOpenChange(false);
                    }}
                  >
                    Discard changes
                  </Button>
                </div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
        </SheetContent>
      </SheetPortal>
    </Sheet>
  );
}
