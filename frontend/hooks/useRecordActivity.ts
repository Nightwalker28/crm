"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type {
  RecordActivityPage,
  RecordActivityType,
  RecordModuleKey,
} from "@/types/record-activity";

/**
 * Reader for the relationship activity projection
 * (`GET /records/{module_key}/{entity_id}/activity`).
 *
 * The cursor is opaque and must be passed back verbatim. Ordering and
 * tie-breaking are decided by the backend; this hook never re-sorts a page.
 */

export const RECORD_ACTIVITY_PAGE_SIZE = 20;

async function fetchRecordActivityPage({
  moduleKey,
  entityId,
  types,
  cursor,
}: {
  moduleKey: RecordModuleKey;
  entityId: string;
  types: RecordActivityType[] | null;
  cursor: string | null;
}): Promise<RecordActivityPage> {
  const params = new URLSearchParams({ limit: String(RECORD_ACTIVITY_PAGE_SIZE) });
  if (types?.length) params.set("types", types.join(","));
  if (cursor) params.set("cursor", cursor);

  const res = await apiFetch(
    `/records/${encodeURIComponent(moduleKey)}/${encodeURIComponent(entityId)}/activity?${params.toString()}`,
  );
  if (!res.ok) {
    throw new Error("Activity could not be loaded.");
  }
  return (await res.json()) as RecordActivityPage;
}

export function useRecordActivity({
  moduleKey,
  entityId,
  types = null,
  enabled = true,
}: {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  types?: RecordActivityType[] | null;
  enabled?: boolean;
}) {
  const entityKey = String(entityId);
  return useInfiniteQuery({
    queryKey: ["record-activity-feed", moduleKey, entityKey, types?.join(",") ?? "all"],
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchRecordActivityPage({ moduleKey, entityId: entityKey, types, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    staleTime: 30_000,
  });
}

export const recordActivityQueryKeyPrefix = "record-activity-feed";
