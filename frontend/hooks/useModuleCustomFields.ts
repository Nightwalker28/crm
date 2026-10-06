"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

/** A custom field of the one field system (13b §3.4); `field_type` is a `FieldTypeKey`. */
export type CustomFieldDefinition = {
  id: number;
  module_key: string;
  field_key: string;
  label: string;
  field_type: string;
  picklist_key?: string | null;
  lookup_module_key?: string | null;
  config?: Record<string, unknown> | null;
  placeholder?: string | null;
  help_text?: string | null;
  is_required: boolean;
  is_unique?: boolean;
  is_active: boolean;
  sort_order: number;
};

async function fetchModuleCustomFields(moduleKey: string): Promise<CustomFieldDefinition[]> {
  const res = await apiFetch(`/custom-fields/${moduleKey}`);
  if (!res.ok) {
    throw new Error("Custom fields could not be loaded.");
  }
  return res.json();
}

export function useModuleCustomFields(moduleKey: string, enabled = true) {
  return useQuery({
    queryKey: ["custom-fields", moduleKey],
    queryFn: () => fetchModuleCustomFields(moduleKey),
    enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
