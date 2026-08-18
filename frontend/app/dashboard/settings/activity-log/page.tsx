"use client";

import type { StatusTone } from "@/lib/statusStyles";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, RefreshCw } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { StatusValue } from "@/components/ui/StatusValue";
import { Button } from "@/components/ui/button";
import Pagination from "@/components/ui/Pagination";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

function actionTone(action: string): StatusTone {
  if (action === "create" || action === "restore" || action.endsWith(".created")) {
    return "success";
  }
  if (action === "soft_delete" || action === "delete" || action.endsWith(".deleted") || action.endsWith(".failed")) {
    return "critical";
  }
  if (action === "update" || action === "edit" || action.endsWith(".updated")) {
    return "neutral";
  }
  return "neutral";
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
    <PageShell
      variant="settings"
      title="Activity Log"
      description="Review who changed what, and when."
      actions={(
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
      )}
    >
      <RecordTable
        label="Activity"
        columns={[
          { key: "action", label: "Action", size: "sm", render: (item) => <StatusValue status={{ tone: actionTone(item.action), label: formatActivityLabel(item.action) }} /> },
          { key: "module", label: "Module", render: (item) => <span className="font-medium text-copy-primary">{getModuleDisplayName(item.module_key)}</span> },
          {
            key: "record",
            label: "Record",
            render: (item) => (
              <div className="min-w-0">
                <div className="text-copy-secondary">{formatActivityLabel(item.entity_type)}</div>
                <div className="text-xs text-copy-muted">#{item.entity_id}</div>
              </div>
            ),
          },
          { key: "actor", label: "Actor", render: (item) => <span className="whitespace-nowrap text-copy-secondary">{item.actor_user_id ? `User #${item.actor_user_id}` : "System"}</span> },
          { key: "description", label: "Description", size: "lg", render: (item) => <span className="text-copy-secondary">{item.description || `${formatActivityLabel(item.entity_type)} ${item.entity_id}`}</span> },
          { key: "created_at", label: "Created", render: (item) => <span className="whitespace-nowrap text-copy-muted">{formatDateTime(item.created_at)}</span> },
        ]}
        rows={data?.results ?? []}
        rowKey={(item) => item.id}
        isLoading={query.isLoading}
        isRefreshing={query.isFetching && !query.isLoading}
        hasError={Boolean(query.error)}
        onRetry={() => void query.refetch()}
        hasActiveFilters={actionFilter !== "all"}
        onClearFilters={() => { setActionFilter("all"); setPage(1); }}
        emptyState={{
          icon: ClipboardList,
          title: "No activity recorded",
          description: "Audited platform changes will appear here.",
        }}
        filteredEmptyState={{
          icon: ClipboardList,
          title: "No matching activity",
          description: "Choose another action filter to review different events.",
        }}
      />

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
    </PageShell>
  );
}
