"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import Pagination from "@/components/ui/Pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ActivityItem = {
  id: number;
  actor_user_id?: number | null;
  module_key: string;
  entity_type: string;
  entity_id: string;
  action: string;
  description?: string | null;
  created_at: string;
};

type ActivityResponse = {
  results: ActivityItem[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

async function fetchActivityLog(page: number, action: string): Promise<ActivityResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: "10",
  });
  if (action !== "all") params.set("action", action);
  const res = await apiFetch(`/activity?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

export default function ActivityLogPage() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("all");

  const query = useQuery({
    queryKey: ["activity-log", page, actionFilter],
    queryFn: () => fetchActivityLog(page, actionFilter),
  });

  const data = query.data;

  return (
    <div className="flex flex-col gap-5 text-neutral-200">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold leading-none">Activity Log</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Audit trail of platform writes, restores, and configuration actions.
          </p>
        </div>
        <Select
          value={actionFilter}
          onValueChange={(value) => {
            setActionFilter(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="create">Create</SelectItem>
            <SelectItem value="update">Update</SelectItem>
            <SelectItem value="soft_delete">Soft delete</SelectItem>
            <SelectItem value="restore">Restore</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden px-0 py-0">
        {query.isLoading ? (
          <div className="px-5 py-5 text-sm text-neutral-500">Loading activity…</div>
        ) : !data?.results?.length ? (
          <div className="px-5 py-5 text-sm text-neutral-500">No activity matched the current filter.</div>
        ) : (
          <div className="divide-y divide-neutral-800">
            {data.results.map((item) => (
              <div key={item.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs uppercase tracking-wide text-neutral-300">
                    {item.action}
                  </span>
                  <span className="text-sm font-medium text-neutral-100">{item.module_key}</span>
                  <span className="text-xs text-neutral-500">#{item.entity_id}</span>
                </div>
                <div className="mt-2 text-sm text-neutral-300">{item.description || `${item.entity_type} ${item.entity_id}`}</div>
                <div className="mt-1 text-xs text-neutral-500">{new Date(item.created_at).toLocaleString()}</div>
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
        pageSize={10}
        onPageChange={setPage}
        onPageSizeChange={() => {}}
      />
    </div>
  );
}
