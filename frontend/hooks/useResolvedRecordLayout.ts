"use client";

import { useQuery } from "@tanstack/react-query";

import {
  fetchResolvedRecordLayout,
  type RecordLayoutSurface,
} from "@/lib/contracts/recordLayouts";

// The layout types now come from the generated OpenAPI contract by way of the adapter.
// They are re-exported here so existing consumers keep importing from the hook.
export type {
  RecordLayoutFieldSource,
  RecordLayoutRegion,
  RecordLayoutSource,
  RecordLayoutSurface,
  RecordLayoutWidth,
  ResolvedRecordLayout,
  ResolvedRecordLayoutField,
  ResolvedRecordLayoutSection,
} from "@/lib/contracts/recordLayouts";
export { RecordLayoutContractError } from "@/lib/contracts/recordLayouts";

export function useResolvedRecordLayout(
  moduleKey: string,
  surface: RecordLayoutSurface,
  enabled = true,
) {
  return useQuery({
    queryKey: ["record-layout", moduleKey, surface],
    queryFn: () => fetchResolvedRecordLayout(moduleKey, surface),
    enabled: Boolean(moduleKey) && enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
