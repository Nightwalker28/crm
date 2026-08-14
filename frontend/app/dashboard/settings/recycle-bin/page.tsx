"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, RotateCcw, Trash2 } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";
import Pagination from "@/components/ui/Pagination";
import { RecordTable } from "@/components/ui/RecordTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/hooks/useConfirm";
import { formatDateTime } from "@/lib/datetime";
import { getModuleDisplayName } from "@/lib/module-display";
import { useModuleBuilder } from "@/hooks/useModuleBuilder";

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
  "finance_insertion_orders",
  "sales_leads",
  "sales_contacts",
  "sales_organizations",
  "sales_opportunities",
  "sales_quotes",
  "calendar",
  "tasks",
  "documents",
  "catalog_products",
  "catalog_services",
];

async function fetchRecycleItems(moduleKey: string, page: number, pageSize: number): Promise<RecycleResponse> {
  const params = new URLSearchParams({
    module_key: moduleKey,
    page: String(page),
    page_size: String(pageSize),
  });
  const res = await apiFetch(`/recycle?${params.toString()}`);
  if (!res.ok) throw new Error("Recycled records could not be loaded.");
  return res.json();
}

export default function RecycleBinPage() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const { modules: customModules, error: customModulesError, refresh: refreshCustomModules } = useModuleBuilder();
  const [moduleKey, setModuleKey] = useState("finance_insertion_orders");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState(false);
  const moduleOptions = useMemo(
    () => [
      ...MODULE_OPTIONS.map((moduleName) => ({ value: moduleName, label: getModuleDisplayName(moduleName) })),
      ...customModules
        .filter((module) => module.deleted_at == null)
        .map((module) => ({ value: module.key, label: getModuleDisplayName(module.key, module.description ?? undefined) })),
    ],
    [customModules],
  );

  const query = useQuery({
    queryKey: ["recycle-bin", moduleKey, page, pageSize],
    queryFn: () => fetchRecycleItems(moduleKey, page, pageSize),
  });

  const label = useMemo(
    () => moduleOptions.find((option) => option.value === moduleKey)?.label ?? moduleKey,
    [moduleKey, moduleOptions],
  );

  useEffect(() => {
    if (query.data && query.data.total_pages > 0 && page > query.data.total_pages) {
      setPage(query.data.total_pages);
    }
  }, [page, query.data]);

  async function restoreItem(item: RecycleItem) {
    const confirmed = await confirm({
      title: `Restore ${item.title}?`,
      description: `This record will become available in ${getModuleDisplayName(item.module_key)} again. Its deletion and restore remain in the audit trail.`,
      confirmLabel: "Restore record",
    });
    if (!confirmed) return;
    const itemKey = `${item.module_key}-${item.record_id}`;
    try {
      setRestoreError(false);
      setRestoringKey(itemKey);
      const res = await apiFetch(`/recycle/${item.module_key}/${item.record_id}/restore`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("The record could not be restored.");
      await Promise.all([
        query.refetch(),
        queryClient.invalidateQueries({ queryKey: ["activity-log"] }),
        queryClient.invalidateQueries({ queryKey: ["insertion-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-leads"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-organizations"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-contacts"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-opportunities"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-quotes"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar-events"] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
        queryClient.invalidateQueries({ queryKey: ["catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["custom-module-records", item.module_key] }),
      ]);
      toast.success(`"${item.title}" restored.`);
    } catch {
      setRestoreError(true);
      toast.error("The record could not be restored. Try again.");
    } finally {
      setRestoringKey(null);
    }
  }

  const data = query.data;

  return (
    <PageShell
      variant="settings"
      title="Recycle Bin"
      description="Restore records deleted in the last retention window."
      actions={(
        <>
        <Select
          value={moduleKey}
          onValueChange={(value) => {
            setModuleKey(value);
            setPage(1);
            setRestoreError(false);
          }}
        >
          <SelectTrigger className="w-72 max-w-full" aria-label="Recycle bin module">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {moduleOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        </>
      )}
    >
      {customModulesError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-state-warning/40 bg-state-warning-muted px-4 py-3 text-sm text-copy-secondary">
          <span>Custom-module recovery options could not be loaded. Built-in modules remain available.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void refreshCustomModules()}>
            <RefreshCw />
            Try again
          </Button>
        </div>
      ) : null}

      {restoreError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-secondary">
          <span>The record could not be restored. It remains safely in the recycle bin.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setRestoreError(false)}>Dismiss</Button>
        </div>
      ) : null}

      <Card>
        <div className="border-b border-line-subtle px-5 py-4">
          <h2 className="text-lg font-semibold text-copy-primary">{label}</h2>
          <p className="mt-1 text-sm text-copy-muted">Restore records without removing their audit history.</p>
        </div>

        <RecordTable
          label={label}
          shellVariant="nested"
          className="min-h-80"
          columns={[
            {
              key: "record",
              label: "Record",
              size: "lg",
              render: (item) => (
                <div className="min-w-0">
                  <div className="font-medium text-copy-primary">{item.title}</div>
                  <div className="mt-1 text-xs text-copy-muted">{item.subtitle || "No secondary label"}</div>
                </div>
              ),
            },
            {
              key: "module",
              label: "Module",
              render: (item) => (
                <div className="min-w-0">
                  <div className="text-copy-secondary">{getModuleDisplayName(item.module_key)}</div>
                  <div className="text-xs text-copy-muted">#{item.record_id}</div>
                </div>
              ),
            },
            { key: "deleted_at", label: "Deleted", render: (item) => <span className="whitespace-nowrap text-copy-muted">{item.deleted_at ? formatDateTime(item.deleted_at) : "Not recorded"}</span> },
          ]}
          rows={data?.results ?? []}
          rowKey={(item) => `${item.module_key}-${item.record_id}`}
          isLoading={query.isLoading}
          isRefreshing={query.isFetching && !query.isLoading}
          hasError={Boolean(query.error)}
          onRetry={() => void query.refetch()}
          emptyState={{
            icon: Trash2,
            title: `No recycled ${label.toLowerCase()}`,
            description: "Deleted records for this module will appear here until restored or removed by the retention policy.",
          }}
          rowActions={(item) => (
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => void restoreItem(item)}
                disabled={restoringKey !== null}
              >
                <RotateCcw />
                {restoringKey === `${item.module_key}-${item.record_id}` ? "Restoring..." : "Restore"}
              </Button>
            </div>
          )}
        />
      </Card>

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
