"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { invalidateModuleCache } from "@/hooks/useAccessibleModules";
import type { PagedListSort } from "@/hooks/usePagedList";
import { apiFetch } from "@/lib/api";

export type CustomFieldType =
  | "text"
  | "textarea"
  | "number"
  | "currency"
  | "date"
  | "datetime"
  | "boolean"
  | "email"
  | "phone"
  | "url"
  | "single_select"
  | "multi_select";

export type CustomModuleField = {
  id: number;
  key: string;
  label: string;
  field_type: CustomFieldType;
  help_text?: string | null;
  placeholder?: string | null;
  is_required: boolean;
  is_unique: boolean;
  display_in_list: boolean;
  default_value?: unknown;
  validation_json?: { options?: string[] } | null;
  sort_order: number;
  is_active: boolean;
  is_protected: boolean;
};

export type CustomModuleDefinition = {
  id: number;
  name: string;
  key: string;
  description?: string | null;
  icon?: string | null;
  is_active: boolean;
  module_id?: number | null;
  base_route?: string | null;
  sidebar_tab_key?: string | null;
  sidebar_tab_label?: string | null;
  display_name?: string | null;
  deleted_at?: string | null;
  fields: CustomModuleField[];
};

export type CustomModuleRecord = {
  id: number;
  custom_module_id: number;
  title: string;
  values: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
};

export type CustomModuleRecordList = {
  results: CustomModuleRecord[];
  total_count: number;
  total_pages: number;
  page: number;
  page_size: number;
};

export type CustomModuleRecordSortState = PagedListSort;

export type CustomModuleFieldPayload = {
  label: string;
  field_type: CustomFieldType;
  help_text?: string | null;
  placeholder?: string | null;
  is_required?: boolean;
  is_unique?: boolean;
  display_in_list?: boolean;
  default_value?: unknown;
  validation_json?: { options?: string[] } | null;
  sort_order?: number;
  is_active?: boolean;
};

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Request failed with ${res.status}`);
  }
  return res.json();
}

export function useModuleBuilder() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["custom-modules"],
    queryFn: async () => parseJson<CustomModuleDefinition[]>(await apiFetch("/module-builder?include_deleted=true")),
    refetchOnWindowFocus: false,
  });

  const createModule = useMutation({
    mutationFn: async (payload: { name: string; key?: string; description?: string; sidebar_tab_key?: string; display_name?: string; fields?: unknown[] }) =>
      parseJson<CustomModuleDefinition>(
        await apiFetch("/module-builder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["custom-modules"] });
      invalidateModuleCache();
    },
  });

  const updateModule = useMutation({
    mutationFn: async ({ moduleId, payload }: { moduleId: number; payload: Partial<Pick<CustomModuleDefinition, "name" | "description" | "icon" | "is_active" | "sidebar_tab_key" | "display_name">> }) =>
      parseJson<CustomModuleDefinition>(
        await apiFetch(`/module-builder/${moduleId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["custom-modules"] });
      invalidateModuleCache();
    },
  });

  const deleteModule = useMutation({
    mutationFn: async (moduleId: number) =>
      parseJson<CustomModuleDefinition>(
        await apiFetch(`/module-builder/${moduleId}`, {
          method: "DELETE",
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["custom-modules"] });
      invalidateModuleCache();
    },
  });

  const restoreModule = useMutation({
    mutationFn: async (moduleId: number) =>
      parseJson<CustomModuleDefinition>(
        await apiFetch(`/module-builder/${moduleId}/restore`, {
          method: "POST",
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["custom-modules"] });
      invalidateModuleCache();
    },
  });

  const addField = useMutation({
    mutationFn: async ({ moduleId, payload }: { moduleId: number; payload: CustomModuleFieldPayload }) =>
      parseJson<CustomModuleDefinition>(
        await apiFetch(`/module-builder/${moduleId}/fields`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      ),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["custom-modules"] }),
  });

  const updateField = useMutation({
    mutationFn: async ({ moduleId, fieldId, payload }: { moduleId: number; fieldId: number; payload: Partial<CustomModuleFieldPayload> }) =>
      parseJson<CustomModuleDefinition>(
        await apiFetch(`/module-builder/${moduleId}/fields/${fieldId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      ),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["custom-modules"] }),
  });

  const deleteField = useMutation({
    mutationFn: async ({ moduleId, fieldId }: { moduleId: number; fieldId: number }) =>
      parseJson<CustomModuleDefinition>(
        await apiFetch(`/module-builder/${moduleId}/fields/${fieldId}`, {
          method: "DELETE",
        }),
      ),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["custom-modules"] }),
  });

  return {
    modules: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refresh: query.refetch,
    createModule: createModule.mutateAsync,
    updateModule: updateModule.mutateAsync,
    deleteModule: deleteModule.mutateAsync,
    restoreModule: restoreModule.mutateAsync,
    addField: addField.mutateAsync,
    updateField: updateField.mutateAsync,
    deleteField: deleteField.mutateAsync,
    isSaving:
      createModule.isPending ||
      updateModule.isPending ||
      deleteModule.isPending ||
      restoreModule.isPending ||
      addField.isPending ||
      updateField.isPending ||
      deleteField.isPending,
  };
}

export function useCustomModuleSchema(moduleKey: string, enabled = true) {
  return useQuery({
    queryKey: ["custom-module-schema", moduleKey],
    queryFn: async () => parseJson<CustomModuleDefinition>(await apiFetch(`/custom-modules/${moduleKey}/schema`)),
    enabled: Boolean(moduleKey) && enabled,
    refetchOnWindowFocus: false,
  });
}

export function useCustomModuleRecord(moduleKey: string, recordId: string | number, enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["custom-module-record", moduleKey, String(recordId)],
    queryFn: async () =>
      parseJson<CustomModuleRecord>(await apiFetch(`/custom-modules/${moduleKey}/records/${recordId}`)),
    enabled: Boolean(moduleKey && recordId) && enabled,
    refetchOnWindowFocus: false,
  });

  const updateRecord = useMutation({
    mutationFn: async (payload: { title?: string; values: Record<string, unknown> }) =>
      parseJson<CustomModuleRecord>(
        await apiFetch(`/custom-modules/${moduleKey}/records/${recordId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["custom-module-record", moduleKey, String(recordId)] });
      await queryClient.invalidateQueries({ queryKey: ["custom-module-records", moduleKey] });
    },
  });

  return {
    record: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    updateRecord: updateRecord.mutateAsync,
    isSaving: updateRecord.isPending,
    refresh: query.refetch,
  };
}

