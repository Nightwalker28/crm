"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * One owner for a page's address (rebuild.md 5.5, generalised in 5.6 batch 5).
 *
 * On a list, `useSavedViews` writes the draft view — search, filters, sort, columns — and
 * `usePagedList` writes the page and page size. Two hooks, one URL, and if each held its
 * own copy of the query string the later `replace` in a tick would drop the earlier one's
 * param. So neither hook touches the router: they both call `updateAddress`, which reads
 * `window.location.search` at call time rather than from a captured render, applies the
 * mutation, and replaces. Concurrent writers commute.
 *
 * It was `useListAddress`, and the name was already wrong by the time settings needed it:
 * nothing in here is about a list. Settings pages address a selection (`?module=`) and a
 * workspace (`?tab=`) through the same single writer, so the app has one place that writes
 * the query string rather than a second idiom per archetype.
 *
 * **One `updateAddress` per gesture.** `router.replace` is async, so `window.location.search`
 * has not moved by the time a second synchronous call reads it — a handler that changes two
 * params changes them in one mutation, not two calls.
 *
 * `replace`, never `push`: typing in a search box must not fill the back stack with one
 * entry per keystroke. Back still leaves the page, which is the gesture A1 is about, and
 * the state is on the entry the page was left from because it was in the address.
 *
 * `scroll: false` because the row the operator is reading must not jump to the top when a
 * filter changes.
 */
export function usePageAddress(enabled = true) {
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
