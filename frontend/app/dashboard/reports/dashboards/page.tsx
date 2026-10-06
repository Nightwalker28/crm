"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Globe2, LayoutDashboard, Lock, Plus } from "lucide-react";
import { toast } from "sonner";

import { SaveReportDialog } from "@/components/reports/ReportBuilder";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import SearchBar from "@/components/ui/SearchBar";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { usePageAddress } from "@/hooks/usePageAddress";
import { isForbiddenError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { createReportDashboard, dashboardHref, fetchReportDashboards, type ReportDashboardSummary } from "@/lib/reportDashboards";
import { DASHBOARD_ROUTES } from "@/lib/routes";

type Tab = "all" | "mine" | "shared";

/**
 * Report dashboards (11-reports.md Phase 2): pages of saved reports, private or shared.
 * The home dashboard stays each person's own; these are the ones a team looks at together.
 */
export default function ReportDashboardsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { params, updateAddress } = usePageAddress();
  const tabParam = params.get("tab");
  const tab: Tab = tabParam === "mine" || tabParam === "shared" ? tabParam : "all";
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const { modules: accessibleModules } = useAccessibleModules();
  const canCreate = Boolean(accessibleModules.find((module) => module.name === "reports")?.actions?.can_create);

  const dashboardsQuery = useQuery({
    queryKey: ["report-dashboards", tab, search],
    queryFn: () => fetchReportDashboards({ scope: tab === "all" ? undefined : tab, search }),
  });
  const createMutation = useMutation({
    mutationFn: createReportDashboard,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["report-dashboards"] });
      setCreateOpen(false);
      toast.success("Dashboard created. Add its first widget.");
      router.push(`${dashboardHref(created.id)}?edit=1`);
    },
  });

  function showTab(next: Tab) {
    updateAddress((address) => { if (next === "all") address.delete("tab"); else address.set("tab", next); });
  }

  return (
    <PageShell
      variant="list"
      title="Dashboards"
      isPermissionDenied={isForbiddenError(dashboardsQuery.error)}
      actions={(
        <>
          <SegmentedControl aria-label="Dashboards library" value={tab} onValueChange={(next) => showTab(next as Tab)}>
            <SegmentedItem value="all"><LayoutDashboard />All</SegmentedItem>
            <SegmentedItem value="mine"><Lock />Mine</SegmentedItem>
            <SegmentedItem value="shared"><Globe2 />Shared</SegmentedItem>
          </SegmentedControl>
          <Button asChild variant="outline"><Link href={DASHBOARD_ROUTES.reports}><BarChart3 />Reports</Link></Button>
          {canCreate ? <Button type="button" onClick={() => setCreateOpen(true)}><Plus />New dashboard</Button> : null}
        </>
      )}
    >
      <div className="sm:max-w-md">
        <SearchBar value={search} onChange={setSearch} placeholder="Search dashboards" />
      </div>
      <RecordTable<ReportDashboardSummary>
        label="Dashboards"
        columns={[
          {
            key: "name",
            label: "Name",
            size: "lg",
            render: (dashboard) => (
              <span className="flex min-w-0 flex-col">
                <span className="font-medium text-copy-primary">{dashboard.name}</span>
                {dashboard.description ? <span className="truncate text-p-xs text-copy-muted">{dashboard.description}</span> : null}
              </span>
            ),
          },
          { key: "widgets", label: "Widgets", align: "right", size: "sm", render: (dashboard) => <span className="tabular-nums text-copy-secondary">{dashboard.widget_count}</span> },
          { key: "owner", label: "Owner", render: (dashboard) => <span className="text-copy-secondary">{dashboard.can_edit ? "You" : dashboard.owner_name ?? "Someone else"}</span> },
          { key: "visibility", label: "Visible to", render: (dashboard) => <span className="text-copy-secondary">{dashboard.visibility === "everyone" ? "Everyone" : "Only me"}</span> },
          { key: "updated_at", label: "Updated", render: (dashboard) => <span className="text-copy-secondary">{formatDateTime(dashboard.updated_at, { hour: "numeric", minute: "2-digit" })}</span> },
        ]}
        rows={dashboardsQuery.data?.results ?? []}
        rowKey={(dashboard) => dashboard.id}
        rowHref={(dashboard) => dashboardHref(dashboard.id)}
        rowLabel={(dashboard) => `Open dashboard ${dashboard.name}`}
        isLoading={dashboardsQuery.isLoading}
        isRefreshing={dashboardsQuery.isFetching && !dashboardsQuery.isLoading}
        hasError={dashboardsQuery.isError && !isForbiddenError(dashboardsQuery.error)}
        onRetry={() => void dashboardsQuery.refetch()}
        hasActiveFilters={Boolean(search.trim())}
        onClearFilters={() => setSearch("")}
        filteredEmptyState={{ title: "No dashboards match", description: "Clear the search to see every dashboard." }}
        emptyState={{
          icon: LayoutDashboard,
          title: tab === "shared" ? "Nothing shared with you yet" : "No dashboards yet",
          description: tab === "shared"
            ? "Dashboards other people share with everyone appear here."
            : "A dashboard puts several saved reports on one page, with one date range and owner filter for all of them.",
          action: canCreate && tab !== "shared" ? <Button type="button" onClick={() => setCreateOpen(true)}><Plus />New dashboard</Button> : undefined,
        }}
      />
      <SaveReportDialog
        open={createOpen}
        noun="dashboard"
        title="New dashboard"
        initialName=""
        initialDescription=""
        submitLabel="Create dashboard"
        isPending={createMutation.isPending}
        onClose={() => setCreateOpen(false)}
        onSave={(details, onError) => createMutation.mutate(details, { onError })}
      />
    </PageShell>
  );
}
