"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

import { PicklistField } from "@/components/picklists/PicklistSelect";
import { Button } from "@/components/ui/button";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Dialog, DialogBackdrop, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";

/**
 * Moving a deal into a lost stage records why (13a H13). The stage stays the one control for
 * a deal's outcome (design.md §4.7) — the rail, the board and the form all move it — and this
 * asks for the reason on the way in. Resolves the reason's key, or `null` when cancelled.
 */
export function useLostReasonPrompt(): { askLostReason: (dealName?: string) => Promise<string | null>; lostReasonDialog: ReactNode } {
  const [request, setRequest] = useState<{ dealName?: string } | null>(null);
  const [reason, setReason] = useState("");
  const resolver = useRef<((value: string | null) => void) | null>(null);

  const askLostReason = useCallback((dealName?: string) => {
    resolver.current?.(null);
    setReason("");
    setRequest({ dealName });
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function finish(value: string | null) {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
  }

  const lostReasonDialog = (
    <Dialog open={request !== null} onClose={() => finish(null)}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel size="md" className="rounded-[var(--radius-dialog)] border-line-default bg-surface-raised">
          <DialogHeader>
            <DialogTitle>Mark deal lost</DialogTitle>
            <DialogIconClose />
          </DialogHeader>
          <DialogDescription className="mt-1 text-copy-secondary">
            {request?.dealName ? `Why was ${request.dealName} lost?` : "Why was this deal lost?"}
          </DialogDescription>
          <form
            className="mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (reason) finish(reason);
            }}
          >
            <FieldGroup>
              <PicklistField id="deal-lost-reason" listKey="lost_reason" label="Lost reason" value={reason} onChange={setReason} required />
            </FieldGroup>
            <DialogFooter className="mt-6">
              <Button type="button" variant="ghost" onClick={() => finish(null)}>Cancel</Button>
              <Button type="submit" disabled={!reason}>Mark lost</Button>
            </DialogFooter>
          </form>
        </DialogPanel>
      </div>
    </Dialog>
  );

  return { askLostReason, lostReasonDialog };
}
