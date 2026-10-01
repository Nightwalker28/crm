"use client";

import { useCallback } from "react";

import { usePageAddress } from "@/hooks/usePageAddress";
import { LIST_ADDRESS_KEYS } from "@/lib/savedViewQuery";

/**
 * A list's display mode, held in `?display=` (rebuild 5.7 ruling 7, design.md §7.13).
 *
 * `tasks` and `sales/opportunities` kept list / board / calendar and table / pipeline in
 * component state, so a reload or a shared link dropped the operator back on the table. The
 * address is the state now. The first mode is the default and is never written, so the plain
 * route stays the plain route; an unknown value reads as the default rather than as an error.
 */
export function useListDisplay<const Mode extends string>(modes: readonly [Mode, ...Mode[]]) {
  const { params, updateAddress } = usePageAddress();
  const [fallback] = modes;
  const requested = params.get(LIST_ADDRESS_KEYS.display);
  const display = (modes as readonly string[]).includes(requested ?? "") ? (requested as Mode) : fallback;

  const setDisplay = useCallback(
    (next: Mode) => {
      updateAddress((address) => {
        if (next === fallback) address.delete(LIST_ADDRESS_KEYS.display);
        else address.set(LIST_ADDRESS_KEYS.display, next);
      });
    },
    [fallback, updateAddress],
  );

  return [display, setDisplay] as const;
}
