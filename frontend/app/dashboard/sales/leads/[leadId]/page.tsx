"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRightLeft,
  CheckSquare,
  Pencil,
  StickyNote,
} from "lucide-react";

import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import CommunicationActions from "@/components/recordActivity/CommunicationActions";
import FollowUpPanel from "@/components/recordActivity/FollowUpPanel";
import RecordActivityTimeline from "@/components/recordActivity/RecordActivityTimeline";
import RecordCommentsPanel from "@/components/recordActivity/RecordCommentsPanel";
import RecordDeleteButton from "@/components/recordActivity/RecordDeleteButton";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
import { RecordTabs } from "@/components/ui/RecordTabs";
import {
  RouteErrorState,
  RouteLoadingState,
} from "@/components/ui/RouteStates";
import {
  isModuleFieldEnabled,
  useModuleFieldConfigs,
} from "@/hooks/useModuleFieldConfigs";
import {
  useResolvedRecordLayout,
  type ResolvedRecordLayout as ResolvedRecordLayoutContract,
} from "@/hooks/useResolvedRecordLayout";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { getLeadScoreStyle } from "@/lib/statusStyles";

type LeadScoreFactor = {
  key: string;
  label: string;
  points: number;
  reason: string;
};

type LeadSummary = {
  lead: {
    lead_id: number;
    first_name?: string | null;
    last_name?: string | null;
    company?: string | null;
    primary_email: string;
    phone?: string | null;
    title?: string | null;
    source?: string | null;
    status?: string | null;
    notes?: string | null;
    last_contacted_at?: string | null;
    next_follow_up_at?: string | null;
    next_follow_up_is_overdue?: boolean;
    team_id?: number | null;
    team_name?: string | null;
    tags?: string[];
    last_contacted_channel?: string | null;
    score?: number | null;
    score_grade?: string | null;
    score_factors?: LeadScoreFactor[] | null;
    score_calculated_at?: string | null;
    custom_fields?: Record<string, unknown> | null;
    updated_at?: string | null;
    assigned_to?: number | null;
    assigned_to_name?: string | null;
  };
};

