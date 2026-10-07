"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

/**
 * Dependent picklists (13b §3.6): a controlling field's value limits a dependent field's
 * values. Field keys are standard columns or `custom:<key>`. A controlling value missing from
 * the map, or an empty controlling field, allows no dependent value (Salesforce's rule); the
 * server refuses the same pairs.
 */
export type PicklistDependency = {
  id: number;
  module_key: string;
  controlling_field_key: string;
  dependent_field_key: string;
  value_map: Record<string, string[]>;
};

export function picklistDependenciesQueryKey(moduleKey: string) {
  return ["picklist-dependencies", moduleKey] as const;
}

export function usePicklistDependencies(moduleKey: string | null | undefined) {
  const query = useQuery({
    queryKey: picklistDependenciesQueryKey(moduleKey ?? ""),
    queryFn: async (): Promise<PicklistDependency[]> => {
      const res = await apiFetch(`/picklists/dependencies/${encodeURIComponent(moduleKey ?? "")}`);
      if (!res.ok) throw new Error("Field dependencies could not be loaded.");
      return ((await res.json()) as { results: PicklistDependency[] }).results;
    },
    enabled: Boolean(moduleKey),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const byDependent = useMemo(
    () => new Map((query.data ?? []).map((dependency) => [dependency.dependent_field_key, dependency])),
    [query.data],
  );
  return { dependencies: query.data ?? [], byDependent };
}

/**
 * The value keys a dependent field may take, given the record's current values — or `null`
 * when the field depends on nothing. `values` is keyed like the dependency's field keys.
 */
export function allowedDependentKeys(
  byDependent: Map<string, PicklistDependency>,
  fieldKey: string,
  values: Record<string, unknown>,
): string[] | null {
  const dependency = byDependent.get(fieldKey);
  if (!dependency) return null;
  const controlling = values[dependency.controlling_field_key];
  if (typeof controlling !== "string" || !controlling) return [];
  return dependency.value_map[controlling] ?? [];
}
