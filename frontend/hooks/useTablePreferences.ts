"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

type TablePreferenceResponse = {
  module_key: string;
  visible_columns: string[];
};

export type TableColumnOption = {
  key: string;
  label: string;
};

async function fetchTablePreference(moduleKey: string): Promise<TablePreferenceResponse> {
  const res = await apiFetch(`/users/table-preferences/${moduleKey}`);
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

async function saveTablePreference(moduleKey: string, visibleColumns: string[]) {
  const res = await apiFetch(`/users/table-preferences/${moduleKey}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visible_columns: visibleColumns }),
  });
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

export function useTablePreferences(
  moduleKey: string,
  options: TableColumnOption[],
  defaultColumns: string[],
) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["table-preferences", moduleKey],
    queryFn: () => fetchTablePreference(moduleKey),
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  });

  const mutation = useMutation({
    mutationFn: (visibleColumns: string[]) => saveTablePreference(moduleKey, visibleColumns),
    onSuccess: (data: TablePreferenceResponse) => {
      queryClient.setQueryData(["table-preferences", moduleKey], data);
    },
  });

  const allowedKeys = useMemo(() => new Set(options.map((option) => option.key)), [options]);
  const visibleColumns = useMemo(() => {
    const stored = query.data?.visible_columns?.filter((column) => allowedKeys.has(column)) ?? [];
    return stored.length ? stored : defaultColumns.filter((column) => allowedKeys.has(column));
  }, [allowedKeys, defaultColumns, query.data?.visible_columns]);

  return {
    visibleColumns,
    isLoading: query.isLoading,
    isSaving: mutation.isPending,
    saveVisibleColumns: mutation.mutateAsync,
  };
}
