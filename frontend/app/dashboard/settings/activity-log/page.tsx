"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";

import { apiFetch } from "@/lib/api";
import Pagination from "@/components/ui/Pagination";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { formatDateTime } from "@/lib/datetime";
import { getModuleDisplayName } from "@/lib/module-display";

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
      <PageHeader
        title="Activity Log"
        description="Audit trail of platform writes, restores, and configuration actions."
        actions={
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
              <SelectItem value="comment_added">Comment added</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <div className="overflow-hidden rounded-md border border-neutral-800 bg-neutral-950/80">
        <Table className="min-w-[980px]">
          <TableHeader>
            <TableHeaderRow>
              <TableHead>Action</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Created</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-neutral-500">Loading activity...</TableCell>
              </TableRow>
            ) : query.error ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-red-300">
                  {query.error instanceof Error ? query.error.message : "Failed to load activity."}
                </TableCell>
              </TableRow>
            ) : data?.results?.length ? (
              data.results.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs uppercase tracking-wide text-neutral-300">
                      {item.action}
                    </span>
                  </TableCell>
                  <TableCell className="font-medium text-neutral-100">{getModuleDisplayName(item.module_key)}</TableCell>
                  <TableCell>
                    <div className="text-neutral-300">{item.entity_type}</div>
                    <div className="text-xs text-neutral-500">#{item.entity_id}</div>
                  </TableCell>
                  <TableCell className="max-w-[420px] truncate text-neutral-300">
                    {item.description || `${item.entity_type} ${item.entity_id}`}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-neutral-400">{formatDateTime(item.created_at)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-10">
                  <div className="flex flex-col items-center justify-center gap-2 text-center text-neutral-500">
                    <ClipboardList className="h-8 w-8 text-neutral-700" />
                    <div className="text-sm">No activity matched the current filter.</div>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

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
