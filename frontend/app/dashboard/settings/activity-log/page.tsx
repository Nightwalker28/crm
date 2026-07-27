"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, RefreshCw } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import Pagination from "@/components/ui/Pagination";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
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

const ACTION_OPTIONS = [
  { value: "all", label: "All actions" },
  { value: "create", label: "Create" },
  { value: "update", label: "Update" },
  { value: "edit", label: "Edit" },
  { value: "view", label: "View" },
  { value: "soft_delete", label: "Soft delete" },
  { value: "delete", label: "Delete" },
  { value: "restore", label: "Restore" },
  { value: "comment_added", label: "Comment added" },
] as const;

function formatActivityLabel(value: string) {
  return value
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function actionPillStyle(action: string) {
  if (action === "create" || action === "restore" || action.endsWith(".created")) {
    return { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40" };
  }
  if (action === "soft_delete" || action === "delete" || action.endsWith(".deleted") || action.endsWith(".failed")) {
    return { bg: "bg-state-danger-muted", text: "text-state-danger", border: "border-state-danger/40" };
  }
  if (action === "update" || action === "edit" || action.endsWith(".updated")) {
    return { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40" };
  }
  return {};
}

async function fetchActivityLog(page: number, pageSize: number, action: string): Promise<ActivityResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (action !== "all") params.set("action", action);
  const res = await apiFetch(`/activity?${params.toString()}`);
  if (!res.ok) throw new Error("Activity could not be loaded.");
  return res.json();
}

export default function ActivityLogPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [actionFilter, setActionFilter] = useState("all");

  const query = useQuery({
    queryKey: ["activity-log", page, pageSize, actionFilter],
    queryFn: () => fetchActivityLog(page, pageSize, actionFilter),
    staleTime: 15_000,
  });

  const data = query.data;

  return (
    <div className="flex flex-col gap-5 text-copy-primary">
      <PageHeader
        title="Activity Log"
        description="Audit trail of platform writes, restores, and configuration actions."
        actions={
          <>
            <Select
              value={actionFilter}
              onValueChange={(value) => {
                setActionFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-48" aria-label="Activity action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
              <RefreshCw />
              Refresh
            </Button>
          </>
        }
      />

      <ModuleTableShell isRefreshing={query.isFetching && !query.isLoading}>
        <Table className="min-w-[1080px]">
          <TableHeader>
            <TableHeaderRow>
              <TableHead>Action</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Created</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-copy-muted" aria-busy="true">Loading activity...</TableCell>
              </TableRow>
            ) : query.error ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <div role="alert" className="flex flex-col items-center px-4 py-8 text-center">
                    <p className="text-sm font-medium text-copy-primary">Activity could not be loaded.</p>
                    <p className="mt-1 text-sm text-copy-muted">Check your connection and try again.</p>
                    <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void query.refetch()}>
                      <RefreshCw />
                      Try again
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : data?.results?.length ? (
              data.results.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Pill {...actionPillStyle(item.action)}>{formatActivityLabel(item.action)}</Pill>
                  </TableCell>
                  <TableCell className="font-medium text-copy-primary">{getModuleDisplayName(item.module_key)}</TableCell>
                  <TableCell>
                    <div className="text-copy-secondary">{formatActivityLabel(item.entity_type)}</div>
                    <div className="text-xs text-copy-muted">#{item.entity_id}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-copy-secondary">
                    {item.actor_user_id ? `User #${item.actor_user_id}` : "System"}
                  </TableCell>
                  <TableCell className="max-w-[420px] text-copy-secondary">
                    {item.description || `${formatActivityLabel(item.entity_type)} ${item.entity_id}`}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-copy-muted">{formatDateTime(item.created_at)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState
                    icon={ClipboardList}
                    title={actionFilter === "all" ? "No activity recorded" : "No matching activity"}
                    description={actionFilter === "all" ? "Audited platform changes will appear here." : "Choose another action filter to review different events."}
                    action={actionFilter !== "all" ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setActionFilter("all");
                          setPage(1);
                        }}
                      >
                        Clear filter
                      </Button>
                    ) : undefined}
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ModuleTableShell>

      {data && data.total_count > 0 && !query.error ? (
        <Pagination
          page={data.page}
          totalPages={data.total_pages}
          totalCount={data.total_count}
          rangeStart={data.range_start}
          rangeEnd={data.range_end}
          pageSize={pageSize}
          isRefreshing={query.isFetching}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPage(1);
            setPageSize(size);
          }}
        />
      ) : null}
    </div>
  );
}
