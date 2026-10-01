"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, LayoutGrid, Search } from "lucide-react";

import { formatDashboardCurrency, type CrmDashboardSummary } from "@/components/dashboard/DashboardCrmWidgets";
import { Card } from "@/components/ui/Card";
import { RecordTable } from "@/components/ui/RecordTable";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { StatTile } from "@/components/ui/StatTile";
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
      placeholder="Write a quick note…"
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
      {/* The icon was hand-positioned over a plain `Input`; `InputGroup` is the primitive for it. */}
      <InputGroup>
        <InputGroupAddon><Search /></InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter modules"
          aria-label="Filter dashboard module summaries"
        />
      </InputGroup>
      {/* R10: a read-only list is `RecordTable variant="readOnly"`. This was the raw `Table`,
          one of the two importers left outside the primitives and the client portal. */}
      <RecordTable
        variant="readOnly"
        label="Module summaries"
        shellVariant="nested"
        columns={[
          {
            key: "module",
            label: "Module",
            render: (item) => (
              <Link
                href={getModuleRoute(item.name, item.base_route) || "/dashboard/profile"}
                className="font-medium text-copy-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {getModuleDisplayName(item.name, item.description ?? undefined)}
              </Link>
            ),
          },
          { key: "summary", label: "Summary", size: "lg", render: (item) => moduleSummaryText(item, summary, unreadCount) },
        ]}
        rows={filtered.slice(0, 8)}
        rowKey={(item) => item.id}
        emptyState={{ icon: LayoutGrid, title: normalizedQuery ? "No modules match this filter" : "No modules are available yet" }}
      />
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

  // The one metric that is also a link. The box is earned by the click (R8), so it is the
  // interactive card, and the figure inside it is the same `StatTile` every metric uses.
  return (
    <Card variant="interactive" asChild>
      <Link
        href={href}
        className="flex h-full flex-col p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <StatTile label={moduleName} value={value} context={helper} />
        <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-copy-secondary">
          Open module
          <ArrowRight className="size-4" aria-hidden="true" />
        </span>
      </Link>
    </Card>
  );
}
