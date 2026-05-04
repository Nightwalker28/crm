"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export type CustomFieldDefinition = {
  id: number;
  module_key: string;
  field_key: string;
  label: string;
  field_type: "text" | "long_text" | "number" | "date" | "boolean";
  placeholder?: string | null;
  help_text?: string | null;
  is_required: boolean;
  is_active: boolean;
  sort_order: number;
};

async function fetchModuleCustomFields(moduleKey: string): Promise<CustomFieldDefinition[]> {
  const res = await apiFetch(`/custom-fields/${moduleKey}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
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
