"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Rows3 } from "lucide-react";

import { formatDashboardCurrency, type CrmDashboardSummary } from "@/components/dashboard/DashboardCrmWidgets";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { Textarea } from "@/components/ui/textarea";
import type { AccessibleModule } from "@/hooks/useAccessibleModules";
import { getModuleDisplayName } from "@/lib/module-display";
import { getModuleRoute } from "@/lib/module-registry";

function moduleSummaryText(module: AccessibleModule, summary: CrmDashboardSummary | undefined, unreadCount: number) {
  if (module.name === "sales_leads" && summary) return `${summary.lead_status.reduce((total, row) => total + row.count, 0)} leads / ${summary.new_leads} new`;
  if (module.name === "sales_opportunities" && summary) return `${formatDashboardCurrency(summary.pipeline_value)} pipeline`;
  if (module.name === "sales_quotes" && summary) return `${summary.quote_status.reduce((total, row) => total + row.count, 0)} quotes`;
  if (module.name === "tasks" && summary) return `${summary.overdue_follow_ups} overdue / ${summary.upcoming_tasks} upcoming`;
  if (module.name === "mail") return `${unreadCount} unread updates`;
  return module.description || "Available in your access scope";
}

export function DashboardNoteWidget({
  widgetId,
  initialBody,
  onSave,
}: {
  widgetId: string;
  initialBody: string;
  onSave: (id: string, config: Record<string, unknown>) => void;
}) {
  const [body, setBody] = useState(initialBody);
  return (
    <Textarea
      value={body}
      onChange={(event) => setBody(event.target.value)}
      onBlur={() => {
        if (body !== initialBody) onSave(widgetId, { body });
      }}
      maxLength={2000}
      className="min-h-44 resize-y"
      placeholder="Write a quick note..."
      aria-label="Dashboard quick note"
    />
  );
}

export function DashboardSummaryTable({
  modules,
  summary,
  unreadCount,
}: {
  modules: AccessibleModule[];
  summary?: CrmDashboardSummary;
  unreadCount: number;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = modules.filter((item) => {
    const label = getModuleDisplayName(item.name, item.description ?? undefined);
    return `${label} ${item.name} ${item.description ?? ""}`.toLowerCase().includes(normalizedQuery);
  });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Rows3 className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-copy-muted" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-9"
          placeholder="Filter modules..."
          aria-label="Filter dashboard module summaries"
        />
      </div>
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line-default">
        <Table>
          <TableHeader>
            <TableHeaderRow>
              <TableHead>Module</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead>Open</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, 8).map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium text-copy-primary">
                  {getModuleDisplayName(item.name, item.description ?? undefined)}
                </TableCell>
                <TableCell className="text-copy-secondary">{moduleSummaryText(item, summary, unreadCount)}</TableCell>
                <TableCell>
                  <Link
                    href={getModuleRoute(item.name, item.base_route) || "/dashboard/profile"}
                    className="inline-flex items-center gap-1 font-medium text-copy-secondary hover:text-copy-primary"
                  >
                    View
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {!filtered.length ? (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center text-copy-muted">No modules match this filter.</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function DashboardModuleSummary({
  module,
  summary,
  unreadCount,
}: {
  module: AccessibleModule;
  summary?: CrmDashboardSummary;
  unreadCount: number;
}) {
  const moduleName = getModuleDisplayName(module.name, module.description ?? undefined);
  const href = getModuleRoute(module.name, module.base_route) || "/dashboard/profile";
  let value: string | number = "Open";
  let helper = module.description || "Module quick view";

  if (module.name === "sales_leads" && summary) {
    value = summary.lead_status.reduce((total, row) => total + row.count, 0);
    helper = `${summary.new_leads} new in ${summary.period_days} days`;
  } else if (module.name === "sales_opportunities" && summary) {
    value = formatDashboardCurrency(summary.pipeline_value);
    helper = `${summary.won_deals} won / ${summary.lost_deals} lost`;
  } else if (module.name === "sales_quotes" && summary) {
    value = summary.quote_status.reduce((total, row) => total + row.count, 0);
    helper = "Active quote statuses";
  } else if (module.name === "tasks" && summary) {
    value = summary.overdue_follow_ups;
    helper = `${summary.upcoming_tasks} upcoming this week`;
  } else if (module.name === "mail" || module.name === "notifications") {
    value = unreadCount;
    helper = "Unread user updates";
  }

  return (
    <Link
      href={href}
      className="block rounded-[var(--radius-control)] border border-line-subtle px-4 py-4 transition-colors hover:border-line-strong hover:bg-surface-muted"
    >
      <div className="text-xs font-medium text-copy-label">{moduleName}</div>
      <div className="mt-3 text-3xl font-semibold text-copy-primary">{value}</div>
      <div className="mt-2 text-p-sm text-copy-secondary">{helper}</div>
      <div className="mt-4 flex items-center gap-2 text-sm font-medium text-copy-primary">
        Open module
        <ArrowRight className="h-4 w-4" />
      </div>
    </Link>
  );
}
