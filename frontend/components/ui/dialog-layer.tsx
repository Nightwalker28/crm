"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Tracks whether a dialog layer is covered by another dialog above it.
 *
 * Confirmations are rendered by a global provider, so they are siblings of the editor dialog or
 * sheet that triggered them rather than children of it. Neither Radix nor Headless UI can infer
 * that ordering on its own, which leaves the covered layer focusable and in the accessibility
 * tree — two "Cancel" buttons reachable at once.
 *
 * A covered layer reads this and yields: it drops its focus trap and leaves the accessibility
 * tree so the topmost dialog owns focus. Forcing `inert` onto it from the outside instead makes
 * the two focus traps fight each other.
 */
const DialogLayerCoveredContext = createContext(false);

export function DialogLayerCoveredProvider({
  covered,
  children,
}: {
  covered: boolean;
  children: ReactNode;
}) {
  return (
    <DialogLayerCoveredContext.Provider value={covered}>{children}</DialogLayerCoveredContext.Provider>
  );
}

export function useDialogLayerCovered() {
  return useContext(DialogLayerCoveredContext);
}
