"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ReportBuilder } from "@/components/reports/ReportBuilder";
import { PageShell } from "@/components/ui/PageShell";
import { isForbiddenError } from "@/lib/api";
import { defaultReportConfig, fetchReportModules, fetchReportTemplates } from "@/lib/reports";
import { DASHBOARD_ROUTES } from "@/lib/routes";

/** `?module=` starts on a module; `?template=` starts from a template, unsaved. */
function NewReport() {
  const searchParams = useSearchParams();
  const templateKey = searchParams.get("template");
  const moduleParam = searchParams.get("module");
  const modulesQuery = useQuery({ queryKey: ["report-modules"], queryFn: fetchReportModules, staleTime: 5 * 60_000 });
  const templatesQuery = useQuery({ queryKey: ["report-templates"], queryFn: fetchReportTemplates, staleTime: 5 * 60_000, enabled: Boolean(templateKey) });

  const modules = modulesQuery.data?.results ?? [];
  const isLoading = modulesQuery.isLoading || (Boolean(templateKey) && templatesQuery.isLoading);
  const failed = modulesQuery.isError || templatesQuery.isError;
  if (isLoading || failed || !modules.length) {
    return (
      <PageShell
        title="New report"
        isLoading={isLoading}
        isPermissionDenied={isForbiddenError(modulesQuery.error)}
        hasError={failed || (!isLoading && !modules.length)}
        errorDescription={!failed && !modules.length ? "You cannot view any module that reports cover. Ask an administrator for access." : undefined}
        onRetry={() => { void modulesQuery.refetch(); void templatesQuery.refetch(); }}
        backHref={DASHBOARD_ROUTES.reports}
        backLabel="Back to reports"
      >
        {null}
      </PageShell>
    );
  }

  const template = templateKey ? templatesQuery.data?.results.find((item) => item.key === templateKey) : undefined;
  const reportModule = modules.find((item) => item.module_key === (template?.module_key ?? moduleParam)) ?? modules[0];
  const config = template?.config ?? defaultReportConfig(reportModule);
  return (
    <ReportBuilder
      key={`${reportModule.module_key}-${template?.key ?? "blank"}`}
      modules={modules}
      initial={{ moduleKey: reportModule.module_key, config, suggestedName: template?.name, suggestedDescription: template?.description }}
    />
  );
}

export default function NewReportPage() {
  return <Suspense fallback={null}><NewReport /></Suspense>;
}
