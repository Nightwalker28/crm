"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export type ModuleFieldSource = "system" | "custom_field" | "custom_module";

export type ModuleFieldConfig = {
  id?: number | null;
  module_key: string;
  field_key: string;
  label: string;
  field_type?: string | null;
  field_source: ModuleFieldSource | string;
  is_enabled: boolean;
  is_protected: boolean;
  sort_order: number;
};

export type ModuleFieldConfigPayload = {
  label?: string;
  field_type?: string | null;
  field_source?: ModuleFieldSource | string;
  is_enabled?: boolean;
  is_protected?: boolean;
  sort_order?: number;
};

const MODULE_PROTECTED_FIELD_KEYS: Record<string, Set<string>> = {
  sales_leads: new Set(["primary_email"]),
  sales_contacts: new Set(["primary_email"]),
  sales_organizations: new Set(["org_name", "primary_email"]),
  sales_opportunities: new Set(["opportunity_name"]),
  sales_quotes: new Set(["quote_number", "customer_name"]),
  finance_io: new Set(["io_number", "customer_name"]),
};

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Request failed with ${res.status}`);
  }
  return res.json();
}

export function isProtectedFieldKey(fieldKey: string, moduleKey?: string) {
  const normalized = fieldKey.startsWith("custom:") ? fieldKey.slice("custom:".length) : fieldKey;
  return (
    ["id", "record_id", "primary_key", "uuid", "key", "title", "name"].includes(normalized) ||
    (moduleKey ? MODULE_PROTECTED_FIELD_KEYS[moduleKey]?.has(normalized) : false) ||
    normalized.endsWith("_id") ||
    normalized.endsWith("_key")
  );
}

export function isModuleFieldEnabled(fields: ModuleFieldConfig[], fieldKey: string) {
  const config = fields.find((field) => field.field_key === fieldKey);
  return config ? config.is_protected || config.is_enabled : true;
}

export function pickEnabledModulePayload<T extends Record<string, unknown>>(
  payload: T,
  fields: ModuleFieldConfig[],
  alwaysInclude: string[] = [],
) {
  const forced = new Set(alwaysInclude);
  return Object.fromEntries(
    Object.entries(payload).filter(([fieldKey]) => forced.has(fieldKey) || isModuleFieldEnabled(fields, fieldKey)),
  ) as Partial<T>;
}

export function useModuleFieldConfigs(moduleKey: string, admin = false, enabled = true) {
  const queryClient = useQueryClient();
  const basePath = admin ? "/admin/module-fields" : "/module-fields";

  const query = useQuery({
    queryKey: [admin ? "admin-module-fields" : "module-fields", moduleKey],
    queryFn: async () => parseJson<ModuleFieldConfig[]>(await apiFetch(`${basePath}/${moduleKey}`)),
    enabled: Boolean(moduleKey) && enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const updateField = useMutation({
    mutationFn: async ({ fieldKey, payload }: { fieldKey: string; payload: ModuleFieldConfigPayload }) =>
      parseJson<ModuleFieldConfig>(
        await apiFetch(`${basePath}/${moduleKey}/${encodeURIComponent(fieldKey)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["module-fields", moduleKey] }),
        queryClient.invalidateQueries({ queryKey: ["admin-module-fields", moduleKey] }),
        queryClient.invalidateQueries({ queryKey: ["saved-views", moduleKey] }),
        queryClient.invalidateQueries({ queryKey: ["table-preferences", moduleKey] }),
      ]);
    },
  });

  return {
    fields: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    updateField: updateField.mutateAsync,
    isSaving: updateField.isPending,
    refresh: query.refetch,
  };
}
