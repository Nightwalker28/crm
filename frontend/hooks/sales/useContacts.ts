"use client";

import { useCallback, useEffect, useState } from "react";
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

export function useContacts(initialPage = 1) {
  const [page, setPage] = useState(initialPage);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchPage = useCallback(
    async (targetPage: number) => {
      try {
        setIsLoading(true);
        setError(null);

        const res = await apiFetch(`/sales/contacts?page=${targetPage}`);

        if (!res.ok) throw new Error(`Failed with ${res.status}`);

        const json: ContactsResponse = await res.json();

        setContacts(json.results ?? []);
        setTotalCount(json.total_count ?? 0);
        setRangeStart(json.range_start ?? 0);
        setRangeEnd(json.range_end ?? 0);
        setTotalPages(json.total_pages ?? 1);
        setPage(json.page ?? targetPage);
      } catch (err) {
        console.error(err);
        setError("Failed to load contacts");
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchPage(initialPage);
  }, [initialPage, fetchPage]);

  const pageSize =
    rangeStart && rangeEnd ? rangeEnd - rangeStart + 1 : 0;

  return {
    contacts,
    page,
    totalPages,
    totalCount,
    rangeStart,
    rangeEnd,
    pageSize,
    isLoading,
    error,
    goToPage: fetchPage,
    refresh: () => fetchPage(page),
  };
}
