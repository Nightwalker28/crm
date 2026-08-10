"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export type RecordLayoutSurface = "quick_create" | "detail" | "full_form";
export type RecordLayoutRegion = "main" | "sidebar";
export type RecordLayoutWidth = "full" | "half";

export type ResolvedRecordLayoutField = {
  field_key: string;
  label: string;
  field_type: string;
  field_source: "system" | "custom_field";
  position: number;
  width: RecordLayoutWidth;
  visible: boolean;
  required: boolean;
  readonly: boolean;
  placeholder?: string | null;
  help_text?: string | null;
};

export type ResolvedRecordLayoutSection = {
  id: string;
  label: string;
  position: number;
  region: RecordLayoutRegion;
  collapsed_by_default: boolean;
  fields: ResolvedRecordLayoutField[];
};

export type ResolvedRecordLayout = {
  layout_id?: number | null;
  module_key: string;
  surface: RecordLayoutSurface;
  name: string;
  source: "system" | "tenant";
  version: number;
  can_customize: boolean;
  sections: ResolvedRecordLayoutSection[];
  warnings: string[];
};

async function fetchResolvedRecordLayout(moduleKey: string, surface: RecordLayoutSurface) {
  const response = await apiFetch(
    `/record-layouts/${encodeURIComponent(moduleKey)}/${encodeURIComponent(surface)}/resolved`,
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.detail ?? "The record layout could not be loaded.");
  }
  return body as ResolvedRecordLayout;
}

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
