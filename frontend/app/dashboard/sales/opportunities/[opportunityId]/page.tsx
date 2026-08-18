"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";

import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
import {
  getOpportunityStage,
  getOpportunityStageLabel,
  normalizeOpportunityStage,
  OPPORTUNITY_STAGE_ORDER,
} from "@/components/opportunities/opportunityStages";
import CommunicationActions from "@/components/recordActivity/CommunicationActions";
import RecordAuditHistory from "@/components/recordActivity/RecordAuditHistory";
import RecordDeleteButton from "@/components/recordActivity/RecordDeleteButton";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import RecordTimeline from "@/components/recordActivity/RecordTimeline";
import {
  RecordRelatedCard,
  RecordRelatedLink,
  RecordRelatedList,
} from "@/components/recordWorkspace/RecordRelatedList";
import {
  RecordWorkspace,
  recordEditHref,
} from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EMPTY_CELL_VALUE } from "@/components/ui/EmptyValue";
import { InlineFieldEdit, type InlineFieldEditOption } from "@/components/ui/InlineFieldEdit";
import { PanelError, PanelLoading } from "@/components/ui/PanelStates";
import {
  RecordSpine,
  RecordSpineBlock,
  RecordSpineCollection,
  RecordSpineField,
  RecordSpineLink,
  RecordSpineMeta,
  RecordSpineTrack,
} from "@/components/ui/RecordSpine";
import { RouteNotFoundState } from "@/components/ui/RouteStates";
import { StatusValue } from "@/components/ui/StatusValue";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import {
  useResolvedRecordLayout,
  type ResolvedRecordLayout as ResolvedRecordLayoutContract,
} from "@/hooks/useResolvedRecordLayout";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { formatDateTime } from "@/lib/datetime";

type RelatedQuote = {
  quote_id: number;
  quote_number: string;
  title?: string | null;
  customer_name: string;
  status?: string | null;
  currency?: string | null;
  total_amount?: number | string | null;
};

type RelatedInsertionOrder = {
  id: number;
  io_number: string;
  customer_name?: string | null;
  status?: string | null;
  total_amount?: number | null;
  currency?: string | null;
};

type ParticipantContact = {
  id: number;
  contact_id: number;
  role_label: string;
  is_primary: boolean;
  contact_name?: string | null;
  contact: {
    contact_id: number;
    first_name?: string | null;
    last_name?: string | null;
    primary_email?: string | null;
    current_title?: string | null;
  };
};

type OpportunitySummary = {
  opportunity: {
    opportunity_id: number;
    opportunity_name: string;
    client?: string | null;
    sales_stage?: string | null;
    contact_id?: number | null;
    contact_name?: string | null;
    organization_id?: number | null;
    organization_name?: string | null;
    assigned_to?: number | null;
    assigned_to_name?: string | null;
    start_date?: string | null;
    expected_close_date?: string | null;
    probability_percent?: number | string | null;
    campaign_type?: string | null;
    total_leads?: string | null;
    cpl?: string | null;
    total_cost_of_project?: string | null;
    currency_type?: string | null;
    target_geography?: string | null;
    target_audience?: string | null;
    domain_cap?: string | null;
    tactics?: string | null;
    delivery_format?: string | null;
    custom_fields?: Record<string, unknown> | null;
    created_time?: string | null;
    updated_at?: string | null;
  };
  contact?: {
    contact_id: number;
    first_name?: string | null;
    last_name?: string | null;
    primary_email?: string | null;
    contact_telephone?: string | null;
    current_title?: string | null;
  } | null;
  organization?: { org_id: number; org_name: string } | null;
  participant_contacts: ParticipantContact[];
  can_view_contacts: boolean;
  related_quotes: RelatedQuote[];
  related_insertion_orders: RelatedInsertionOrder[];
  inferred_services: string[];
  insertion_order_count: number;
};

/**
 * Fields the spine owns, which `Details` must not draw a second time (design.md §4.7).
 *
 * The seeded layout leaves these out too, but a tenant may add them back through the layout
 * builder, so the page states the rule rather than trusting the seed.
 */
const SPINE_OWNED_FIELDS = [
  "sales_stage",
  "assigned_to",
  "contact_id",
  "organization_id",
] as const;

/**
 * The track shows the pipeline, so the one stage that leaves it is not a step on it.
 *
 * `closed_won` is where the pipeline ends and stays on the track; `closed_lost` is an exit,
 * and drawing it as the last step would say a lost deal is a completed one.
 */
const DEAL_TRACK_VALUES = ["lead", "qualified", "proposal", "negotiation", "closed_won"] as const;

const DEAL_TRACK_STEPS = DEAL_TRACK_VALUES.map((value) => ({
  id: value,
  label: getOpportunityStageLabel(value),
}));

