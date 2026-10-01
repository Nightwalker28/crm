"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { EditorPanel } from "@/components/ui/EditorPanel";
import { fetchReportRecords, type ReportConfig } from "@/lib/reports";
import { ReportRecordsTable } from "./ReportResultTable";

export type ReportDrill = { keys: string[]; label: string };

/**
 * The records behind one group, cell or chart segment, beside the report rather than in
 * place of it (Dynamics' chart drill, HubSpot's "View data"). Read-only, so the panel has
 * no footer to commit (design.md §7.11). Each row opens its record.
 */
export function ReportRecordsPanel({ moduleKey, moduleLabel, config, drill, onClose }: {
  moduleKey: string;
  moduleLabel: string;
  config: ReportConfig;
  drill: ReportDrill | null;
  onClose: () => void;
}) {
  return (
    <EditorPanel
      open={Boolean(drill)}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={drill?.label ?? "Records"}
      description={`${moduleLabel} in this report`}
      closeLabel="Close records"
      size="wide"
    >
      {drill ? <DrillRecords key={`${drill.keys.join("\u0000")}`} moduleKey={moduleKey} moduleLabel={moduleLabel} config={config} keys={drill.keys} /> : null}
    </EditorPanel>
  );
}

function DrillRecords({ moduleKey, moduleLabel, config, keys }: { moduleKey: string; moduleLabel: string; config: ReportConfig; keys: string[] }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const query = useQuery({
    queryKey: ["report-records", moduleKey, config, keys, page, pageSize],
    queryFn: () => fetchReportRecords(moduleKey, config, keys.length ? keys : null, (page - 1) * pageSize, pageSize),
    placeholderData: keepPreviousData,
  });
  return (
    <ReportRecordsTable
      records={query.data}
      label={`${moduleLabel} records`}
      page={page}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
      isLoading={query.isLoading}
      isRefreshing={query.isFetching && !query.isLoading}
      hasError={query.isError}
      onRetry={() => void query.refetch()}
    />
  );
}
