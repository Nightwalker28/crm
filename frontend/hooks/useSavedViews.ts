"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export type SavedViewConfig = {
  visible_columns: string[];
  filters: SavedViewFilters;
  sort?: Record<string, unknown> | null;
};

export type SavedViewFilterLogic = "all" | "any";

export type SavedViewFilterOperator =
  | "is"
  | "is_not"
  | "contains"
  | "not_contains"
  | "in"
  | "not_in"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_empty"
  | "is_not_empty";

export type SavedViewCondition = {
  id?: string | null;
  field: string;
  operator: SavedViewFilterOperator;
  value?: unknown;
  values?: unknown;
};

export type SavedViewFilters = {
  search?: string;
  logic?: SavedViewFilterLogic;
  conditions?: SavedViewCondition[];
  all_conditions?: SavedViewCondition[];
  any_conditions?: SavedViewCondition[];
  [key: string]: unknown;
};

export type SavedView = {
  id: number | null;
  module_key: string;
  name: string;
  config: SavedViewConfig;
  is_default: boolean;
  is_system: boolean;
};

type SavedViewsResponse = {
  views: SavedView[];
};

async function fetchSavedViews(moduleKey: string, defaultColumns: string[]): Promise<SavedViewsResponse> {
  const params = new URLSearchParams();
  if (defaultColumns.length) {
    params.set("default_columns", defaultColumns.join(","));
  }
  const res = await apiFetch(`/users/saved-views/${moduleKey}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
  return res.json();
}

async function createSavedView(moduleKey: string, payload: { name: string; config: SavedViewConfig; is_default?: boolean }) {
  const res = await apiFetch(`/users/saved-views/${moduleKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
  return res.json() as Promise<SavedView>;
}

async function updateSavedView(moduleKey: string, viewId: number, payload: Partial<{ name: string; config: SavedViewConfig; is_default: boolean }>) {
  const res = await apiFetch(`/users/saved-views/${moduleKey}/${viewId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
  return res.json() as Promise<SavedView>;
}

async function deleteSavedView(moduleKey: string, viewId: number) {
  const res = await apiFetch(`/users/saved-views/${moduleKey}/${viewId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
}

export function useSavedViews(
  moduleKey: string,
  defaultConfig: SavedViewConfig,
) {
  const queryClient = useQueryClient();
  const [selectedViewId, setSelectedViewId] = useState<string>("");
  const [draftConfig, setDraftConfig] = useState<SavedViewConfig>(defaultConfig);
  const lastAppliedViewKeyRef = useRef<string | null>(null);

  const query = useQuery({
    queryKey: ["saved-views", moduleKey, defaultConfig.visible_columns],
    queryFn: () => fetchSavedViews(moduleKey, defaultConfig.visible_columns),
    staleTime: 5 * 60_000,
  });

  const views = useMemo(() => query.data?.views ?? [], [query.data?.views]);
  const systemView = views.find((view) => view.is_system) ?? null;

  const resolveViewId = useCallback((rawViewId: string) => {
    if (rawViewId === "system-default") {
      return systemView ? String(systemView.id) : "system-default";
    }
    return rawViewId;
  }, [systemView]);

  useEffect(() => {
    if (!views.length) return;
    const defaultView = views.find((view) => view.is_default) ?? views[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedViewId((current) => {
      const normalizedCurrent = resolveViewId(current);
      if (!normalizedCurrent) {
        return String(defaultView.id ?? "system-default");
      }
      const exists = views.some((view) => String(view.id ?? "system-default") === normalizedCurrent);
      return exists ? normalizedCurrent : String(defaultView.id ?? "system-default");
    });
  }, [resolveViewId, views]);

  const selectedView = useMemo(
    () => {
      const normalizedSelectedViewId = resolveViewId(selectedViewId);
      return views.find((view) => String(view.id ?? "system-default") === normalizedSelectedViewId) ?? views[0] ?? null;
    },
    [resolveViewId, selectedViewId, views],
  );

  useEffect(() => {
    if (selectedView) {
      const nextConfig = {
        visible_columns: selectedView.config.visible_columns ?? defaultConfig.visible_columns,
        filters: {
          search: "",
          logic: "all" as const,
          conditions: [],
          all_conditions: [],
          any_conditions: [],
          ...(selectedView.config.filters ?? {}),
        },
        sort: selectedView.config.sort ?? null,
      };
      const viewKey = `${selectedView.id ?? "system-default"}:${selectedView.is_default ? "default" : "custom"}:${JSON.stringify(selectedView.config)}`;
      if (lastAppliedViewKeyRef.current === viewKey) {
        return;
      }
      lastAppliedViewKeyRef.current = viewKey;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftConfig((current) => (JSON.stringify(current) === JSON.stringify(nextConfig) ? current : nextConfig));
    }
  }, [defaultConfig.visible_columns, selectedView]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["saved-views", moduleKey] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; config: SavedViewConfig; is_default?: boolean }) =>
      createSavedView(moduleKey, payload),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: ({ viewId, payload }: { viewId: number; payload: Partial<{ name: string; config: SavedViewConfig; is_default: boolean }> }) =>
      updateSavedView(moduleKey, viewId, payload),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (viewId: number) => deleteSavedView(moduleKey, viewId),
    onSuccess: invalidate,
  });

  return {
    views,
    selectedView,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
    isLoading: query.isLoading,
    isSaving: createMutation.isPending || updateMutation.isPending || deleteMutation.isPending,
    createView: async (name: string, isDefault = false) => {
      const created = await createMutation.mutateAsync({ name, config: draftConfig, is_default: isDefault });
      setSelectedViewId(String(created.id));
      return created;
    },
    createViewWithConfig: async (payload: { name: string; config: SavedViewConfig; is_default?: boolean }) => {
      const created = await createMutation.mutateAsync(payload);
      setSelectedViewId(String(created.id));
      return created;
    },
    saveCurrentView: async () => {
      if (!selectedView || selectedView.id == null) {
        throw new Error("Select a saved view before saving changes.");
      }
      return updateMutation.mutateAsync({ viewId: selectedView.id, payload: { config: draftConfig } });
    },
    updateView: async (viewId: number, payload: Partial<{ name: string; config: SavedViewConfig; is_default: boolean }>) =>
      updateMutation.mutateAsync({ viewId, payload }),
    setCurrentAsDefault: async () => {
      if (!selectedView || selectedView.id == null) {
        throw new Error("Select a saved view before setting the default.");
      }
      return updateMutation.mutateAsync({ viewId: selectedView.id, payload: { is_default: true } });
    },
    deleteCurrentView: async () => {
      if (!selectedView || selectedView.id == null) {
        throw new Error("Default system view cannot be deleted.");
      }
      await deleteMutation.mutateAsync(selectedView.id);
      setSelectedViewId("system-default");
    },
  };
}
