"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export type UserOption = {
  id: number;
  label: string;
  email: string;
};

type UserOptionsResponse = {
  results: UserOption[];
  has_more?: boolean;
};

/**
 * The listing form's ceiling, matching `USER_OPTIONS_MAX_LIMIT` on the endpoint. Asking for
 * it explicitly is what separates the two questions the endpoint answers: `LinkedRecordPicker`
 * types first and wants the top ten matches, this wants the set.
 */
export const USER_OPTIONS_LIMIT = 500;

/**
 * Every active user in the tenant, for a select that filters in memory (design.md §7.8).
 *
 * One request per module key, shared by every record page of that module through the query
 * cache — nine record types ask for this and a rail should not re-fetch the staff list on
 * every record the operator opens, so the window is deliberately long. `has_more` comes back
 * with the rows because a capped list has to be able to say so (§7.9); the caller renders
 * that, this only carries it.
 *
 * `action` is `edit` rather than `view`: the only reason to list users here is to reassign a
 * record, so the request asks for exactly the permission the write will need. A reader
 * without it gets a 403 and the field stays read-only, which is the correct answer rather
 * than a picker that fails on commit.
 */
export function useUserOptions(moduleKey: string, options?: { enabled?: boolean }) {
  const query = useQuery({
    queryKey: ["linked-record-user-options", moduleKey],
    queryFn: async (): Promise<UserOptionsResponse> => {
      const params = new URLSearchParams({
        module_key: moduleKey,
        action: "edit",
        limit: String(USER_OPTIONS_LIMIT),
      });
      const res = await apiFetch(`/linked-record-options/users?${params.toString()}`);
      if (!res.ok) throw new Error("We could not load the list of users.");
      const body = (await res.json().catch(() => null)) as UserOptionsResponse | null;
      return { results: body?.results ?? [], has_more: Boolean(body?.has_more) };
    },
    enabled: options?.enabled !== false && Boolean(moduleKey),
    staleTime: 5 * 60_000,
    retry: false,
  });

  return {
    users: query.data?.results ?? [],
    hasMore: Boolean(query.data?.has_more),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