const DEAL_STAGE_OPTIONS: InlineFieldEditOption[] = OPPORTUNITY_STAGE_ORDER.map((value) => ({
  value,
  ...getOpportunityStage(value),
  label: getOpportunityStageLabel(value),
}));

class OpportunitySummaryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fetchSummary(id: string) {
  const res = await apiFetch(`/sales/opportunities/${id}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new OpportunitySummaryRequestError(body?.detail ?? `Failed with ${res.status}`, res.status);
  }
  return body as OpportunitySummary;
}

function contactLabel(summary: OpportunitySummary) {
  return (
    [summary.contact?.first_name, summary.contact?.last_name].filter(Boolean).join(" ")
    || summary.contact?.primary_email
    || summary.opportunity.contact_name
    || summary.opportunity.client
    || null
  );
}

export default function OpportunityDetailPage() {
  const params = useParams<{ opportunityId: string }>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const activeTab = searchParams.get("tab");

  const { modules } = useAccessibleModules();
  const moduleActions = (moduleKey: string) =>
    modules.find((module) => module.name === moduleKey)?.actions;
  const opportunityActions = moduleActions("sales_opportunities");
  const quoteActions = moduleActions("sales_quotes");
  const taskActions = moduleActions("tasks");
  const documentActions = moduleActions("documents");
  const canEditDeal = Boolean(opportunityActions?.can_edit);
  const canDeleteDeal = Boolean(opportunityActions?.can_delete);
  const canViewQuotes = Boolean(quoteActions?.can_view);
  const canViewTasks = Boolean(taskActions?.can_view);
  const canCreateTasks = Boolean(taskActions?.can_create);
  const canEditTasks = Boolean(taskActions?.can_edit);
  const canViewDocuments = Boolean(documentActions?.can_view);
  const canCreateDocuments = Boolean(documentActions?.can_create);
  const canEditDocuments = Boolean(documentActions?.can_edit);
  const canDeleteDocuments = Boolean(documentActions?.can_delete);

  const summaryQuery = useQuery({
    queryKey: ["sales-opportunity-summary", params.opportunityId],
    queryFn: () => fetchSummary(params.opportunityId),
    enabled: Boolean(params.opportunityId),
    refetchOnWindowFocus: false,
  });
  const detailLayoutQuery = useResolvedRecordLayout("sales_opportunities", "detail");

  const summary = summaryQuery.data ?? null;
  const deal = summary?.opportunity;
  const summaryError = summaryQuery.error;
  const notFound =
    summaryError instanceof OpportunitySummaryRequestError && summaryError.status === 404;
  const stage = normalizeOpportunityStage(deal?.sales_stage) || "lead";
  const dealName = deal?.opportunity_name || "Deal";
  const recordHref = `/dashboard/sales/opportunities/${params.opportunityId}`;
  const relatedHref = `${recordHref}?tab=related`;

  /**
   * R1's autosave for the deal's one state field.
   *
   * The pre-5.3 page offered this same write from three places — a six-button stage grid, a
   * `Won`/`Lost` pair in a summary strip, and an `InlineFieldEdit` — which is why §4.7 now
   * says the rail is the only one.
   */
  async function updateStage(next: string) {
    if (!summary || stage === next) return;
    const previous = summary;
    queryClient.setQueryData(["sales-opportunity-summary", params.opportunityId], {
      ...summary,
      opportunity: { ...summary.opportunity, sales_stage: next },
    });
    try {
      const res = await apiFetch(`/sales/opportunities/${params.opportunityId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sales_stage: next }),
      });
      if (!res.ok) throw new Error("The deal stage could not be saved.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-opportunities"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-opportunities-pipeline-summary"] }),
        queryClient.invalidateQueries({
          queryKey: ["record-audit-history", "sales_opportunities", params.opportunityId],
        }),
      ]);
    } catch (error) {
      queryClient.setQueryData(["sales-opportunity-summary", params.opportunityId], previous);
      throw error;
    }
  }

  const dealValue = deal
    ? formatMoney(deal.total_cost_of_project, deal.currency_type)
    : null;

  return (
    <RecordWorkspace
      title={dealName}
      description="Review the deal's stage, commercial terms, related quotes, and activity."
      backHref="/dashboard/sales/opportunities"
      backLabel="Deals"
      isPermissionDenied={
        summaryError instanceof OpportunitySummaryRequestError && summaryError.status === 403
      }
      isLoading={summaryQuery.isLoading || (!summary && !summaryError)}
      hasError={Boolean(summaryError)}
      onRetry={() => void summaryQuery.refetch()}
      errorState={notFound ? (
        <RouteNotFoundState
          titleAs="p"
          recordLabel="Deal"
          backHref="/dashboard/sales/opportunities"
          backLabel="Back to deals"
        />
      ) : undefined}
      status={<StatusValue
        status={{ ...getOpportunityStage(stage), label: getOpportunityStageLabel(stage) }}
        context="record"
      />}
      subtitle={deal ? (
        <>
          {deal.organization_name || deal.client ? (
            <span>{deal.organization_name || deal.client}</span>
          ) : null}
          {dealValue ? <span>{dealValue}</span> : null}
        </>
      ) : null}
      /**
       * No filled button, and that is the archetype rather than an omission (§4.7): a deal
       * moves forward by changing its stage, and the rail owns that field.
       */
      actions={deal ? (
        <>
          <CommunicationActions
            email={summary?.contact?.primary_email}
            phone={summary?.contact?.contact_telephone}
            showCopyActions={false}
            emailContext={{
              moduleKey: "sales_opportunities",
              entityId: deal.opportunity_id,
              recordLabel: dealName,
            }}
          />
          {canEditDeal ? (
            <Button asChild variant="outline">
              <Link href={recordEditHref(`${recordHref}/edit`, activeTab)}>
                <Pencil />
                Edit
              </Link>
            </Button>
          ) : null}
        </>
      ) : null}
      overflowActions={deal && canDeleteDeal ? (
        <RecordDeleteButton
          as="menuItem"
          endpoint={`/sales/opportunities/${params.opportunityId}`}
          label="Deal"
          recordName={dealName}
          redirectHref="/dashboard/sales/opportunities"
          queryKeys={["sales-opportunities", "sales-opportunities-pipeline-summary"]}
        />
      ) : null}
      spine={
        <RecordSpine>
          {summary && deal ? (
            <>
              {DEAL_TRACK_VALUES.includes(stage as (typeof DEAL_TRACK_VALUES)[number]) ? (
                <RecordSpineTrack
                  steps={DEAL_TRACK_STEPS}
                  currentId={stage}
                  label="Deal pipeline"
                />
              ) : null}

              <RecordSpineBlock title="State">
                <RecordSpineField label="Stage">
                  {canEditDeal ? (
                    <InlineFieldEdit
                      fieldLabel="Stage"
                      value={stage}
                      options={DEAL_STAGE_OPTIONS}
                      onCommit={(next) => updateStage(next.value)}
                    />
                  ) : (
                    <StatusValue
                      status={{ ...getOpportunityStage(stage), label: getOpportunityStageLabel(stage) }}
                      context="record"
                    />
                  )}
                </RecordSpineField>
              </RecordSpineBlock>

              <RecordSpineBlock title="Connected">
                <RecordSpineLink
                  label="Contact"
                  value={contactLabel(summary)}
                  href={summary.contact ? `/dashboard/sales/contacts/${summary.contact.contact_id}` : null}
                />
                <RecordSpineLink
                  label="Account"
                  value={summary.organization?.org_name ?? deal.organization_name}
                  href={summary.organization ? `/dashboard/sales/organizations/${summary.organization.org_id}` : null}
                />
                <RecordSpineLink label="Owner" value={deal.assigned_to_name} />
                {summary.can_view_contacts && summary.participant_contacts.length ? (
                  <RecordSpineCollection
                    label="Participants"
                    count={summary.participant_contacts.length}
                    href={relatedHref}
                  />
                ) : null}
                {canViewQuotes ? (
                  <RecordSpineCollection
                    label="Quotes"
                    count={summary.related_quotes.length}
                    href={relatedHref}
                  />
                ) : null}
                <RecordSpineCollection
                  label="Insertion orders"
                  count={summary.insertion_order_count}
                  href={relatedHref}
                />
              </RecordSpineBlock>

              {summary.inferred_services.length ? (
                <RecordSpineBlock title="Services">
                  <div className="text-sm text-copy-primary">
                    {summary.inferred_services.join(", ")}
                  </div>
                </RecordSpineBlock>
              ) : null}

              <RecordSpineMeta
                createdLabel={
                  deal.created_time ? `Created ${formatDateTime(deal.created_time)}` : undefined
                }
                updatedLabel={
                  deal.updated_at ? `Updated ${formatDateTime(deal.updated_at)}` : undefined
                }
                history={
                  <RecordAuditHistory
                    moduleKey="sales_opportunities"
                    entityId={deal.opportunity_id}
                  />
                }
              />
            </>
          ) : null}
        </RecordSpine>
      }
      details={deal ? (
        <DealOverview
          deal={deal}
          layout={detailLayoutQuery.data}
          isLayoutLoading={detailLayoutQuery.isLoading}
          layoutError={detailLayoutQuery.error}
          onRetryLayout={() => void detailLayoutQuery.refetch()}
        />
      ) : null}
      timeline={deal ? (
        <RecordTimeline
          moduleKey="sales_opportunities"
          entityId={deal.opportunity_id}
          canEdit={canEditDeal}
          composer={{
            followUp: canEditDeal
              ? {
                  endpoint: `/sales/opportunities/${deal.opportunity_id}/follow-up`,
                  email: summary?.contact?.primary_email,
                  phone: summary?.contact?.contact_telephone,
                  canCreateTask: canViewTasks && canCreateTasks,
                  onLogged: async () => {
                    await summaryQuery.refetch();
                  },
                }
              : undefined,
          }}
        />
      ) : undefined}
      tasks={deal && canViewTasks ? (
        <RecordTasksPanel
          moduleKey="sales_opportunities"
          entityId={deal.opportunity_id}
          sourceLabel={dealName}
          canCreate={canCreateTasks}
          canEdit={canEditTasks}
          createActionVariant="outline"
        />
      ) : undefined}
      files={deal && canViewDocuments ? (
        <RecordDocumentsPanel
          moduleKey="sales_opportunities"
          entityId={deal.opportunity_id}
          canUpload={canCreateDocuments && canEditDeal}
          canEdit={canEditDocuments && canEditDeal}
          canDelete={canDeleteDocuments && canEditDeal}
        />
      ) : undefined}
      extraTabs={summary ? [
        {
          id: "related",
          label: "Related records",
          content: <RelatedRecords summary={summary} canViewQuotes={canViewQuotes} />,
        },
      ] : []}
    />
  );
}

