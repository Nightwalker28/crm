"use client";

import { useEffect, useState } from "react";
import InsertionOrdersList from "@/components/finance/insertionOrderList";
import { useInsertionOrders } from "@/hooks/finance/useInsertionOrders";
import FilterButton from "@/components/ui/filter-button";
import type { InsertionOrder } from "@/hooks/finance/useInsertionOrders";
import InsertionOrdersHeader from "../../../../components/finance/InsertionOrdersHeader";
import Pagination from "@/components/ui/Pagination";
import SearchBar from "@/components/ui/SearchBar";
import { apiFetch } from "@/lib/api";

export default function InsertionOrdersPage() {
  const {
    orders,
    page,
    pageSize,
    totalPages,
    isLoading,
    error,
    goToPage,
    onPageSizeChange,
    refresh,
    totalCount,
    rangeStart,
    rangeEnd,
  } = useInsertionOrders(1, 10);

  const [searchTerm, setSearchTerm] = useState("");
  const [searchField, setSearchField] = useState("campaign_name");
  const [searchResults, setSearchResults] = useState<InsertionOrder[] | null>(
    null
  );
  const [searching, setSearching] = useState(false);

  // Live search (debounced, uses searchTerm + searchField)
  useEffect(() => {
    const trimmed = searchTerm.trim();

    if (!trimmed) {
      setSearchResults(null);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        setSearching(true);
        const res = await apiFetch(
          `/finance/insertion-orders/search?field=${searchField}&value=${encodeURIComponent(
            trimmed
          )}`,
        );

        if (!res.ok) {
          console.error("Search API failed:", res.status, await res.text());
          return;
        }

        const json = await res.json();
        setSearchResults(json.results ?? []);
      } catch (err) {
        console.error("Search error", err);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchTerm, searchField]);

  const showingSearch = searchResults !== null;

  const formattedSearchField = searchField
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  const handleCreateClick = () => {
    console.log("Create button clicked");
  };

  return (
    <div className="bg-zinc-950">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        <InsertionOrdersHeader
          onCreateClick={handleCreateClick}
          onUploadSuccess={refresh}
        />

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-2 w-full md:w-auto">
            <SearchBar
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder={`Search by ${formattedSearchField}`}
            />
            <FilterButton field={searchField} setField={setSearchField} />
          </div>
        </div>

        {!showingSearch && error && (
          <div className="bg-red-900/40 border border-red-700 text-red-200 text-sm rounded-lg px-4 py-3 flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={refresh}
              className="underline underline-offset-2 text-red-100 hover:text-red-50"
            >
              Retry
            </button>
          </div>
        )}

        <InsertionOrdersList
          orders={showingSearch ? searchResults! : orders}
          isLoading={isLoading || searching}
        />

        {/* Only show pagination when NOT searching (same as you had) */}
        {!showingSearch && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            pageSize={pageSize}
            onPageChange={goToPage}
            onPageSizeChange={onPageSizeChange}
          />
        )}
      </div>
    </div>
  );
}
