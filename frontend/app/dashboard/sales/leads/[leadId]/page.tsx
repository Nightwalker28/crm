"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Pencil } from "lucide-react";

import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import CommunicationActions from "@/components/recordActivity/CommunicationActions";
import RecordAuditHistory from "@/components/recordActivity/RecordAuditHistory";
import RecordDeleteButton from "@/components/recordActivity/RecordDeleteButton";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import RecordTimeline from "@/components/recordActivity/RecordTimeline";
import {
  RecordWorkspace,
  recordEditHref,
} from "@/components/recordWorkspace/RecordWorkspace";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyValue } from "@/components/ui/EmptyValue";
import { InlineFieldEdit, type InlineFieldEditOption } from "@/components/ui/InlineFieldEdit";
import { PanelError, PanelLoading } from "@/components/ui/PanelStates";
import {
  RecordSpine,
  RecordSpineBlock,
  RecordSpineField,
  RecordSpineLink,
  RecordSpineMeta,
  RecordSpineTrack,
} from "@/components/ui/RecordSpine";
import { RouteNotFoundState } from "@/components/ui/RouteStates";
import { StatusValue } from "@/components/ui/StatusValue";
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
import { getLeadScoreGrade, getLeadStatus } from "@/lib/statusStyles";

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

const LEAD_STATUS_VALUES = ["new", "contacted", "qualified", "unqualified", "converted"] as const;

/**
 * Fields the spine owns, which `Details` must not draw a second time (design.md §4.7).
 *
 * The record layout is configured server-side and still lists these, because it predates
 * the spine — so without this the page renders an editable status in the rail and a
 * read-only copy of it in the tab beside, which is the exact confusion R2 exists to avoid.
 */
const SPINE_OWNED_FIELDS = ["status", "assigned_to", "team_id", "next_follow_up_at"] as const;

/** The track shows a pipeline, so the one status that leaves it is not a step on it. */
const LEAD_TRACK_VALUES = ["new", "contacted", "qualified", "converted"] as const;

const LEAD_STATUS_OPTIONS: InlineFieldEditOption[] = LEAD_STATUS_VALUES.map((value) => ({
  value,
  ...getLeadStatus(value),
}));

const LEAD_TRACK_STEPS = LEAD_TRACK_VALUES.map((value) => ({
  id: value,
  label: getLeadStatus(value).label,
}));

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

