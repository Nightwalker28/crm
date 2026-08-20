"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * One owner for the list's address (rebuild.md 5.5).
 *
 * `useSavedViews` writes the draft view — search, filters, sort, columns — and
 * `usePagedList` writes the page and page size. Two hooks, one URL, and if each held its
 * own copy of the query string the later `replace` in a tick would drop the earlier one's
 * param. So neither hook touches the router: they both call `updateAddress`, which reads
 * `window.location.search` at call time rather than from a captured render, applies the
 * mutation, and replaces. Concurrent writers commute.
 *
 * `replace`, never `push`: typing in a search box must not fill the back stack with one
 * entry per keystroke. Back still leaves the list, which is the gesture A1 is about, and
 * the state is on the entry the list was left from because it was in the address.
 *
 * `scroll: false` because the row the operator is reading must not jump to the top when a
 * filter changes.
 */
export function useListAddress(enabled = true) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateAddress = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      if (!enabled || typeof window === "undefined") return;
      const current = window.location.search;
      const next = new URLSearchParams(current);
      mutate(next);
      const nextSearch = next.toString();
      if (nextSearch === current.replace(/^\?/, "")) return;
      router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname, { scroll: false });
    },
    [enabled, pathname, router],
  );

  return { params: searchParams, updateAddress };
}
