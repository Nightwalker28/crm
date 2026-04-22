"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime } from "@/lib/datetime";

type RecycleItem = {
  module_key: string;
  record_id: number;
  title: string;
  subtitle?: string | null;
  deleted_at?: string | null;
  details?: Record<string, unknown>;
};

type RecycleResponse = {
  results: RecycleItem[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
  page_size: number;
};

const MODULE_OPTIONS = [
  { value: "finance_insertion_orders", label: "Finance Insertion Orders" },
  { value: "sales_contacts", label: "Sales Contacts" },
  { value: "sales_organizations", label: "Sales Organizations" },
  { value: "sales_opportunities", label: "Sales Opportunities" },
  { value: "tasks", label: "Tasks" },
];

async function fetchRecycleItems(moduleKey: string, page: number, pageSize: number): Promise<RecycleResponse> {
  const params = new URLSearchParams({
    module_key: moduleKey,
    page: String(page),
    page_size: String(pageSize),
  });
  const res = await apiFetch(`/recycle?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

export default function RecycleBinPage() {
  const queryClient = useQueryClient();
  const [moduleKey, setModuleKey] = useState("finance_insertion_orders");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const query = useQuery({
    queryKey: ["recycle-bin", moduleKey, page, pageSize],
    queryFn: () => fetchRecycleItems(moduleKey, page, pageSize),
  });

  const label = useMemo(
    () => MODULE_OPTIONS.find((option) => option.value === moduleKey)?.label ?? moduleKey,
    [moduleKey],
  );

  async function restoreItem(item: RecycleItem) {
    const res = await apiFetch(`/recycle/${item.module_key}/${item.record_id}/restore`, {
      method: "POST",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.detail ?? `Failed with ${res.status}`);
    }
    await Promise.all([
      query.refetch(),
      queryClient.invalidateQueries({ queryKey: ["activity-log"] }),
      queryClient.invalidateQueries({ queryKey: ["insertion-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["sales-organizations"] }),
      queryClient.invalidateQueries({ queryKey: ["sales-contacts"] }),
      queryClient.invalidateQueries({ queryKey: ["sales-opportunities"] }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    ]);
    toast.success("Item restored.");
  }

  const data = query.data;

  return (
    <div className="flex flex-col gap-5 text-neutral-200">
      <PageHeader
        title="Recycle Bin"
        description="One recovery area for the platform, with module-specific tables inside it."
        actions={
          <Select
            value={moduleKey}
            onValueChange={(value) => {
              setModuleKey(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODULE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <Card className="overflow-hidden px-0 py-0">
        <div className="border-b border-neutral-800 px-5 py-4">
          <h2 className="text-lg font-semibold text-neutral-100">{label}</h2>
          <p className="mt-1 text-sm text-neutral-500">Restore records without leaving the audit trail.</p>
        </div>

        {query.isLoading ? (
          <div className="px-5 py-5 text-sm text-neutral-500">Loading recycle items…</div>
        ) : !data?.results?.length ? (
          <div className="px-5 py-8">
            <div className="flex flex-col items-center justify-center gap-2 text-center text-neutral-500">
              <Trash2 className="h-8 w-8 text-neutral-700" />
              <div className="text-sm">No recycled records for this module.</div>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-neutral-800">
            {data.results.map((item) => (
              <div key={`${item.module_key}-${item.record_id}`} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-neutral-100">{item.title}</div>
                  <div className="mt-1 truncate text-sm text-neutral-500">
                    {item.subtitle || "No secondary label"}{item.deleted_at ? ` · deleted ${formatDateTime(item.deleted_at)}` : ""}
                  </div>
                </div>
                <Button
                  onClick={async () => {
                    try {
                      await restoreItem(item);
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Failed to restore item");
                    }
                  }}
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Pagination
        page={data?.page ?? page}
        totalPages={data?.total_pages ?? 1}
        totalCount={data?.total_count ?? 0}
        rangeStart={data?.range_start ?? 0}
        rangeEnd={data?.range_end ?? 0}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPage(1);
          setPageSize(size);
        }}
      />
    </div>
  );
}
