"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogFooter,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";

type ConfirmVariant = "default" | "destructive";

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
};

type PendingConfirmation = ConfirmOptions & {
  resolve: (confirmed: boolean) => void;
};

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const pendingRef = useRef<PendingConfirmation | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    pendingRef.current?.resolve(confirmed);
    pendingRef.current = null;
    setPending(null);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    pendingRef.current?.resolve(false);

    return new Promise<boolean>((resolve) => {
      const next = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  useEffect(() => {
    return () => {
      pendingRef.current?.resolve(false);
    };
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={Boolean(pending)} onClose={() => settle(false)} className="z-50">
        <DialogBackdrop />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <DialogPanel size="md" className="space-y-5">
            <div className="space-y-2">
              <DialogTitle className="text-base text-neutral-100">{pending?.title}</DialogTitle>
              {pending?.description ? (
                <DialogDescription className="text-sm leading-6 text-neutral-400">
                  {pending.description}
                </DialogDescription>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => settle(false)}>
                {pending?.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                type="button"
                variant={pending?.variant === "destructive" ? "destructive" : "default"}
                onClick={() => settle(true)}
              >
                {pending?.confirmLabel ?? "Confirm"}
              </Button>
            </DialogFooter>
          </DialogPanel>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used within ConfirmProvider.");
  }

  return { confirm };
}