export function useCustomModuleRecords(moduleKey: string, page: number, search: string, sort: CustomModuleRecordSortState = null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["custom-module-records", moduleKey, page, search, sort],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), page_size: "25" });
      if (search.trim()) {
        params.set("search", search.trim());
      }
      if (sort) {
        params.set("sort_by", sort.key);
        params.set("sort_direction", sort.direction);
      }
      return parseJson<CustomModuleRecordList>(
        await apiFetch(`/custom-modules/${moduleKey}/records?${params.toString()}`),
      );
    },
    enabled: Boolean(moduleKey),
    refetchOnWindowFocus: false,
  });

  const saveRecord = useMutation({
    mutationFn: async (payload: { title?: string; values: Record<string, unknown> }) =>
      parseJson<CustomModuleRecord>(
        await apiFetch(`/custom-modules/${moduleKey}/records`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      ),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["custom-module-records", moduleKey] }),
  });

  const deleteRecord = useMutation({
    mutationFn: async (recordId: number) =>
      parseJson<CustomModuleRecord>(
        await apiFetch(`/custom-modules/${moduleKey}/records/${recordId}`, {
          method: "DELETE",
        }),
      ),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["custom-module-records", moduleKey] }),
  });

  const updateRecord = useMutation({
    mutationFn: async ({ recordId, payload }: { recordId: number; payload: { title?: string; values: Record<string, unknown> } }) =>
      parseJson<CustomModuleRecord>(
        await apiFetch(`/custom-modules/${moduleKey}/records/${recordId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      ),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["custom-module-records", moduleKey] }),
  });

  return {
    records: query.data?.results ?? [],
    totalCount: query.data?.total_count ?? 0,
    totalPages: query.data?.total_pages ?? 0,
    isLoading: query.isLoading,
    saveRecord: saveRecord.mutateAsync,
    updateRecord: updateRecord.mutateAsync,
    deleteRecord: deleteRecord.mutateAsync,
    refresh: query.refetch,
    isSaving: saveRecord.isPending || updateRecord.isPending || deleteRecord.isPending,
  };
}