export default function LeadDetailPage() {
  const params = useParams<{ leadId: string }>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const activeTab = searchParams.get("tab");
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
  const lead = summary?.lead;
  const leadName = summary
    ? `${fieldEnabled("first_name") ? summary.lead.first_name || "" : ""} ${fieldEnabled("last_name") ? summary.lead.last_name || "" : ""}`.trim()
      || summary.lead.primary_email
      || "Lead"
    : "Lead";
  const status = lead?.status || "new";
  const summaryError = summaryQuery.error;
  const notFound = summaryError instanceof LeadSummaryRequestError && summaryError.status === 404;

  /**
   * R1's autosave for a state field. The write is a single-field `PUT` — the request
   * schema is `exclude_unset`, so it patches — and the optimistic update is what moves
   * `InlineFieldEdit`'s value, since the control deliberately holds no copy of its own.
   * Throwing puts its indicator into `error` and rolls the cache back.
   */
  async function updateStatus(next: string) {
    if (!summary || status === next) return;
    const previous = summary;
    queryClient.setQueryData(["sales-lead-summary", params.leadId], {
      ...summary,
      lead: { ...summary.lead, status: next },
    });
    try {
      const res = await apiFetch(`/sales/leads/${params.leadId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("The lead status could not be saved.");
      await queryClient.invalidateQueries({ queryKey: ["sales-leads"] });
      await queryClient.invalidateQueries({
        queryKey: ["record-audit-history", "sales_leads", params.leadId],
      });
    } catch (error) {
      queryClient.setQueryData(["sales-lead-summary", params.leadId], previous);
      throw error;
    }
  }

  return (
    <RecordWorkspace
      title={leadName}
      description="Review the lead record, qualification status, and follow-up history."
      backHref="/dashboard/sales/leads"
      backLabel="Leads"
      isPermissionDenied={summaryError instanceof LeadSummaryRequestError && summaryError.status === 403}
      isLoading={summaryQuery.isLoading || (!summary && !summaryError)}
      hasError={Boolean(summaryError)}
      onRetry={() => void summaryQuery.refetch()}
      errorState={notFound ? (
        <RouteNotFoundState
          titleAs="p"
          recordLabel="Lead"
          backHref="/dashboard/sales/leads"
          backLabel="Back to leads"
        />
      ) : undefined}
      status={<StatusValue status={getLeadStatus(status)} context="record" />}
      subtitle={lead ? (
        <>
          {fieldEnabled("company") && lead.company ? <span>{lead.company}</span> : null}
          <span>{lead.primary_email}</span>
          {fieldEnabled("phone") && lead.phone ? <span>{lead.phone}</span> : null}
        </>
      ) : null}
      actions={lead ? (
        <>
          {canConvertLead && lead.status !== "converted" ? (
            <Button asChild>
              <Link href={`/dashboard/sales/leads/${lead.lead_id}/convert`}>
                <ArrowRightLeft />
                Convert
              </Link>
            </Button>
          ) : null}
          <CommunicationActions
            email={lead.primary_email}
            phone={fieldEnabled("phone") ? lead.phone : null}
            showCopyActions={false}
            // Record context only. Which mailbox sends, whether one is connected, and how
            // the message is filed are all decided by the mail domain, not by this page.
            emailContext={{
              moduleKey: "sales_leads",
              entityId: lead.lead_id,
              recordLabel: leadName,
            }}
          />
          {canEditLead ? (
            <Button asChild variant="outline">
              {/* R2: the round trip preserves `?tab=` in both directions, so editing from
                  Files comes back to Files rather than dumping you on Details. */}
              <Link href={recordEditHref(`/dashboard/sales/leads/${lead.lead_id}/edit`, activeTab)}>
                <Pencil />
                Edit
              </Link>
            </Button>
          ) : null}
        </>
      ) : null}
      overflowActions={lead && canDeleteLead ? (
        <RecordDeleteButton
          as="menuItem"
          endpoint={`/sales/leads/${params.leadId}`}
          label="Lead"
          recordName={leadName}
          redirectHref="/dashboard/sales/leads"
          queryKeys={["sales-leads"]}
        />
      ) : null}
      spine={
        <RecordSpine>
          {lead ? (
            <>
              {LEAD_TRACK_VALUES.includes(status as (typeof LEAD_TRACK_VALUES)[number]) ? (
                <RecordSpineTrack steps={LEAD_TRACK_STEPS} currentId={status} label="Lead lifecycle" />
              ) : null}

              <RecordSpineBlock title="State">
                <RecordSpineField label="Status">
                  {canEditLead ? (
                    <InlineFieldEdit
                      fieldLabel="Status"
                      value={status}
                      options={LEAD_STATUS_OPTIONS}
                      onCommit={(next) => updateStatus(next.value)}
                    />
                  ) : (
                    <StatusValue status={getLeadStatus(status)} context="record" />
                  )}
                </RecordSpineField>
                {fieldEnabled("next_follow_up_at") ? (
                  <RecordSpineField label="Next follow-up">
                    {lead.next_follow_up_at ? (
                      <>
                        {formatDateTime(lead.next_follow_up_at)}
                        {lead.next_follow_up_is_overdue ? (
                          <span className="ml-2 text-state-warning">Overdue</span>
                        ) : null}
                      </>
                    ) : (
                      <EmptyValue context="field" />
                    )}
                  </RecordSpineField>
                ) : null}
              </RecordSpineBlock>

              <RecordSpineBlock title="Connected">
                {fieldEnabled("company") ? (
                  <RecordSpineLink label="Company" value={lead.company} />
                ) : null}
                {fieldEnabled("assigned_to") ? (
                  <RecordSpineLink label="Owner" value={lead.assigned_to_name} />
                ) : null}
                {fieldEnabled("team_id") ? (
                  <RecordSpineLink label="Team" value={lead.team_name} />
                ) : null}
              </RecordSpineBlock>

              {fieldEnabled("score") ? (
                <RecordSpineBlock title="Lead score">
                  <LeadScore
                    score={lead.score}
                    grade={lead.score_grade}
                    factors={lead.score_factors ?? []}
                    calculatedAt={lead.score_calculated_at}
                  />
                </RecordSpineBlock>
              ) : null}

              <RecordSpineMeta
                updatedLabel={
                  lead.updated_at ? `Updated ${formatDateTime(lead.updated_at)}` : undefined
                }
                history={<RecordAuditHistory moduleKey="sales_leads" entityId={lead.lead_id} />}
              />
            </>
          ) : null}
        </RecordSpine>
      }
      details={lead ? (
        <LeadOverview
          summary={{ lead }}
          layout={detailLayoutQuery.data}
          isLayoutLoading={detailLayoutQuery.isLoading}
          layoutError={detailLayoutQuery.error}
          onRetryLayout={() => void detailLayoutQuery.refetch()}
        />
      ) : null}
      timeline={lead ? (
        <RecordTimeline
          moduleKey="sales_leads"
          entityId={lead.lead_id}
          canEdit={canEditLead}
          composer={{
            followUp: canEditLead
              ? {
                  endpoint: `/sales/leads/${lead.lead_id}/follow-up`,
                  email: lead.primary_email,
                  phone: fieldEnabled("phone") ? lead.phone : null,
                  canCreateTask: canViewTasks && canCreateTasks,
                  onLogged: async () => {
                    await summaryQuery.refetch();
                  },
                }
              : undefined,
          }}
        />
      ) : undefined}
      tasks={lead && canViewTasks ? (
        <RecordTasksPanel
          moduleKey="sales_leads"
          entityId={lead.lead_id}
          sourceLabel={leadName}
          canCreate={canCreateTasks}
          canEdit={canEditTasks}
          createActionVariant="outline"
        />
      ) : undefined}
      files={lead && canViewDocuments ? (
        <RecordDocumentsPanel
          moduleKey="sales_leads"
          entityId={lead.lead_id}
          canUpload={canCreateDocuments && canEditLead}
          canEdit={canEditDocuments && canEditLead}
          canDelete={canDeleteDocuments && canEditLead}
        />
      ) : undefined}
    />
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
          <PanelError message="The lead details layout could not be loaded." onRetry={onRetryLayout} />
        ) : (
          <PanelLoading label="Loading lead details…" />
        )}
      </Card>
    );
  }

  return (
    <ReadOnlyRecordLayout
      layout={layout}
      values={layoutValues}
      customValues={summary.lead.custom_fields ?? {}}
      omitFieldKeys={SPINE_OWNED_FIELDS}
      renderValue={(field, value) => {
        if (field.field_key === "tags" && Array.isArray(value)) {
          return value.length ? (
            <div className="flex flex-wrap gap-2">
              {value.map((tag) => (
                <Chip key={String(tag).toLocaleLowerCase()}>{String(tag)}</Chip>
              ))}
            </div>
          ) : undefined;
        }
        if (field.field_key !== "next_follow_up_at") return undefined;
        return value
          ? `${formatDateTime(String(value))}${summary.lead.next_follow_up_is_overdue ? " · Overdue" : ""}`
          : undefined;
      }}
    />
  );
}

/**
 * The lead's score, in the spine.
 *
 * No tone: a grade is a category, not an outcome — no value is better than another and none
 * is a deviation, so painting it by grade says something colour is not entitled to say (R5).
 * The figure takes the one stat-figure size (§3.3).
 */
function LeadScore({
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
  const gradeStyle = getLeadScoreGrade(grade || "cold");

  return (
    <div data-slot="lead-score">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums leading-none text-copy-primary">
          {score ?? 0}
        </span>
        <span className="text-sm text-copy-secondary">{gradeStyle.label}</span>
      </div>
      <div className="mt-1 text-xs text-copy-muted">
        {calculatedAt ? formatDateTime(calculatedAt) : "Not calculated"}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-copy-label">Factors</summary>
        <div className="mt-2 divide-y divide-line-subtle">
          {factors.length ? (
            factors.map((factor) => (
              <div key={factor.key} className="py-2 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3 text-sm text-copy-primary">
                  <span>{factor.label}</span>
                  <span className="tabular-nums">+{factor.points}</span>
                </div>
                <div className="mt-0.5 text-xs text-copy-muted">{factor.reason}</div>
              </div>
            ))
          ) : (
            <div className="text-xs text-copy-muted">No scoring factors recorded.</div>
          )}
        </div>
      </details>
    </div>
  );
}
