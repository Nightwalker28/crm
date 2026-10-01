"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ReportBuilder } from "@/components/reports/ReportBuilder";
import { PageShell } from "@/components/ui/PageShell";
import { isForbiddenError } from "@/lib/api";
import { fetchReportModules, fetchSavedReport, reportHref, upgradeReportConfig } from "@/lib/reports";

/**
 * The builder for a saved report. The owner saves over it; anyone else it is shared with
 * gets the same builder with Save as only, which makes their own copy.
 */
export default function EditReportPage() {
  const params = useParams<{ reportId: string }>();
  const reportId = Number(params.reportId);
  const reportQuery = useQuery({ queryKey: ["saved-report", reportId], queryFn: () => fetchSavedReport(reportId), enabled: Number.isFinite(reportId), retry: false });
  const modulesQuery = useQuery({ queryKey: ["report-modules"], queryFn: fetchReportModules, staleTime: 5 * 60_000 });
  const report = reportQuery.data;
  const modules = modulesQuery.data?.results ?? [];

  if (reportQuery.isLoading || modulesQuery.isLoading || reportQuery.isError || modulesQuery.isError || !report) {
    return (
      <PageShell
        title="Edit report"
        isLoading={reportQuery.isLoading || modulesQuery.isLoading}
        isPermissionDenied={isForbiddenError(reportQuery.error ?? modulesQuery.error)}
        hasError
        errorDescription="It may have been deleted, or it is not shared with you."
        onRetry={() => { void reportQuery.refetch(); void modulesQuery.refetch(); }}
        backHref={Number.isFinite(reportId) ? reportHref(reportId) : "/dashboard/reports"}
        backLabel="Back to the report"
      >
        {null}
      </PageShell>
    );
  }

  return (
    <ReportBuilder
      key={report.id}
      modules={modules}
      initial={{ moduleKey: report.module_key, config: upgradeReportConfig(report.config), report }}
    />
  );
}
