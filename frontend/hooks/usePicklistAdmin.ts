"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { ApiError, apiErrorFromResponse, formErrorMessage } from "@/lib/apiErrors";
import type { Picklist, PicklistValue } from "@/hooks/usePicklists";

/** Settings → Picklists (13b §3.1). Administration only; everyone else reads `usePicklists`. */

export type PicklistUsage = { module_key: string; field_key: string; label: string; counts: Record<string, number> };
export type AdminPicklist = Picklist & { usage?: PicklistUsage[] };
export type UnmatchedValue = { value: string; count: number; fields: string[] };
export type PicklistValueChange = Partial<Pick<PicklistValue, "label" | "tone" | "meaning" | "is_active" | "is_default">>;

export const ADMIN_PICKLISTS_QUERY_KEY = ["admin-picklists"] as const;
export const adminPicklistQueryKey = (key: string) => ["admin-picklists", key] as const;
export const unmatchedQueryKey = (key: string) => ["admin-picklists", key, "unmatched"] as const;

/**
 * The sentence to show beside the control that failed. A picklist refusal names its field
 * ("Mumbai is already in Region"), so the field's own message is the useful one, not the
 * "check the highlighted field" banner a form would show.
 */
export function picklistErrorMessage(error: unknown, fallback = "The change could not be saved. Try again."): string {
  if (error instanceof ApiError) {
    const first = Object.values(error.fieldErrors)[0];
    if (first) return first;
  }
  return formErrorMessage(error, fallback);
}

async function send<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const res = await apiFetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) throw await apiErrorFromResponse(res, fallback);
  return (await res.json()) as T;
}

export function useAdminPicklists() {
  return useQuery({
    queryKey: ADMIN_PICKLISTS_QUERY_KEY,
    queryFn: async () => (await send<{ results: AdminPicklist[] }>("/admin/picklists", { method: "GET" }, "Value lists could not be loaded.")).results,
  });
}

export function useAdminPicklist(listKey: string) {
  return useQuery({
    queryKey: adminPicklistQueryKey(listKey),
    queryFn: () => send<AdminPicklist>(`/admin/picklists/${encodeURIComponent(listKey)}`, { method: "GET" }, "The list could not be loaded."),
  });
}

export function useUnmatchedValues(listKey: string) {
  return useQuery({
    queryKey: unmatchedQueryKey(listKey),
    queryFn: async () =>
      (await send<{ results: UnmatchedValue[] }>(`/admin/picklists/${encodeURIComponent(listKey)}/unmatched`, { method: "GET" }, "Stray values could not be loaded.")).results,
  });
}

const path = (listKey: string, rest = "") => `/admin/picklists/${encodeURIComponent(listKey)}${rest}`;

export const createPicklist = (body: { label: string; scope: "global" | "local" }) =>
  send<AdminPicklist>("/admin/picklists", { method: "POST", body: JSON.stringify(body) }, "The list could not be created.");

export const renamePicklist = (listKey: string, label: string) =>
  send<AdminPicklist>(path(listKey), { method: "PATCH", body: JSON.stringify({ label }) }, "The list could not be renamed.");

export const addPicklistValue = (listKey: string, body: { label: string; meaning?: string | null }) =>
  send<AdminPicklist>(path(listKey, "/values"), { method: "POST", body: JSON.stringify(body) }, "The value could not be added.");

export const updatePicklistValue = (listKey: string, valueKey: string, change: PicklistValueChange) =>
  send<AdminPicklist>(
    path(listKey, `/values/${encodeURIComponent(valueKey)}`),
    { method: "PATCH", body: JSON.stringify(change) },
    "The value could not be saved.",
  );

export const reorderPicklistValues = (listKey: string, keys: string[]) =>
  send<AdminPicklist>(path(listKey, "/order"), { method: "PUT", body: JSON.stringify({ keys }) }, "The order could not be saved.");

export const mergePicklistValues = (listKey: string, fromKey: string, intoKey: string) =>
  send<{ picklist: AdminPicklist; moved: { records: number; views: number; rules: number } }>(
    path(listKey, "/merge"),
    { method: "POST", body: JSON.stringify({ from_key: fromKey, into_key: intoKey }) },
    "The values could not be merged.",
  );

export const resolveUnmatchedValue = (listKey: string, value: string, intoKey: string | null) =>
  send<{ picklist: AdminPicklist; moved: { records: number; key: string } }>(
    path(listKey, "/unmatched"),
    { method: "POST", body: JSON.stringify({ value, into_key: intoKey }) },
    "The records could not be moved.",
  );
