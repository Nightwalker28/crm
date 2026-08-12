"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
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
import RecordActivityFeed from "@/components/recordActivity/RecordActivityFeed";
import RecordActivityTimeline from "@/components/recordActivity/RecordActivityTimeline";
import RecordCommentsPanel from "@/components/recordActivity/RecordCommentsPanel";
import RecordDeleteButton from "@/components/recordActivity/RecordDeleteButton";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import {
  RecordRelationshipField,
  RecordRelationshipRail,
  RecordWorkspace,
  RecordWorkspaceHeader,
  RecordWorkspacePrimary,
  RecordWorkspaceRegion,
} from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
import { Pill } from "@/components/ui/Pill";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
import { RecordTabs } from "@/components/ui/RecordTabs";
import {
  RouteErrorState,
  RouteLoadingState,
  RouteNotFoundState,
} from "@/components/ui/RouteStates";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
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
import { getLeadScoreStyle, getLeadStatusStyle } from "@/lib/statusStyles";

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

class LeadSummaryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fetchLeadSummary(leadId: string) {
  const res = await apiFetch(`/sales/leads/${leadId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new LeadSummaryRequestError(body?.detail ?? `Failed with ${res.status}`, res.status);
  return body as LeadSummary;
}

function focusWorkspaceControl(regionId: string, controlId: string) {
  const region = document.getElementById(regionId);
  region?.scrollIntoView({ block: "start" });
  window.requestAnimationFrame(() => document.getElementById(controlId)?.focus());
}

export default function LeadDetailPage() {
  const params = useParams<{ leadId: string }>();
  const searchParams = useSearchParams();
  const [taskCreateRequestId, setTaskCreateRequestId] = useState(0);
  const { modules } = useAccessibleModules();
  const {
    fields: moduleFields,
    isLoading: moduleFieldsLoading,
    error: moduleFieldsError,
  } = useModuleFieldConfigs("sales_leads");
  const fieldConfigsReady = !moduleFieldsLoading && !moduleFieldsError;
  const fieldEnabled = (fieldKey: string) =>
    fieldKey === "primary_email"
    || (fieldConfigsReady && isModuleFieldEnabled(moduleFields, fieldKey));

  const moduleActions = (moduleKey: string) =>
    modules.find((module) => module.name === moduleKey)?.actions;
  const leadActions = moduleActions("sales_leads");
  const taskActions = moduleActions("tasks");
  const documentActions = moduleActions("documents");
  const organizationActions = moduleActions("sales_organizations");
  const contactActions = moduleActions("sales_contacts");
  const canEditLead = Boolean(leadActions?.can_edit);
  const canDeleteLead = Boolean(leadActions?.can_delete);
  const canViewTasks = Boolean(taskActions?.can_view);
  const canCreateTasks = Boolean(taskActions?.can_create);
  const canEditTasks = Boolean(taskActions?.can_edit);
  const canViewDocuments = Boolean(documentActions?.can_view);
  const canCreateDocuments = Boolean(documentActions?.can_create);
  const canEditDocuments = Boolean(documentActions?.can_edit);
  const canDeleteDocuments = Boolean(documentActions?.can_delete);
  const canConvertLead = canEditLead
    && Boolean(organizationActions?.can_view || organizationActions?.can_create)
    && Boolean(contactActions?.can_view || contactActions?.can_create);

  const summaryQuery = useQuery({
    queryKey: ["sales-lead-summary", params.leadId],
    queryFn: () => fetchLeadSummary(params.leadId),
    enabled: Boolean(params.leadId),
    refetchOnWindowFocus: false,
  });
  const detailLayoutQuery = useResolvedRecordLayout("sales_leads", "detail");
  const summary = summaryQuery.data ?? null;
  const leadName = summary
    ? `${fieldEnabled("first_name") ? summary.lead.first_name || "" : ""} ${fieldEnabled("last_name") ? summary.lead.last_name || "" : ""}`.trim()
      || summary.lead.primary_email
      || "Lead"
    : "Lead";
  const leadStatusStyle = getLeadStatusStyle(summary?.lead.status || "new");
  const summaryError = summaryQuery.error;
  const requestedTab = searchParams.get("tab");

  useEffect(() => {
    if (!summary) return;
    const legacyRegion = {
      activity: "lead-follow-up",
      related: "lead-tasks",
      notes: "lead-notes",
    }[requestedTab || ""];
    if (!legacyRegion) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(legacyRegion)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedTab, summary]);

  return (
    <RecordWorkspace>
      {!summary ? <RecordPageHeader
        backHref="/dashboard/sales/leads"
        backLabel="Back to Leads"
        title={leadName}
        description="Review the lead record, qualification status, and follow-up history."
      /> : null}

      {summaryError instanceof LeadSummaryRequestError && summaryError.status === 403 ? (
        <PermissionDeniedState />
      ) : summaryError instanceof LeadSummaryRequestError && summaryError.status === 404 ? (
        <RouteNotFoundState recordLabel="Lead" backHref="/dashboard/sales/leads" backLabel="Back to leads" />
      ) : summaryError ? (
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
          <RecordWorkspaceHeader
            title={leadName}
            pageHeader={(
              <RecordPageHeader
                backHref="/dashboard/sales/leads"
                backLabel="Back to Leads"
                title={leadName}
                description="Review the lead record, qualification status, and follow-up history."
                primaryAction={(
                  <>
                    {canDeleteLead ? <RecordDeleteButton
                      endpoint={`/sales/leads/${params.leadId}`}
                      label="Lead"
                      recordName={leadName}
                      redirectHref="/dashboard/sales/leads"
                      queryKeys={["sales-leads"]}
                    /> : null}
                    {canEditLead ? <Button asChild variant="outline">
                      <Link href={`/dashboard/sales/leads/${params.leadId}/edit`}>
                        <Pencil />
                        Edit
                      </Link>
                    </Button> : null}
                  </>
                )}
              />
            )}
            badges={<Pill bg={leadStatusStyle.bg} text={leadStatusStyle.text} border={leadStatusStyle.border}>{leadStatusStyle.label}</Pill>}
            metadata={(
              <>
                {fieldEnabled("company") && summary.lead.company ? <span>{summary.lead.company}</span> : null}
                <span>{summary.lead.primary_email}</span>
                {fieldEnabled("phone") && summary.lead.phone ? <span>{summary.lead.phone}</span> : null}
                {fieldEnabled("assigned_to") ? <span>Owner: {summary.lead.assigned_to_name || "Unassigned"}</span> : null}
              </>
            )}
            actions={(
              <>
              {canConvertLead && summary.lead.status !== "converted" ? <Button asChild type="button" size="sm">
                <Link href={`/dashboard/sales/leads/${summary.lead.lead_id}/convert`}>
                  <ArrowRightLeft />
                  Convert
                </Link>
              </Button> : null}
              <CommunicationActions
                email={summary.lead.primary_email}
                phone={fieldEnabled("phone") ? summary.lead.phone : null}
                showCopyActions={false}
                // Record context only. Which mailbox sends, whether one is
                // connected, and how the message is filed are all decided by
                // the mail domain, not by this page.
                emailContext={{
                  moduleKey: "sales_leads",
                  entityId: summary.lead.lead_id,
                  recordLabel: leadName,
                }}
              />
              {canEditLead ? <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => focusWorkspaceControl("lead-follow-up", "record-follow-up-note")}
              >
                <Activity />
                Follow-up
              </Button> : null}
              {canEditLead ? <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => focusWorkspaceControl(
                  "lead-notes",
                  `record-note-sales_leads-${summary.lead.lead_id}`,
                )}
              >
                <StickyNote />
                Note
              </Button> : null}
              {canViewTasks && canCreateTasks ? <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTaskCreateRequestId((current) => current + 1);
                  document.getElementById("lead-tasks")?.scrollIntoView({ block: "start" });
                }}
              >
                <CheckSquare />
                Task
              </Button> : null}
              </>
            )}
            updatedLabel={<>Updated {summary.lead.updated_at ? formatDateTime(summary.lead.updated_at) : "Not recorded"}</>}
          />

          <RecordWorkspacePrimary
            relationshipRail={(
              fieldConfigsReady ? (
                <LeadRelationshipContext
                  summary={summary}
                  fieldEnabled={fieldEnabled}
                />
              ) : (
                <RecordRelationshipRail description="Known ownership, qualification, and next-action context for this lead.">
                  <p className="text-p-sm text-copy-muted" role={moduleFieldsError ? "alert" : "status"}>
                    {moduleFieldsError ? "Relationship context is unavailable." : "Loading relationship context…"}
                  </p>
                </RecordRelationshipRail>
              )
            )}
          >
            <RecordWorkspaceRegion id="lead-follow-up">
              <FollowUpPanel
                endpoint={`/sales/leads/${summary.lead.lead_id}/follow-up`}
                lastContactedAt={summary.lead.last_contacted_at}
                lastContactedChannel={summary.lead.last_contacted_channel}
                email={summary.lead.primary_email}
                phone={fieldEnabled("phone") ? summary.lead.phone : null}
                canLog={canEditLead}
                canCreateTask={canViewTasks && canCreateTasks}
                onLogged={async () => {
                  await summaryQuery.refetch();
                }}
              />
            </RecordWorkspaceRegion>
            {canViewTasks ? <RecordWorkspaceRegion id="lead-tasks">
              <RecordTasksPanel
                moduleKey="sales_leads"
                entityId={summary.lead.lead_id}
                sourceLabel={leadName}
                canCreate={canCreateTasks}
                canEdit={canEditTasks}
                createRequestId={taskCreateRequestId}
                createActionVariant="outline"
              />
            </RecordWorkspaceRegion> : null}
            <RecordWorkspaceRegion id="lead-notes">
              <RecordCommentsPanel
                moduleKey="sales_leads"
                entityId={summary.lead.lead_id}
                canEdit={canEditLead}
                submitVariant="outline"
              />
            </RecordWorkspaceRegion>
          </RecordWorkspacePrimary>

          <RecordTabs
            urlParam="tab"
            defaultTabId="overview"
            tabs={[
              {
                id: "activity",
                label: "Activity",
                content: (
                  <RecordActivityFeed
                    moduleKey="sales_leads"
                    entityId={summary.lead.lead_id}
                    description="Emails, WhatsApp, meetings, tasks, notes, and follow-ups for this lead."
                  />
                ),
              },
              {
                id: "overview",
                label: "Details",
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
              ...(canViewDocuments ? [{
                id: "files",
                label: "Files",
                content: (
                  <RecordDocumentsPanel
                    moduleKey="sales_leads"
                    entityId={summary.lead.lead_id}
                    canUpload={canCreateDocuments && canEditLead}
                    canEdit={canEditDocuments && canEditLead}
                    canDelete={canDeleteDocuments && canEditLead}
                  />
                ),
              }] : []),
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
    </RecordWorkspace>
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

  if (isLayoutLoading || !layout) {
    return (
      <Card className="px-5 py-5">
        {layoutError ? (
          <div role="alert">
            <h2 className="text-base font-semibold text-copy-primary">Lead details are unavailable</h2>
            <p className="mt-1 text-p-sm text-copy-muted">The configurable details layout could not be loaded.</p>
            <Button className="mt-4" type="button" variant="outline" size="sm" onClick={onRetryLayout}>Try again</Button>
          </div>
        ) : (
          <div role="status" className="text-sm text-copy-muted">Loading lead details…</div>
        )}
      </Card>
    );
  }

  return (
    <ReadOnlyRecordLayout
        layout={layout}
        values={layoutValues}
        customValues={summary.lead.custom_fields ?? {}}
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

function LeadRelationshipContext({
  summary,
  fieldEnabled,
}: {
  summary: LeadSummary;
  fieldEnabled: (fieldKey: string) => boolean;
}) {
  return (
    <RecordRelationshipRail
      description="Known ownership, qualification, and next-action context for this lead."
    >
      {fieldEnabled("score") ? <ScoreTile
        score={summary.lead.score}
        grade={summary.lead.score_grade}
        factors={summary.lead.score_factors ?? []}
        calculatedAt={summary.lead.score_calculated_at}
      /> : null}
      {fieldEnabled("company") ? <RecordRelationshipField
        label="Company"
        value={summary.lead.company || "No company recorded"}
      /> : null}
      {fieldEnabled("assigned_to") ? <RecordRelationshipField
        label="Owner"
        value={summary.lead.assigned_to_name || "Unassigned"}
      /> : null}
      {fieldEnabled("team_id") ? <RecordRelationshipField
        label="Team"
        value={summary.lead.team_name || "No team assigned"}
      /> : null}
      {fieldEnabled("next_follow_up_at") ? <RecordRelationshipField
        label="Next follow-up"
        value={summary.lead.next_follow_up_at
          ? `${formatDateTime(summary.lead.next_follow_up_at)}${summary.lead.next_follow_up_is_overdue ? " · Overdue" : ""}`
          : "Not scheduled"}
      /> : null}
    </RecordRelationshipRail>
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
    <div className={`rounded-[var(--radius-control)] border px-4 py-4 ${gradeStyle.border} ${gradeStyle.bg} ${gradeStyle.text}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium opacity-75">
            Lead score
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-semibold leading-none">
              {score ?? 0}
            </span>
            <span className="text-sm font-medium">{gradeStyle.label}</span>
          </div>
        </div>
        <div className="text-right text-2xs opacity-70">
          {calculatedAt ? formatDateTime(calculatedAt) : "Not calculated"}
        </div>
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-medium opacity-80">
          Factors
        </summary>
        <div className="mt-3 grid gap-2">
          {factors.length ? (
            factors.map((factor) => (
              <div
                key={factor.key}
                className="border-t border-current/15 py-2 first:border-t-0"
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