async function fetchLeadSummary(leadId: string) {
  const res = await apiFetch(`/sales/leads/${leadId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body as LeadSummary;
}

export default function LeadDetailPage() {
  const params = useParams<{ leadId: string }>();
  const { fields: moduleFields } = useModuleFieldConfigs("sales_leads");
  const fieldEnabled = (fieldKey: string) =>
    isModuleFieldEnabled(moduleFields, fieldKey);

  const summaryQuery = useQuery({
    queryKey: ["sales-lead-summary", params.leadId],
    queryFn: () => fetchLeadSummary(params.leadId),
    enabled: Boolean(params.leadId),
    refetchOnWindowFocus: false,
  });
  const detailLayoutQuery = useResolvedRecordLayout("sales_leads", "detail");
  const summary = summaryQuery.data ?? null;

  return (
    <div className="flex flex-col gap-6 text-copy-secondary">
      <RecordPageHeader
        backHref="/dashboard/sales/leads"
        backLabel="Back to Leads"
        title={
          summary
            ? `${summary.lead.first_name || ""} ${summary.lead.last_name || ""}`.trim() ||
              summary.lead.primary_email ||
              "Lead"
            : "Lead"
        }
        description="Review the lead record, qualification status, and follow-up history."
        primaryAction={
          <>
            <RecordDeleteButton
              endpoint={`/sales/leads/${params.leadId}`}
              label="Lead"
              recordName={
                summary
                  ? `${summary.lead.first_name || ""} ${summary.lead.last_name || ""}`.trim() ||
                    summary.lead.primary_email
                  : "this lead"
              }
              redirectHref="/dashboard/sales/leads"
              queryKeys={["sales-leads"]}
            />
            <Button asChild>
              <Link href={`/dashboard/sales/leads/${params.leadId}/edit`}>
                <Pencil />
                Edit
              </Link>
            </Button>
          </>
        }
      />

      {summaryQuery.error ? (
        <RouteErrorState
          title="Unable to load this lead"
          reset={() => void summaryQuery.refetch()}
          backHref="/dashboard/sales/leads"
          backLabel="Back to leads"
        />
      ) : summaryQuery.isLoading || !summary ? (
        <RouteLoadingState label="lead" />
      ) : (
        <>
          <Card className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                asChild={summary.lead.status !== "converted"}
                type="button"
                size="sm"
                disabled={summary.lead.status === "converted"}
              >
                {summary.lead.status === "converted" ? (
                  <>
                    <ArrowRightLeft />
                    Converted
                  </>
                ) : (
                  <Link
                    href={`/dashboard/sales/leads/${summary.lead.lead_id}/convert`}
                  >
                    <ArrowRightLeft />
                    Convert
                  </Link>
                )}
              </Button>
              <CommunicationActions
                email={summary.lead.primary_email}
                phone={fieldEnabled("phone") ? summary.lead.phone : null}
              />
              <Button asChild type="button" size="sm" variant="ghost">
                <Link href="?tab=activity" scroll={false}>
                  <Activity />
                  Add activity
                </Link>
              </Button>
              <Button asChild type="button" size="sm" variant="ghost">
                <Link href={`?tab=notes`} scroll={false}>
                  <StickyNote />
                  Note
                </Link>
              </Button>
              <Button asChild type="button" size="sm" variant="ghost">
                <Link href={`?tab=related`} scroll={false}>
                  <CheckSquare />
                  Task
                </Link>
              </Button>
              <div className="ml-auto text-xs text-copy-muted">
                Updated:{" "}
                {summary.lead.updated_at
                  ? formatDateTime(summary.lead.updated_at)
                  : "Not recorded"}
              </div>
            </div>
          </Card>

          <RecordTabs
            urlParam="tab"
            defaultTabId="overview"
            tabs={[
              {
                id: "overview",
                label: "Overview",
                content: (
                  <LeadOverview
                    summary={summary}
                    layout={detailLayoutQuery.data}
                    isLayoutLoading={detailLayoutQuery.isLoading}
                    layoutError={detailLayoutQuery.error}
                    onRetryLayout={() => void detailLayoutQuery.refetch()}
                  />
                ),
              },
              {
                id: "activity",
                label: "Activity",
                content: (
                  <FollowUpPanel
                    endpoint={`/sales/leads/${summary.lead.lead_id}/follow-up`}
                    lastContactedAt={summary.lead.last_contacted_at}
                    lastContactedChannel={summary.lead.last_contacted_channel}
                    email={summary.lead.primary_email}
                    phone={summary.lead.phone}
                    onLogged={async () => {
                      await summaryQuery.refetch();
                    }}
                  />
                ),
              },
              {
                id: "related",
                label: "Related records",
                content: (
                  <RecordTasksPanel
                    moduleKey="sales_leads"
                    entityId={summary.lead.lead_id}
                    sourceLabel={
                      `${summary.lead.first_name || ""} ${summary.lead.last_name || ""}`.trim() ||
                      summary.lead.primary_email
                    }
                  />
                ),
              },
              {
                id: "notes",
                label: "Notes",
                content: (
                  <RecordCommentsPanel
                    moduleKey="sales_leads"
                    entityId={summary.lead.lead_id}
                  />
                ),
              },
              {
                id: "files",
                label: "Files",
                content: (
                  <RecordDocumentsPanel
                    moduleKey="sales_leads"
                    entityId={summary.lead.lead_id}
                  />
                ),
              },
              {
                id: "audit",
                label: "Audit history",
                content: (
                  <RecordActivityTimeline
                    moduleKey="sales_leads"
                    entityId={summary.lead.lead_id}
                    title="Audit history"
                    description="Chronological record changes and collaboration events for this lead."
                  />
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}

function LeadOverview({
  summary,
  layout,
  isLayoutLoading,
  layoutError,
  onRetryLayout,
}: {
  summary: LeadSummary;
  layout?: ResolvedRecordLayoutContract;
  isLayoutLoading: boolean;
  layoutError: Error | null;
  onRetryLayout: () => void;
}) {
  const layoutValues: Record<string, unknown> = {
    ...summary.lead,
    assigned_to: summary.lead.assigned_to_name,
    team_id: summary.lead.team_name,
  };
  const summaryCard = <LeadSummaryCard summary={summary} />;

  if (isLayoutLoading || !layout) {
    return (
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,0.8fr)]">
        <Card className="px-5 py-5">
          {layoutError ? (
            <div role="alert">
              <h2 className="text-base font-semibold text-copy-primary">Lead details are unavailable</h2>
              <p className="mt-1 text-sm text-copy-muted">The configurable details layout could not be loaded.</p>
              <Button className="mt-4" type="button" variant="outline" size="sm" onClick={onRetryLayout}>Try again</Button>
            </div>
          ) : (
            <div role="status" className="text-sm text-copy-muted">Loading Lead details…</div>
          )}
        </Card>
        {summaryCard}
      </div>
    );
  }

  return (
    <ReadOnlyRecordLayout
        layout={layout}
        values={layoutValues}
        customValues={summary.lead.custom_fields ?? {}}
        fixedSidebar={summaryCard}
        renderValue={(field, value) => {
          if (field.field_key === "tags" && Array.isArray(value)) {
            return value.length ? (
              <div className="flex flex-wrap gap-2">
                {value.map((tag) => (
                  <span
                    key={String(tag).toLocaleLowerCase()}
                    className="rounded-full border border-line-default bg-surface-muted px-2.5 py-1 text-xs text-copy-secondary"
                  >
                    {String(tag)}
                  </span>
                ))}
              </div>
            ) : "Not recorded";
          }
          if (field.field_key !== "next_follow_up_at") return undefined;
          return value
            ? `${formatDateTime(String(value))}${summary.lead.next_follow_up_is_overdue ? " · Overdue" : ""}`
            : "Not scheduled";
        }}
    />
  );
}

function LeadSummaryCard({ summary }: { summary: LeadSummary }) {
  return (
    <Card className="px-5 py-5">
        <h2 className="text-lg font-semibold text-copy-primary">Summary</h2>
        <div className="mt-4 grid gap-3">
          <ScoreTile
            score={summary.lead.score}
            grade={summary.lead.score_grade}
            factors={summary.lead.score_factors ?? []}
            calculatedAt={summary.lead.score_calculated_at}
          />
          <SummaryTile
            label="Company"
            value={summary.lead.company || "No company recorded"}
          />
          <SummaryTile
            label="Source"
            value={summary.lead.source || "No source recorded"}
          />
          <SummaryTile
            label="Status"
            value={(summary.lead.status || "new").replace(/_/g, " ")}
          />
        </div>
    </Card>
  );
}

function ScoreTile({
  score,
  grade,
  factors,
  calculatedAt,
}: {
  score?: number | null;
  grade?: string | null;
  factors: LeadScoreFactor[];
  calculatedAt?: string | null;
}) {
  const gradeStyle = getLeadScoreStyle(grade || "cold");
  return (
    <div className={`rounded-md border px-4 py-4 ${gradeStyle.border} ${gradeStyle.bg} ${gradeStyle.text}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide opacity-75">
            Lead Score
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-semibold leading-none">
              {score ?? 0}
            </span>
            <span className="text-sm font-medium">{gradeStyle.label}</span>
          </div>
        </div>
        <div className="text-right text-[11px] opacity-70">
          {calculatedAt ? formatDateTime(calculatedAt) : "Not calculated"}
        </div>
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide opacity-80">
          Factors
        </summary>
        <div className="mt-3 grid gap-2">
          {factors.length ? (
            factors.map((factor) => (
              <div
                key={factor.key}
                className="rounded border border-current/15 bg-app/20 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{factor.label}</span>
                  <span>+{factor.points}</span>
                </div>
                <div className="mt-1 text-xs opacity-75">{factor.reason}</div>
              </div>
            ))
          ) : (
            <div className="text-xs opacity-75">
              No scoring factors recorded.
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-copy-muted">
        {label}
      </div>
      <div className="mt-2 text-sm capitalize text-copy-primary">{value}</div>
    </div>
  );
}
