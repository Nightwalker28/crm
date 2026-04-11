"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export type Organization = {
  org_name: string;
  primary_email: string;
  secondary_email?: string;
  website?: string;
  primary_phone?: string;
  secondary_phone?: string;
  industry?: string;
  annual_revenue?: string;
};

export type OrganizationsResponse = {
  results: Organization[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

export function useOrganizations(initialPage = 1, initialPageSize = 10) {
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>("");

  const fetchPage = useCallback(
    async (targetPage: number, targetPageSize = pageSize) => {
      try {
        setIsLoading(true);
        setError(null);

        const params = new URLSearchParams({
          page: String(targetPage),
          page_size: String(targetPageSize),
        });

        if (searchTerm.trim()) {
          params.append("search", searchTerm.trim());
        }

        const res = await apiFetch(
          `/sales/organizations?${params.toString()}`
        );

        if (!res.ok) throw new Error(`Failed with ${res.status}`);

        const json: OrganizationsResponse = await res.json();

        setOrganizations(json.results ?? []);
        setTotalCount(json.total_count ?? 0);
        setRangeStart(json.range_start ?? 0);
        setRangeEnd(json.range_end ?? 0);
        setTotalPages(json.total_pages ?? 1);

        setPage(targetPage);
        setPageSize(targetPageSize);
      } catch (err) {
        console.error(err);
        setError("Failed to load organizations");
      } finally {
        setIsLoading(false);
      }
    },
    [pageSize, searchTerm]
  );

  useEffect(() => {
    fetchPage(initialPage, pageSize);
  }, [fetchPage, initialPage, pageSize]);

  return {
    organizations,
    page,
    pageSize,
    totalPages,
    totalCount,
    rangeStart,
    rangeEnd,
    isLoading,
    error,
    searchTerm,

    goToPage: (p: number) => fetchPage(p, pageSize),
    setPageSize: (size: number) => fetchPage(1, size),
    refresh: () => fetchPage(page, pageSize),

    setSearchTerm: (value: string) => {
      setSearchTerm(value);
      fetchPage(1, pageSize);
    },
  };
}
