"use client";

import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
import RecordAuditHistory, {
  type RecordModuleEvent,
} from "@/components/recordActivity/RecordAuditHistory";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import RecordTimeline from "@/components/recordActivity/RecordTimeline";
import { RecordWorkspace } from "@/components/recordWorkspace/RecordWorkspace";
import { Card } from "@/components/ui/Card";
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
import {
  SUPPORT_CASES_QUERY_KEY,
  SUPPORT_CASES_SUMMARY_QUERY_KEY,
  supportCaseQueryKey,
  type SupportCase,
  useSupportCase,
} from "@/hooks/support/useCases";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import {
  useResolvedRecordLayout,
  type ResolvedRecordLayout as ResolvedRecordLayoutContract,
} from "@/hooks/useResolvedRecordLayout";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { getSupportCasePriority, getSupportCaseStatus } from "@/lib/statusStyles";

const STATUSES = ["new", "open", "pending", "resolved", "closed"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const CATEGORIES = ["general", "billing", "technical", "order", "account"] as const;

const STATUS_OPTIONS: InlineFieldEditOption[] = STATUSES.map((value) => ({
  value,
  ...getSupportCaseStatus(value),
}));
const PRIORITY_OPTIONS: InlineFieldEditOption[] = PRIORITIES.map((value) => ({
  value,
  ...getSupportCasePriority(value),
}));

const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = {
  general: "General",
  billing: "Billing",
  technical: "Technical",
  order: "Order",
  account: "Account",
};

/** Category is a category, not a status (R5) — no tone, ever. */
const CATEGORY_OPTIONS: InlineFieldEditOption[] = CATEGORIES.map((value) => ({
  value,
  tone: null,
  label: CATEGORY_LABELS[value],
}));

/**
 * A case's whole set is its pipeline: `closed` completes it rather than leaving it, so unlike
 * a quote's `cancelled` or an order's, nothing here is an exit and every status is a step.
 */
const CASE_TRACK_STEPS = STATUSES.map((value) => ({
  id: value,
  label: getSupportCaseStatus(value).label,
}));

/**
 * Every event type `cases_services` writes, spelled out rather than title-cased at runtime.
 *
 * The runtime title-caser this replaces turned `client_replied` into `Client Replied` — §3.5
 * shouting a source-level grep cannot see, and the `client_*` prefix said "portal" to nobody.
 */
const CASE_EVENT_LABELS: Record<string, string> = {
  created: "Case created",
  updated: "Case updated",
  status_changed: "Status changed",
  commented: "Reply added",
  client_created: "Case opened from the portal",
  client_replied: "Customer replied in the portal",
  client_status_changed: "Status changed from the portal",
};

/**
 * Fields `Details` must not draw a second time (design.md §4.7): the header owns the subject
 * and the case number, and the spine owns status, priority, category and the assignee.
 */
const SPINE_OWNED_FIELDS = [
  "subject",
  "case_number",
  "status",
  "priority",
  "category",
  "assigned_to_id",
] as const;

export default function SupportCaseDetailPage() {
  const params = useParams<{ caseId: string }>();
  const queryClient = useQueryClient();
  const { modules } = useAccessibleModules();

  const moduleActions = (moduleKey: string) =>
    modules.find((module) => module.name === moduleKey)?.actions;
  const caseActions = moduleActions("support_cases");
  const taskActions = moduleActions("tasks");
  const documentActions = moduleActions("documents");
  const canEdit = Boolean(caseActions?.can_edit);
  const canViewTasks = Boolean(taskActions?.can_view);
  const canViewDocuments = Boolean(documentActions?.can_view);

  const caseQuery = useSupportCase(params.caseId);
  const detailLayoutQuery = useResolvedRecordLayout("support_cases", "detail");

  const item = caseQuery.data ?? null;
  const notFound = caseQuery.error instanceof Error && caseQuery.error.message === "not-found";
  const caseName = item?.subject || "Support case";

  async function updateField(field: "status" | "priority" | "category", next: string) {
    if (!item) return;
    const res = await apiFetch(`/support/cases/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: next }),
    });
    const body = (await res.json().catch(() => null)) as SupportCase | null;
    if (!res.ok || !body) throw new Error("The case could not be saved.");
    queryClient.setQueryData(supportCaseQueryKey(item.id), body);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: SUPPORT_CASES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: SUPPORT_CASES_SUMMARY_QUERY_KEY }),
      queryClient.invalidateQueries({
        queryKey: ["record-audit-history", "support_cases", String(item.id)],
      }),
    ]);
  }

  return (
    <RecordWorkspace
      title={caseName}
      description="Review the case's state, the conversation with the customer, and its linked records."
      backHref="/dashboard/support/cases"
      backLabel="Support cases"
      isLoading={caseQuery.isLoading || (!item && !caseQuery.error)}
      hasError={Boolean(caseQuery.error)}
      onRetry={() => void caseQuery.refetch()}
      errorState={notFound ? (
        <RouteNotFoundState
          titleAs="p"
          recordLabel="Support case"
          backHref="/dashboard/support/cases"
          backLabel="Back to support cases"
        />
      ) : undefined}
      status={item ? <StatusValue status={getSupportCaseStatus(item.status)} context="record" /> : null}
      /*
       * The subject is the case's name and the number is its reference — the reverse of the
       * three line-item documents, whose number *is* their identity in the ledger. The
       * operator's question here is "which case is this", and the subject answers it.
       */
      subtitle={item ? (
        <>
          <span>{item.case_number}</span>
          {item.contact_name || item.organization_name ? (
            <span>{item.contact_name || item.organization_name}</span>
          ) : null}
        </>
      ) : null}
      /*
       * No header actions at all. A case advances by changing its status, and the rail owns
       * that field — and there is no `/[id]/edit` route to point an `Edit` button at, which
       * is a real gap recorded in `rebuild.md` rather than one a migration invents a form for.
       */
      spine={
        <RecordSpine>
          {item ? (
            <>
              <RecordSpineTrack
                steps={CASE_TRACK_STEPS}
                currentId={item.status}
                label="Case lifecycle"
              />

              <RecordSpineBlock title="State">
                <RecordSpineField label="Status">
                  {canEdit ? (
                    <InlineFieldEdit
                      fieldLabel="Status"
                      value={item.status ?? "new"}
                      options={STATUS_OPTIONS}
                      onCommit={(next) => updateField("status", next.value)}
                    />
                  ) : (
                    <StatusValue status={getSupportCaseStatus(item.status)} context="record" />
                  )}
                </RecordSpineField>
                <RecordSpineField label="Priority">
                  {canEdit ? (
                    <InlineFieldEdit
                      fieldLabel="Priority"
                      value={item.priority ?? "medium"}
                      options={PRIORITY_OPTIONS}
                      onCommit={(next) => updateField("priority", next.value)}
                    />
                  ) : (
                    <StatusValue status={getSupportCasePriority(item.priority)} context="record" />
                  )}
                </RecordSpineField>
                <RecordSpineField label="Category">
                  {canEdit ? (
                    <InlineFieldEdit
                      fieldLabel="Category"
                      value={item.category ?? "general"}
                      options={CATEGORY_OPTIONS}
                      onCommit={(next) => updateField("category", next.value)}
                    />
                  ) : (
                    <StatusValue
                      status={{ tone: null, label: CATEGORY_LABELS[item.category as keyof typeof CATEGORY_LABELS] ?? item.category ?? "General" }}
                      context="record"
                    />
                  )}
                </RecordSpineField>
              </RecordSpineBlock>

              <RecordSpineBlock title="Connected">
                <RecordSpineLink label="Assignee" value={item.assigned_to_name} />
                <RecordSpineLink
                  label="Contact"
                  value={item.contact_name}
                  href={item.contact_id ? `/dashboard/sales/contacts/${item.contact_id}` : null}
                />
                <RecordSpineLink
                  label="Account"
                  value={item.organization_name}
                  href={item.organization_id ? `/dashboard/sales/organizations/${item.organization_id}` : null}
                />
                <RecordSpineLink
                  label="Deal"
                  value={item.opportunity_name}
                  href={item.opportunity_id ? `/dashboard/sales/opportunities/${item.opportunity_id}` : null}
                />
                <RecordSpineLink
                  label="Quote"
                  value={item.quote_label}
                  href={item.quote_id ? `/dashboard/sales/quotes/${item.quote_id}` : null}
                />
                <RecordSpineLink
                  label="Order"
                  value={item.order_label}
                  href={item.order_id ? `/dashboard/sales/orders/${item.order_id}` : null}
                />
              </RecordSpineBlock>

              <RecordSpineMeta
                createdLabel={`Created ${formatDateTime(item.created_at)}`}
                updatedLabel={`Updated ${formatDateTime(item.updated_at)}`}
                history={
                  <RecordAuditHistory
                    moduleKey="support_cases"
                    entityId={item.id}
                    moduleEvents={caseEvents(item)}
                  />
                }
              />
            </>
          ) : null}
        </RecordSpine>
      }
      details={item ? (
        <CaseOverview
          item={item}
          layout={detailLayoutQuery.data}
          isLayoutLoading={detailLayoutQuery.isLoading}
          layoutError={detailLayoutQuery.error}
          onRetryLayout={() => void detailLayoutQuery.refetch()}
        />
      ) : null}
      /*
       * The conversation *is* the Timeline. `_fetch_case_replies` projects every
       * `SupportCaseComment` into the feed as `type="case_reply"`, so the `Conversation` card
       * and its reply box become the composer's reply mode over the feed that already
       * rendered them — which is what removes the two comment systems the census named.
       */
      timeline={item ? (
        <RecordTimeline
          moduleKey="support_cases"
          entityId={item.id}
          canEdit={canEdit}
          composer={canEdit ? {
            reply: {
              endpoint: `/support/cases/${item.id}/comments`,
              label: "Reply to the customer",
              placeholder: "Write a customer-facing reply",
              onReplied: async () => {
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: supportCaseQueryKey(item.id) }),
                  queryClient.invalidateQueries({ queryKey: SUPPORT_CASES_QUERY_KEY }),
                  queryClient.invalidateQueries({ queryKey: SUPPORT_CASES_SUMMARY_QUERY_KEY }),
                ]);
              },
            },
          } : undefined}
        />
      ) : undefined}
      tasks={item && canViewTasks ? (
        <RecordTasksPanel
          moduleKey="support_cases"
          entityId={item.id}
          sourceLabel={item.case_number}
          canCreate={Boolean(taskActions?.can_create)}
          canEdit={Boolean(taskActions?.can_edit)}
          createActionVariant="outline"
        />
      ) : undefined}
      files={item && canViewDocuments ? (
        <RecordDocumentsPanel
          moduleKey="support_cases"
          entityId={item.id}
          canUpload={Boolean(documentActions?.can_create) && canEdit}
          canEdit={Boolean(documentActions?.can_edit) && canEdit}
          canDelete={Boolean(documentActions?.can_delete) && canEdit}
        />
      ) : undefined}
    />
  );
}

function CaseOverview({
  item,
  layout,
  isLayoutLoading,
  layoutError,
  onRetryLayout,
}: {
  item: SupportCase;
  layout?: ResolvedRecordLayoutContract;
  isLayoutLoading: boolean;
  layoutError: Error | null;
  onRetryLayout: () => void;
}) {
  if (isLayoutLoading || !layout) {
    return (
      <Card className="px-5 py-5">
        {layoutError ? (
          <PanelError message="The case details layout could not be loaded." onRetry={onRetryLayout} />
        ) : (
          <PanelLoading label="Loading case details…" />
        )}
      </Card>
    );
  }

  return (
    <ReadOnlyRecordLayout
      layout={layout}
      values={item as unknown as Record<string, unknown>}
      omitFieldKeys={SPINE_OWNED_FIELDS}
    />
  );
}

/**
 * The case's own event log, in the shape the History sheet merges (design.md §4.7).
 *
 * This was a `Case history` card in the right column, beside a `RecordActivityTimeline` that
 * answered the same question from `activity_logs` — the two-lists-one-question duplication
 * the contract rebuild removed first. The domain log is the one with the coverage: only it
 * sees a portal reply.
 */
function caseEvents(item: SupportCase): RecordModuleEvent[] {
  return (item.events ?? []).map((event) => ({
    id: String(event.id),
    occurredAt: event.created_at,
    label: CASE_EVENT_LABELS[event.event_type] ?? event.event_type,
    // No actor is the portal or an automation; an actor the service could not resolve is a
    // user who has since been removed, which is not the same thing and does not read as one.
    detail: event.created_by_id ? event.created_by_name ?? "Unknown user" : "Customer or system",
  }));
}
