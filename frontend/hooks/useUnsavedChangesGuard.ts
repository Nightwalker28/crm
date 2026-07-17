"use client";

import { useEffect } from "react";

const UNSAVED_MESSAGE = "You have unsaved changes. Leave this page and discard them?";

export function useUnsavedChangesGuard(isDirty: boolean, disabled = false) {
  useEffect(() => {
    if (!isDirty || disabled) return;

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    function guardInAppNavigation(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement) || target.target === "_blank" || target.hasAttribute("download")) return;

      const destination = new URL(target.href, window.location.href);
      const current = new URL(window.location.href);
      if (destination.origin !== current.origin || (destination.pathname === current.pathname && destination.search === current.search)) return;
      if (window.confirm(UNSAVED_MESSAGE)) return;

      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", guardInAppNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", guardInAppNavigation, true);
    };
  }, [disabled, isDirty]);
}
