"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export type Contact = {
  contact_id: number;
  first_name: string | null;
  last_name: string | null;
  primary_email: string | null;
  linkedin_url: string | null;
  current_title: string | null;
  region: string | null;
  country: string | null;
  assigned_to: number | null;
  created_time: string;
};

export type ContactsResponse = {
  results: Contact[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

async function fetchContacts(page: number): Promise<ContactsResponse> {
  const res = await apiFetch(`/sales/contacts?page=${page}`);
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

export function useContacts(initialPage = 1) {
  const [page, setPage] = useState(initialPage);

  const query = useQuery({
    queryKey: ["sales-contacts", page],
    queryFn: () => fetchContacts(page),
    placeholderData: keepPreviousData,
  });

  const data = query.data;
  const rangeStart = data?.range_start ?? 0;
  const rangeEnd = data?.range_end ?? 0;

  return {
    contacts: data?.results ?? [],
    page: data?.page ?? page,
    totalPages: data?.total_pages ?? 1,
    totalCount: data?.total_count ?? 0,
    rangeStart,
    rangeEnd,
    pageSize: rangeStart && rangeEnd ? rangeEnd - rangeStart + 1 : 0,
    isLoading: query.isLoading || query.isFetching,
    error: query.error instanceof Error ? "Failed to load contacts" : null,
    goToPage: setPage,
    refresh: () => query.refetch(),
  };
}
