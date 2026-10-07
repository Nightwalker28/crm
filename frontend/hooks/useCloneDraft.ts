"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { apiErrorFromResponse } from "@/lib/apiErrors";

/**
 * What a new record copies from an existing one (13b Phase 5, F3.8): the editable header,
 * custom fields and lines; never numbers, statuses, totals or history. The server decides
 * (`GET /records/{module}/{id}/clone-draft`); the form saves it as an ordinary create.
 */
export type CloneDraft = {
  module_key: string;
  source_id: number;
  fields: Record<string, unknown>;
  custom_fields: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
};

/** The `?clone=<id>` a module's `new` page opens with. */
export const CLONE_PARAM = "clone";

/** `<new page>?clone=<id>`: where *Clone* on a record goes. */
export function cloneHref(newPageHref: string, recordId: string | number) {
  return `${newPageHref}?${CLONE_PARAM}=${encodeURIComponent(String(recordId))}`;
}

/**
 * The draft for the `?clone=` the page was opened with. `cloneId` is null on a plain create,
 * and the query never runs; a page waits on `isLoading` before seeding its form, so the
 * form's starting point (and its unsaved-changes check) is the copy.
 */
export function useCloneDraft(moduleKey: string, enabled = true) {
  const cloneId = useSearchParams().get(CLONE_PARAM);
  const active = enabled && Boolean(cloneId);
  const query = useQuery({
    queryKey: ["clone-draft", moduleKey, cloneId],
    queryFn: async (): Promise<CloneDraft> => {
      const res = await apiFetch(`/records/${encodeURIComponent(moduleKey)}/${encodeURIComponent(cloneId as string)}/clone-draft`);
      if (!res.ok) throw await apiErrorFromResponse(res, "We could not copy this record.");
      return res.json();
    },
    enabled: active,
    // A copy is taken once, when the page opens; refetching would reset the user's edits.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return {
    cloneId: active ? cloneId : null,
    draft: active ? query.data ?? null : null,
    isLoading: active && query.isLoading,
    error: active ? query.error : null,
    refetch: query.refetch,
  };
}

