"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

/**
 * A country's states or provinces (13b §3.6): ISO 3166-2, bundled on the server. Addresses
 * store the subdivision's name; an empty list means the country keeps a free-text state.
 */
export type Subdivision = { code: string; name: string; type: string };

export function useSubdivisions(countryCode: string | null | undefined) {
  const code = (countryCode ?? "").trim().toUpperCase();
  const query = useQuery({
    queryKey: ["subdivisions", code],
    queryFn: async (): Promise<Subdivision[]> => {
      const res = await apiFetch(`/picklists/subdivisions/${encodeURIComponent(code)}`);
      if (!res.ok) throw new Error("States and provinces could not be loaded.");
      return ((await res.json()) as { results: Subdivision[] }).results;
    },
    enabled: Boolean(code),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return { subdivisions: query.data ?? [], isLoading: query.isLoading && Boolean(code) };
}