function DealOverview({
  deal,
  layout,
  isLayoutLoading,
  layoutError,
  onRetryLayout,
}: {
  deal: OpportunitySummary["opportunity"];
  layout?: ResolvedRecordLayoutContract;
  isLayoutLoading: boolean;
  layoutError: Error | null;
  onRetryLayout: () => void;
}) {
  if (isLayoutLoading || !layout) {
    return (
      <Card className="px-5 py-5">
        {layoutError ? (
          <PanelError message="The deal details layout could not be loaded." onRetry={onRetryLayout} />
        ) : (
          <PanelLoading label="Loading deal details…" />
        )}
      </Card>
    );
  }

  return (
    <ReadOnlyRecordLayout
      layout={layout}
      values={deal as unknown as Record<string, unknown>}
      customValues={deal.custom_fields ?? {}}
      omitFieldKeys={SPINE_OWNED_FIELDS}
      renderValue={(field, value) => {
        if (field.field_key === "total_cost_of_project") {
          return formatMoney(value as string | null, deal.currency_type) ?? undefined;
        }
        if (field.field_key !== "probability_percent") return undefined;
        return value === null || value === undefined || value === ""
          ? undefined
          : `${Number(value)}%`;
      }}
    />
  );
}

function RelatedRecords({
  summary,
  canViewQuotes,
}: {
  summary: OpportunitySummary;
  canViewQuotes: boolean;
}) {
  return (
    <RecordRelatedList>
      {summary.can_view_contacts ? (
        <RecordRelatedCard
          title="Participants"
          empty="No contacts are involved in this deal yet."
        >
          {summary.participant_contacts.map((participant) => (
            <RecordRelatedLink
              key={participant.id}
              href={`/dashboard/sales/contacts/${participant.contact_id}`}
              title={
                participant.contact_name
                || [participant.contact.first_name, participant.contact.last_name].filter(Boolean).join(" ")
                || participant.contact.primary_email
                || "Contact"
              }
              detail={`${participant.role_label}${participant.is_primary ? " · Primary" : ""}`}
            />
          ))}
        </RecordRelatedCard>
      ) : null}
      {canViewQuotes ? (
        <RecordRelatedCard title="Quotes" empty="No quotes are linked to this deal yet.">
          {summary.related_quotes.map((quote) => (
            <RecordRelatedLink
              key={quote.quote_id}
              href={`/dashboard/sales/quotes/${quote.quote_id}`}
              title={quote.quote_number}
              detail={`${quote.status || "Unknown status"} · ${formatMoney(quote.total_amount, quote.currency) ?? EMPTY_CELL_VALUE}`}
            />
          ))}
        </RecordRelatedCard>
      ) : null}
      <RecordRelatedCard title="Insertion orders" empty="No related insertion orders yet.">
        {summary.related_insertion_orders.map((order) => (
          <RecordRelatedLink
            key={order.id}
            href={`/dashboard/finance/insertion-orders/${order.id}`}
            title={order.io_number}
            detail={`${order.status || "Unknown status"} · ${formatMoney(order.total_amount, order.currency) ?? EMPTY_CELL_VALUE}`}
          />
        ))}
      </RecordRelatedCard>
    </RecordRelatedList>
  );
}
