"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { StatusDescriptor, StatusTone } from "@/lib/statusStyles";

/**
 * Tenant-managed picklists (13b §3.1). Records store a value's key; forms, filters and list
 * cells read the label, tone and meaning from here. One request serves every list, cached
 * for the session and refreshed when Settings → Picklists changes one.
 */

export type PicklistValue = {
  key: string;
  label: string;
  position: number;
  is_active: boolean;
  is_default: boolean;
  tone: StatusTone | null;
  meaning: string | null;
};

export type Picklist = {
  id: number;
  key: string;
  label: string;
  scope: "global" | "local";
  meaning_set: string | null;
  meanings: string[];
  is_system: boolean;
  is_locked: boolean;
  used_by: { module_key: string; field_key: string; label: string }[];
  values: PicklistValue[];
};

export const PICKLISTS_QUERY_KEY = ["picklists"] as const;

async function fetchPicklists(): Promise<Picklist[]> {
  const res = await apiFetch("/picklists");
  if (!res.ok) throw new Error("Value lists could not be loaded.");
  const body = (await res.json()) as { results: Picklist[] };
  return body.results;
}

export function usePicklists() {
  const query = useQuery({
    queryKey: PICKLISTS_QUERY_KEY,
    queryFn: fetchPicklists,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const byKey = useMemo(() => new Map((query.data ?? []).map((list) => [list.key, list])), [query.data]);
  return { ...query, byKey };
}

export function usePicklist(listKey: string | null | undefined) {
  const { byKey, isLoading, error } = usePicklists();
  const picklist = listKey ? byKey.get(listKey) ?? null : null;
  return { picklist, isLoading, error };
}

/** Drops the cached lists, after an admin change. */
export function useInvalidatePicklists() {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: PICKLISTS_QUERY_KEY }), [client]);
}

export function picklistValue(picklist: Picklist | null | undefined, key: string | null | undefined): PicklistValue | null {
  if (!picklist || !key) return null;
  return picklist.values.find((value) => value.key === key) ?? null;
}

/** A stored key's label: the value's label, else the key itself (a value not in the list). */
export function picklistLabel(picklist: Picklist | null | undefined, key: string | null | undefined): string | null {
  if (!key) return null;
  return picklistValue(picklist, key)?.label ?? key;
}

/**
 * The options a form offers: active values in list order, plus the record's current value
 * when it has been switched off (it stays on the record until someone changes it).
 */
export function picklistOptions(picklist: Picklist | null | undefined, current?: string | null) {
  if (!picklist) return [];
  return picklist.values
    .filter((value) => value.is_active || value.key === current)
    .map((value) => ({ value: value.key, label: value.is_active ? value.label : `${value.label} (no longer used)` }));
}

/** Every value, for filters: a view may need to find records holding a retired value. */
export function picklistFilterOptions(picklist: Picklist | null | undefined) {
  if (!picklist) return [];
  return picklist.values.map((value) => ({ value: value.key, label: value.label }));
}

export function picklistDefault(picklist: Picklist | null | undefined): string {
  return picklist?.values.find((value) => value.is_default && value.is_active)?.key ?? "";
}

/**
 * A logic-bearing value as a status (lead status): its label, and the tone the admin gave it.
 * A value without a tone reads as neutral, which `StatusValue` draws as plain ink.
 */
export function picklistStatus(picklist: Picklist | null | undefined, key: string | null | undefined): StatusDescriptor {
  const value = picklistValue(picklist, key);
  return { tone: value?.tone ?? "neutral", label: value?.label ?? (key || "Unknown") };
}

export function picklistMeaning(picklist: Picklist | null | undefined, key: string | null | undefined): string | null {
  return picklistValue(picklist, key)?.meaning ?? null;
}
