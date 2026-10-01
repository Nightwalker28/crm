"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Globe2, LayoutDashboard, LayoutTemplate, Lock, Plus, TrendingUp } from "lucide-react";

import { ReportTemplateGallery } from "@/components/reports/ReportTemplateGallery";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import SearchBar from "@/components/ui/SearchBar";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { usePageAddress } from "@/hooks/usePageAddress";
import { isForbiddenError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { fetchReportModules, fetchReportTemplates, fetchSavedReports, reportHref, type SavedReport } from "@/lib/reports";
import { DASHBOARD_ROUTES } from "@/lib/routes";

type Tab = "all" | "mine" | "shared" | "templates";
type Sort = { key: string; direction: "asc" | "desc" } | null;

/**
 * The report library (11-reports.md §4.6): every report the viewer owns or that is shared
 * with them, and the template gallery. A report opens on its own page; nothing is built
 * here any more. An empty library opens on the templates, because a blank builder is the
 * hardest place to start (HubSpot).
 */
export default function ReportsLibraryPage() {
  const { params, updateAddress } = usePageAddress();
  const tabParam = params.get("tab");
  const moduleFilter = params.get("module") ?? "all";
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>(null);
  const { modules: accessibleModules } = useAccessibleModules();
  const actions = accessibleModules.find((module) => module.name === "reports")?.actions;
  const canCreate = Boolean(actions?.can_create);
  const canSeeForecast = accessibleModules.some((module) => module.name === "sales_opportunities");

  const scope = tabParam === "mine" || tabParam === "shared" ? tabParam : undefined;
  const reportsQuery = useQuery({
    queryKey: ["saved-reports", scope ?? "all", search, moduleFilter, sort],
    queryFn: () => fetchSavedReports({ scope, search, moduleKey: moduleFilter === "all" ? undefined : moduleFilter, sort }),
  });
  const modulesQuery = useQuery({ queryKey: ["report-modules"], queryFn: fetchReportModules, staleTime: 5 * 60_000 });
  const reports = reportsQuery.data?.results ?? [];
  const isFiltered = Boolean(search.trim() || moduleFilter !== "all");
  // With no reports at all and no tab chosen, the library leads with templates.
  const libraryIsEmpty = !tabParam && !isFiltered && reportsQuery.isSuccess && reports.length === 0;
  const tab: Tab = tabParam === "mine" || tabParam === "shared" || tabParam === "templates" ? tabParam : libraryIsEmpty ? "templates" : "all";
  const templatesQuery = useQuery({ queryKey: ["report-templates"], queryFn: fetchReportTemplates, staleTime: 5 * 60_000, enabled: tab === "templates" });

  function showTab(next: Tab) {
    updateAddress((address) => { if (next === "all") address.delete("tab"); else address.set("tab", next); });
  }
  function changeModule(value: string) {
    updateAddress((address) => { if (value === "all") address.delete("module"); else address.set("module", value); });
  }
  function toggleSort(column: string) {
    setSort((current) => (current?.key === column
      ? { key: column, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key: column, direction: column === "updated_at" ? "desc" : "asc" }));
  }

  return (
    <PageShell
      variant={tab === "templates" ? "document" : "list"}
      title="Reports"
      isPermissionDenied={isForbiddenError(reportsQuery.error)}
      actions={(
        <>
          <SegmentedControl aria-label="Reports library" value={tab} onValueChange={(next) => showTab(next as Tab)}>
            <SegmentedItem value="all"><BarChart3 />All</SegmentedItem>
            <SegmentedItem value="mine"><Lock />Mine</SegmentedItem>
            <SegmentedItem value="shared"><Globe2 />Shared</SegmentedItem>
            <SegmentedItem value="templates"><LayoutTemplate />Templates</SegmentedItem>
          </SegmentedControl>
          <Button asChild variant="outline"><Link href={`${DASHBOARD_ROUTES.reports}/dashboards`}><LayoutDashboard />Dashboards</Link></Button>
          {canSeeForecast ? <Button asChild variant="outline"><Link href={`${DASHBOARD_ROUTES.reports}/forecast`}><TrendingUp />Forecast</Link></Button> : null}
          {canCreate ? <Button asChild><Link href={`${DASHBOARD_ROUTES.reports}/new`}><Plus />New report</Link></Button> : null}
        </>
      )}
    >
      {tab === "templates" ? (
        <>
          {libraryIsEmpty ? <p className="text-p-sm text-copy-muted">You have no reports yet. Start from one of these, or build your own with New report.</p> : null}
          <ReportTemplateGallery
            templates={templatesQuery.data?.results ?? []}
            isLoading={templatesQuery.isLoading}
            hasError={templatesQuery.isError}
            onRetry={() => void templatesQuery.refetch()}
          />
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_14rem]">
            <SearchBar value={search} onChange={setSearch} placeholder="Search reports" />
            <Field>
              <FieldLabel className="sr-only">Module filter</FieldLabel>
              <Select value={moduleFilter} onValueChange={changeModule}>
                <SelectTrigger aria-label="Module filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All modules</SelectItem>
                  {(modulesQuery.data?.results ?? []).map((module) => <SelectItem key={module.module_key} value={module.module_key}>{module.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <RecordTable<SavedReport>
            label="Reports"
            columns={[
              {
                key: "name",
                label: "Name",
                size: "lg",
                sortable: true,
                render: (report) => (
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium text-copy-primary">{report.name}</span>
                    {report.description ? <span className="truncate text-p-xs text-copy-muted">{report.description}</span> : null}
                  </span>
                ),
              },
              { key: "module_key", label: "Module", sortable: true, render: (report) => <span className="text-copy-secondary">{report.module_label ?? report.module_key}</span> },
              { key: "owner", label: "Owner", render: (report) => <span className="text-copy-secondary">{report.can_edit ? "You" : report.owner_name ?? "Someone else"}</span> },
              { key: "visibility", label: "Visible to", render: (report) => <span className="text-copy-secondary">{report.visibility === "everyone" ? "Everyone" : "Only me"}</span> },
              { key: "updated_at", label: "Updated", sortable: true, render: (report) => <span className="text-copy-secondary">{formatDateTime(report.updated_at, { hour: "numeric", minute: "2-digit" })}</span> },
            ]}
            rows={reports}
            rowKey={(report) => report.id}
            rowHref={(report) => reportHref(report.id)}
            rowLabel={(report) => `Open report ${report.name}`}
            sort={sort ? { column: sort.key, direction: sort.direction } : null}
            onSortChange={(next) => toggleSort(next.column)}
            isLoading={reportsQuery.isLoading}
            isRefreshing={reportsQuery.isFetching && !reportsQuery.isLoading}
            hasError={reportsQuery.isError && !isForbiddenError(reportsQuery.error)}
            onRetry={() => void reportsQuery.refetch()}
            hasActiveFilters={isFiltered}
            onClearFilters={() => { setSearch(""); changeModule("all"); }}
            filteredEmptyState={{ title: "No reports match", description: "Clear the search or choose another module." }}
            emptyState={{
              icon: BarChart3,
              title: tab === "shared" ? "Nothing shared with you yet" : "No reports yet",
              description: tab === "shared" ? "Reports other people share with everyone appear here." : "Start from a template, or build a report with New report.",
              action: <Button type="button" variant="outline" onClick={() => showTab("templates")}><LayoutTemplate />Browse templates</Button>,
            }}
          />
        </>
      )}
    </PageShell>
  );
}
