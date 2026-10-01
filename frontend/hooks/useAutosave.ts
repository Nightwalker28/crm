"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { SaveState } from "@/components/ui/SaveStateIndicator";

/** How long `Saved` stays on screen before the row goes quiet again. */
const SAVED_RESET_MS = 2000;

/**
 * The commit machine behind R1's autosave: `idle → saving → saved → idle`, or `error` with
 * the last attempt kept so the row's Retry has something to re-send.
 *
 * `InlineFieldEdit` grew this inline for the record spine and it is the same machine every
 * autosaving settings control needs, so it is extracted rather than copied into 19 pages —
 * which is how eight editing patterns happened the first time.
 *
 * The write is not debounced here. R1 asks for debouncing on *typed* fields, and a settings
 * control that autosaves is a toggle or a select: one deliberate change, one write. A page
 * autosaving a text input debounces the value before it calls `save`, which keeps the
 * decision at the call site where the field's shape is known.
 */
export function useAutosave<T>(commit: (value: T) => Promise<unknown>) {
  const [state, setState] = useState<SaveState>("idle");
  const pending = useRef<T | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A write that resolves after the operator has navigated away must not set state on an
  // unmounted row.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const save = useCallback(
    async (value: T) => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
      pending.current = value;
      setState("saving");
      try {
        await commit(value);
        if (!mounted.current) return;
        setState("saved");
        resetTimer.current = setTimeout(() => {
          if (mounted.current) setState("idle");
        }, SAVED_RESET_MS);
      } catch {
        // The error is presented by the row, not thrown on: an autosaving control has no
        // caller waiting on it, and an unhandled rejection here would surface as a crash.
        if (mounted.current) setState("error");
      }
    },
    [commit],
  );

  const retry = useCallback(() => {
    if (pending.current === null) return;
    void save(pending.current);
  }, [save]);

  return {
    state,
    save,
    /**
     * Pass to `SettingsRow`'s `onRetry`. Undefined unless a write actually failed — an
     * indicator offering Retry in the `saved` state is offering to re-send nothing.
     */
    retry: state === "error" ? retry : undefined,
    isSaving: state === "saving",
  };
}
