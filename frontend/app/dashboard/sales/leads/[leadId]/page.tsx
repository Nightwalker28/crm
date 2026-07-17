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
import { RecordTabs } from "@/components/ui/RecordTabs";
import {
  RouteErrorState,
  RouteLoadingState,
} from "@/components/ui/RouteStates";
import {
  isModuleFieldEnabled,
  useModuleFieldConfigs,
} from "@/hooks/useModuleFieldConfigs";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

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

const SCORE_GRADE_STYLES: Record<string, string> = {
  hot: "border-state-success/40 bg-state-success-muted text-state-success",
  warm: "border-state-warning/40 bg-state-warning-muted text-state-warning",
  cold: "border-line-default bg-surface-muted text-copy-muted",
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
                  <LeadOverview summary={summary} fieldEnabled={fieldEnabled} />
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
  fieldEnabled,
}: {
  summary: LeadSummary;
  fieldEnabled: (fieldKey: string) => boolean;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <Card className="px-5 py-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-copy-primary">
            Lead details
          </h2>
          <p className="mt-1 text-sm text-copy-muted">
            Core contact and qualification information.
          </p>
        </div>
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          {fieldEnabled("primary_email") ? (
            <DetailField label="Email" value={summary.lead.primary_email} />
          ) : null}
          {fieldEnabled("phone") ? (
            <DetailField label="Phone" value={summary.lead.phone} />
          ) : null}
          {fieldEnabled("company") ? (
            <DetailField label="Company" value={summary.lead.company} />
          ) : null}
          {fieldEnabled("title") ? (
            <DetailField label="Job title" value={summary.lead.title} />
          ) : null}
          {fieldEnabled("source") ? (
            <DetailField label="Source" value={summary.lead.source} />
          ) : null}
          {fieldEnabled("status") ? (
            <DetailField
              label="Status"
              value={(summary.lead.status || "new").replace(/_/g, " ")}
              capitalize
            />
          ) : null}
          {fieldEnabled("assigned_to") ? (
            <DetailField label="Owner" value={summary.lead.assigned_to_name} />
          ) : null}
          {fieldEnabled("team_id") ? (
            <DetailField label="Team" value={summary.lead.team_name} />
          ) : null}
          {fieldEnabled("next_follow_up_at") ? (
            <FollowUpDetail
              value={summary.lead.next_follow_up_at}
              isOverdue={summary.lead.next_follow_up_is_overdue}
            />
          ) : null}
        </div>
        {fieldEnabled("notes") ? (
          <div className="mt-5 border-t border-line-subtle pt-5">
            <DetailField label="Notes" value={summary.lead.notes} />
          </div>
        ) : null}
        {fieldEnabled("tags") && (summary.lead.tags ?? []).length ? (
          <div className="mt-5 border-t border-line-subtle pt-5">
            <div className="text-xs font-medium uppercase tracking-wide text-copy-muted">
              Tags
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(summary.lead.tags ?? []).map((tag) => (
                <span
                  key={tag.toLocaleLowerCase()}
                  className="rounded-full border border-line-default bg-surface-muted px-2.5 py-1 text-xs text-copy-secondary"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {Object.keys(summary.lead.custom_fields ?? {}).length ? (
          <details className="mt-5 border-t border-line-subtle pt-5">
            <summary className="cursor-pointer text-sm font-medium text-copy-primary">
              Custom fields
            </summary>
            <div className="mt-4 grid gap-x-6 gap-y-4 md:grid-cols-2">
              {Object.entries(summary.lead.custom_fields ?? {}).map(
                ([key, value]) => (
                  <DetailField
                    key={key}
                    label={key.replace(/_/g, " ")}
                    value={formatFieldValue(value)}
                  />
                ),
              )}
            </div>
          </details>
        ) : null}
      </Card>

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
    </div>
  );
}

function FollowUpDetail({
  value,
  isOverdue = false,
}: {
  value?: string | null;
  isOverdue?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-copy-muted">
        Next follow-up
      </div>
      <div
        className={`mt-1 text-sm ${isOverdue ? "font-medium text-state-warning" : "text-copy-secondary"}`}
      >
        {value
          ? `${formatDateTime(value)}${isOverdue ? " · Overdue" : ""}`
          : "Not scheduled"}
      </div>
    </div>
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
  const normalizedGrade = grade || "cold";
  const gradeClassName =
    SCORE_GRADE_STYLES[normalizedGrade] ?? SCORE_GRADE_STYLES.cold;
  return (
    <div className={`rounded-md border px-4 py-4 ${gradeClassName}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide opacity-75">
            Lead Score
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-semibold leading-none">
              {score ?? 0}
            </span>
            <span className="text-sm font-medium capitalize">
              {normalizedGrade}
            </span>
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
                className="rounded border border-current/15 bg-black/10 px-3 py-2"
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

function DetailField({
  label,
  value,
  capitalize = false,
}: {
  label: string;
  value?: string | null;
  capitalize?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-copy-muted">
        {label}
      </div>
      <div
        className={`mt-1 text-sm text-copy-secondary ${capitalize ? "capitalize" : ""}`}
      >
        {value || "Not recorded"}
      </div>
    </div>
  );
}

function formatFieldValue(value: unknown) {
  if (value === null || value === undefined || value === "")
    return "Not recorded";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
