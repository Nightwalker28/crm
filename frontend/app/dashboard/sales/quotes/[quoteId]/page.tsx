"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, Pencil, RefreshCw, Send, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
import CommunicationActions from "@/components/recordActivity/CommunicationActions";
import RecordAuditHistory, {
  type RecordModuleEvent,
} from "@/components/recordActivity/RecordAuditHistory";
import RecordDeleteButton from "@/components/recordActivity/RecordDeleteButton";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import RecordTimeline from "@/components/recordActivity/RecordTimeline";
import {
  RecordWorkspace,
  recordEditHref,
} from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EMPTY_CELL_VALUE } from "@/components/ui/EmptyValue";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InlineFieldEdit, type InlineFieldEditOption } from "@/components/ui/InlineFieldEdit";
import { Input } from "@/components/ui/input";
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
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusValue } from "@/components/ui/StatusValue";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/Table";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import { isModuleFieldEnabled, useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import {
  useResolvedRecordLayout,
  type ResolvedRecordLayout as ResolvedRecordLayoutContract,
} from "@/hooks/useResolvedRecordLayout";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { formatDateTime } from "@/lib/datetime";
import { getQuoteStatus } from "@/lib/statusStyles";

type QuoteProposal = {
  id: number;
  status: string;
  sent_to?: string | null;
  generated_at: string;
  sent_at?: string | null;
  public_expires_at?: string | null;
};

type QuoteProposalEvent = {
  id: number;
  event_type: string;
  recipient_email?: string | null;
  occurred_at: string;
};

type RelatedOrder = {
  id: number;
  order_number: string;
  status: string;
  currency: string;
  grand_total: string | number;
};

type QuoteSummary = {
  quote: {
    quote_id: number;
    quote_number: string;
    title?: string | null;
    customer_name: string;
    contact_id?: number | null;
    organization_id?: number | null;
    opportunity_id?: number | null;
    status?: string | null;
    issue_date?: string | null;
    expiry_date?: string | null;
    currency?: string | null;
    subtotal_amount?: string | number | null;
    discount_amount?: string | number | null;
    tax_amount?: string | number | null;
    total_amount?: string | number | null;
    notes?: string | null;
    assigned_to?: number | null;
    assigned_to_name?: string | null;
    created_time?: string | null;
    updated_at?: string | null;
    custom_fields?: Record<string, unknown> | null;
    items?: Array<{
      id: number;
      name: string;
      description?: string | null;
      quantity: string | number;
      unit_price: string | number;
      discount_amount: string | number;
      tax_amount: string | number;
      line_total: string | number;
      sort_order: number;
    }>;
  };
  opportunity?: {
    opportunity_id: number;
    opportunity_name: string;
  } | null;
  contact?: {
    contact_id: number;
    first_name?: string | null;
    last_name?: string | null;
    primary_email?: string | null;
    contact_telephone?: string | null;
  } | null;
  organization?: { org_id: number; org_name: string } | null;
  latest_proposal?: QuoteProposal | null;
  proposal_events?: QuoteProposalEvent[];
  related_order?: RelatedOrder | null;
};

const QUOTE_STATUS_VALUES = ["draft", "sent", "accepted", "declined", "expired"] as const;

const QUOTE_STATUS_OPTIONS: InlineFieldEditOption[] = QUOTE_STATUS_VALUES.map((value) => ({
  value,
  ...getQuoteStatus(value),
}));

/**
 * The track is the quote's pipeline. `declined` and `expired` end it without completing it,
 * so neither is a step — the same rule the lead, deal and contract tracks follow.
 */
const QUOTE_TRACK_VALUES = ["draft", "sent", "accepted"] as const;

const QUOTE_TRACK_STEPS = QUOTE_TRACK_VALUES.map((value) => ({
  id: value,
  label: getQuoteStatus(value).label,
}));

/**
 * Fields `Details` must not draw a second time (design.md §4.7): the header owns the quote
 * number and the customer, and the spine owns status, owner and every relationship.
 */
const SPINE_OWNED_FIELDS = [
  "quote_number",
  "customer_name",
  "status",
  "assigned_to",
  "contact_id",
  "organization_id",
  "opportunity_id",
] as const;

/** Money fields in the seeded layout, which render through the quote's own currency. */
const MONEY_FIELDS = new Set([
  "subtotal_amount",
  "discount_amount",
  "tax_amount",
  "total_amount",
]);

class QuoteRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fetchQuoteSummary(quoteId: string) {
  const res = await apiFetch(`/sales/quotes/${quoteId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new QuoteRequestError(body?.detail ?? "We could not load this quote.", res.status);
  }
  return body as QuoteSummary;
}

function contactLabel(contact: QuoteSummary["contact"]) {
  if (!contact) return null;
  return (
    [contact.first_name, contact.last_name].filter(Boolean).join(" ")
    || contact.primary_email
    || null
  );
}

export default function QuoteDetailPage() {
  const params = useParams<{ quoteId: string }>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const { modules } = useAccessibleModules();
  const activeTab = searchParams.get("tab");
  const [converting, setConverting] = useState(false);

  const moduleActions = (moduleKey: string) =>
    modules.find((module) => module.name === moduleKey)?.actions;
  const quoteActions = moduleActions("sales_quotes");
  const orderActions = moduleActions("sales_orders");
  const taskActions = moduleActions("tasks");
  const documentActions = moduleActions("documents");
  const canEdit = Boolean(quoteActions?.can_edit);
  const canDelete = Boolean(quoteActions?.can_delete);
  const canCreateOrders = Boolean(orderActions?.can_create);
  const canViewTasks = Boolean(taskActions?.can_view);
  const canCreateTasks = Boolean(taskActions?.can_create);
  const canEditTasks = Boolean(taskActions?.can_edit);
  const canViewDocuments = Boolean(documentActions?.can_view);
  const canCreateDocuments = Boolean(documentActions?.can_create);
  const canEditDocuments = Boolean(documentActions?.can_edit);
  const canDeleteDocuments = Boolean(documentActions?.can_delete);

  const { fields: moduleFields } = useModuleFieldConfigs("sales_quotes");
  const summaryQuery = useQuery({
    queryKey: ["sales-quote-summary", params.quoteId],
    queryFn: () => fetchQuoteSummary(params.quoteId),
    enabled: Boolean(params.quoteId),
    refetchOnWindowFocus: false,
  });
  const detailLayoutQuery = useResolvedRecordLayout("sales_quotes", "detail");

  const summary = summaryQuery.data ?? null;
  const quote = summary?.quote;
  const summaryError = summaryQuery.error;
  const notFound = summaryError instanceof QuoteRequestError && summaryError.status === 404;
  const status = quote?.status || "draft";
  const quoteName = quote?.quote_number || "Quote";
  const recordHref = `/dashboard/sales/quotes/${params.quoteId}`;
  const quoteTotal = quote ? formatMoney(quote.total_amount, quote.currency) : null;
  const canEditStatus = canEdit && isModuleFieldEnabled(moduleFields, "status");

  /**
   * A quote status change publishes `quote.status_changed` on the automation bus, so it is
   * R1's side-effect row rather than an ordinary state edit: it confirms before it commits.
   */
  async function confirmStatusChange(next: InlineFieldEditOption) {
    if (!quote) return false;
    return confirm({
      title: "Change quote status?",
      description: `Move ${quote.quote_number} from ${getQuoteStatus(status).label} to ${next.label}? Automations that watch this quote will run.`,
      confirmLabel: "Change status",
    });
  }

  async function updateStatus(next: string) {
    const res = await apiFetch(`/sales/quotes/${params.quoteId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) throw new Error("The quote status could not be saved.");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sales-quotes"] }),
      queryClient.invalidateQueries({
        queryKey: ["record-audit-history", "sales_quotes", params.quoteId],
      }),
      summaryQuery.refetch(),
    ]);
  }

  async function convertToOrder() {
    if (converting) return;
    try {
      setConverting(true);
      const res = await apiFetch(`/sales/quotes/${params.quoteId}/convert-to-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allow_duplicate: false }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? "We could not convert this quote to an order.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        summaryQuery.refetch(),
      ]);
      toast.success("Quote converted to order.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to convert quote to order.");
    } finally {
      setConverting(false);
    }
  }

  return (
    <RecordWorkspace
      title={quoteName}
      description="Review the quote's status, commercial terms, proposal, and activity."
      backHref="/dashboard/sales/quotes"
      backLabel="Quotes"
      isPermissionDenied={summaryError instanceof QuoteRequestError && summaryError.status === 403}
      isLoading={summaryQuery.isLoading || (!summary && !summaryError)}
      hasError={Boolean(summaryError)}
      onRetry={() => void summaryQuery.refetch()}
      errorState={notFound ? (
        <RouteNotFoundState
          titleAs="p"
          recordLabel="Quote"
          backHref="/dashboard/sales/quotes"
          backLabel="Back to quotes"
        />
      ) : undefined}
      status={quote ? <QuoteStatus status={status} /> : null}
      subtitle={quote ? (
        <>
          <span>{quote.customer_name}</span>
          {quoteTotal ? <span>{quoteTotal}</span> : null}
        </>
      ) : null}
      actions={quote ? (
        <>
          <CommunicationActions
            email={summary?.contact?.primary_email}
            phone={summary?.contact?.contact_telephone}
            showCopyActions={false}
            emailContext={{
              moduleKey: "sales_quotes",
              entityId: quote.quote_id,
              recordLabel: quoteName,
            }}
          />
          {canEdit ? (
            <Button asChild variant="outline">
              <Link href={recordEditHref(`${recordHref}/edit`, activeTab)}>
                <Pencil />
                Edit
              </Link>
            </Button>
          ) : null}
          {/*
            A12. The pre-5.3 page drew this button permanently and disabled it whenever the
            quote was not accepted, with the reason written into a summary tile on the far
            side of the screen — and because the status select was not persisted by the
            button, converting took three actions. The rail autosaves the status now, and
            the button exists only when it can be pressed (§4.7), so the path is two.
          */}
          {status === "accepted" && !summary?.related_order && canCreateOrders && canEdit ? (
            <Button type="button" onClick={convertToOrder} disabled={converting}>
              {converting ? <RefreshCw className="animate-spin" /> : <ShoppingCart />}
              {converting ? "Converting…" : "Convert to order"}
            </Button>
          ) : null}
        </>
      ) : null}
      overflowActions={quote && canDelete ? (
        <RecordDeleteButton
          as="menuItem"
          endpoint={`/sales/quotes/${params.quoteId}`}
          label="Quote"
          recordName={quoteName}
          redirectHref="/dashboard/sales/quotes"
          queryKeys={["sales-quotes"]}
        />
      ) : null}
      spine={
        <RecordSpine>
          {summary && quote ? (
            <>
              {QUOTE_TRACK_VALUES.includes(status as (typeof QUOTE_TRACK_VALUES)[number]) ? (
                <RecordSpineTrack
                  steps={QUOTE_TRACK_STEPS}
                  currentId={status}
                  label="Quote lifecycle"
                />
              ) : null}

              <RecordSpineBlock title="State">
                <RecordSpineField label="Status">
                  {canEditStatus ? (
                    <InlineFieldEdit
                      fieldLabel="Status"
                      value={status}
                      options={QUOTE_STATUS_OPTIONS}
                      confirm={confirmStatusChange}
                      onCommit={(next) => updateStatus(next.value)}
                    />
                  ) : (
                    <QuoteStatus status={status} />
                  )}
                </RecordSpineField>
              </RecordSpineBlock>

              <RecordSpineBlock title="Connected">
                <RecordSpineLink label="Owner" value={quote.assigned_to_name} />
                <RecordSpineLink
                  label="Contact"
                  value={contactLabel(summary.contact)}
                  href={summary.contact ? `/dashboard/sales/contacts/${summary.contact.contact_id}` : null}
                />
                <RecordSpineLink
                  label="Account"
                  value={summary.organization?.org_name}
                  href={summary.organization ? `/dashboard/sales/organizations/${summary.organization.org_id}` : null}
                />
                <RecordSpineLink
                  label="Deal"
                  value={summary.opportunity?.opportunity_name}
                  href={summary.opportunity ? `/dashboard/sales/opportunities/${summary.opportunity.opportunity_id}` : null}
                />
                <RecordSpineLink
                  label="Order"
                  value={summary.related_order?.order_number}
                  href={summary.related_order ? `/dashboard/sales/orders/${summary.related_order.id}` : null}
                />
              </RecordSpineBlock>

              <RecordSpineMeta
                createdLabel={
                  quote.created_time ? `Created ${formatDateTime(quote.created_time)}` : undefined
                }
                updatedLabel={
                  quote.updated_at ? `Updated ${formatDateTime(quote.updated_at)}` : undefined
                }
                history={
                  <RecordAuditHistory
                    moduleKey="sales_quotes"
                    entityId={quote.quote_id}
                    // The proposal's own event log — generated, sent, viewed. The pre-5.3
                    // page drew it as a `Lifecycle` tile inside the Proposal card, which is
                    // the second immutable list §4.7 removes.
                    moduleEvents={proposalEvents(summary)}
                  />
                }
              />
            </>
          ) : null}
        </RecordSpine>
      }
      details={quote ? (
        <QuoteOverview
          quote={quote}
          layout={detailLayoutQuery.data}
          isLayoutLoading={detailLayoutQuery.isLoading}
          layoutError={detailLayoutQuery.error}
          onRetryLayout={() => void detailLayoutQuery.refetch()}
        />
      ) : null}
      timeline={quote ? (
        <RecordTimeline
          moduleKey="sales_quotes"
          entityId={quote.quote_id}
          canEdit={canEdit}
          composer={{
            followUp: canEdit
              ? {
                  endpoint: `/sales/quotes/${quote.quote_id}/follow-up`,
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
      tasks={quote && canViewTasks ? (
        <RecordTasksPanel
          moduleKey="sales_quotes"
          entityId={quote.quote_id}
          sourceLabel={quoteName}
          canCreate={canCreateTasks}
          canEdit={canEditTasks}
          createActionVariant="outline"
        />
      ) : undefined}
      files={quote && canViewDocuments ? (
        <RecordDocumentsPanel
          moduleKey="sales_quotes"
          entityId={quote.quote_id}
          canUpload={canCreateDocuments && canEdit}
          canEdit={canEditDocuments && canEdit}
          canDelete={canDeleteDocuments && canEdit}
        />
      ) : undefined}
      extraTabs={summary && quote ? [
        {
          id: "proposal",
          label: "Proposal",
          content: (
            <ProposalPanel
              quoteId={quote.quote_id}
              proposal={summary.latest_proposal ?? null}
              defaultRecipient={summary.latest_proposal?.sent_to ?? summary.contact?.primary_email ?? ""}
              canEdit={canEdit}
              onChanged={() => void summaryQuery.refetch()}
            />
          ),
        },
      ] : []}
    />
  );
}

/**
 * `Details` for a line-item document: the layout, then the items.
 *
 * The items are read-only here and edited on `/[id]/edit` behind a manual save (R1 and
 * §4.7). They are rows pointing at the quote, so the archetype's own test would allow an
 * editor in the content region — what rules it out is that the write is a whole-document
 * `PUT`, so an in-place editor is the edit page rebuilt inside the record page, which is the
 * defect this migration removes. The table keeps its current shape; `RecordTable
 * variant="lineItems"` is 5.5's.
 */
function QuoteOverview({
  quote,
  layout,
  isLayoutLoading,
  layoutError,
  onRetryLayout,
}: {
  quote: NonNullable<QuoteSummary["quote"]>;
  layout?: ResolvedRecordLayoutContract;
  isLayoutLoading: boolean;
  layoutError: Error | null;
  onRetryLayout: () => void;
}) {
  if (isLayoutLoading || !layout) {
    return (
      <Card className="px-5 py-5">
        {layoutError ? (
          <PanelError message="The quote details layout could not be loaded." onRetry={onRetryLayout} />
        ) : (
          <PanelLoading label="Loading quote details…" />
        )}
      </Card>
    );
  }

  const money = (value: string | number | null | undefined) =>
    formatMoney(value, quote.currency) ?? EMPTY_CELL_VALUE;

  return (
    <div className="grid gap-4">
      <ReadOnlyRecordLayout
        layout={layout}
        values={quote as unknown as Record<string, unknown>}
        customValues={quote.custom_fields ?? {}}
        omitFieldKeys={SPINE_OWNED_FIELDS}
        renderValue={(field, value) =>
          MONEY_FIELDS.has(field.field_key)
            ? formatMoney(value as string | number | null, quote.currency) ?? undefined
            : undefined
        }
      />
      {quote.items?.length ? (
        <Card className="px-5 py-5">
          <SectionHeading>Line items</SectionHeading>
          <div className="mt-4 overflow-x-auto">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableHeaderRow>
                  <TableHead className="px-3 py-2">Item</TableHead>
                  <TableHead className="px-3 py-2 text-right">Quantity</TableHead>
                  <TableHead className="px-3 py-2 text-right">Unit price</TableHead>
                  <TableHead className="px-3 py-2 text-right">Discount</TableHead>
                  <TableHead className="px-3 py-2 text-right">Tax</TableHead>
                  <TableHead className="px-3 py-2 text-right">Total</TableHead>
                </TableHeaderRow>
              </TableHeader>
              <TableBody>
                {quote.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="px-3 py-3">
                      <div className="font-medium text-copy-primary">{item.name}</div>
                      {item.description ? (
                        <div className="mt-1 text-xs text-copy-muted">{item.description}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right tabular-nums text-copy-secondary">
                      {Number(item.quantity)}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right tabular-nums text-copy-secondary">
                      {money(item.unit_price)}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right tabular-nums text-copy-secondary">
                      {money(item.discount_amount)}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right tabular-nums text-copy-secondary">
                      {money(item.tax_amount)}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right font-medium tabular-nums text-copy-primary">
                      {money(item.line_total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * The proposal — a `QuoteDocument` row pointing at the quote, so it is a related object and
 * lives in the content region rather than the rail (§4.7's spine test).
 *
 * Its *events* do not live here. They are the quote's own immutable event log and are merged
 * into the History sheet, which is where the pre-5.3 `Lifecycle` tile's content went.
 */
function ProposalPanel({
  quoteId,
  proposal,
  defaultRecipient,
  canEdit,
  onChanged,
}: {
  quoteId: number;
  proposal: QuoteProposal | null;
  defaultRecipient: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [busy, setBusy] = useState<"generate" | "send" | null>(null);
  const [linkPath, setLinkPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    try {
      setBusy("generate");
      setError(null);
      const res = await apiFetch(`/sales/quotes/${quoteId}/proposal/generate`, { method: "POST" });
      if (!res.ok) throw new Error("We could not generate the proposal.");
      setLinkPath(null);
      onChanged();
      toast.success("Proposal generated.");
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Failed to generate proposal.");
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    try {
      setBusy("send");
      setError(null);
      const res = await apiFetch(`/sales/quotes/${quoteId}/proposal/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sent_to: recipient.trim() || null }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error("We could not send the proposal.");
      setLinkPath(body?.public_url_path ?? null);
      onChanged();
      toast.success("Proposal marked sent.");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send proposal.");
    } finally {
      setBusy(null);
    }
  }

  if (!canEdit && !proposal) {
    return (
      <EmptyState
        icon={FileText}
        title="No proposal yet"
        description="A generated proposal and its signed link will appear here."
      />
    );
  }

  return (
    <Card className="px-5 py-5">
      <SectionHeading>Proposal</SectionHeading>
      <FieldDescription className="mt-1">
        Generate the quote proposal and send it as a signed link. Every send, open and
        acceptance is recorded in the record&apos;s history.
      </FieldDescription>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary"
        >
          {error}
        </div>
      ) : null}

      <dl className="mt-5 grid gap-4 sm:grid-cols-3">
        {/* Only the status is a raw enum, so only the status is title-cased. Applying
            `capitalize` to all three turned "Not sent" into "Not Sent" — §3.5. */}
        <ProposalFact label="Status" value={proposalStatusLabel(proposal)} />
        <ProposalFact
          label="Generated"
          value={proposal?.generated_at ? formatDateTime(proposal.generated_at) : "Not generated"}
        />
        <ProposalFact
          label="Sent"
          value={proposal?.sent_at ? formatDateTime(proposal.sent_at) : "Not sent"}
        />
      </dl>

      {canEdit ? (
        <div className="mt-5 border-t border-line-subtle pt-5">
          <Field>
            <FieldLabel htmlFor="quote-proposal-recipient">Recipient</FieldLabel>
            <Input
              id="quote-proposal-recipient"
              type="email"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="client@example.com"
            />
          </Field>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={generate} disabled={busy !== null}>
              {busy === "generate" ? <RefreshCw className="animate-spin" /> : <FileText />}
              {busy === "generate" ? "Generating…" : "Generate"}
            </Button>
            <Button type="button" onClick={send} disabled={busy !== null || !recipient.trim()}>
              {busy === "send" ? <RefreshCw className="animate-spin" /> : <Send />}
              {busy === "send" ? "Sending…" : "Send"}
            </Button>
          </div>
          {linkPath ? (
            <a
              className="mt-4 inline-flex w-fit items-center gap-2 rounded-[var(--radius-control)] text-sm text-action-primary transition-colors hover:text-action-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              href={linkPath}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Open signed proposal link
            </a>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function ProposalFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-copy-label">{label}</dt>
      <dd className="mt-1 text-sm text-copy-primary">{value}</dd>
    </div>
  );
}

/** Sentence case from the stored enum: `partially_signed` reads `Partially signed` (§3.5). */
function proposalStatusLabel(proposal: QuoteProposal | null) {
  if (!proposal) return "Not generated";
  const words = proposal.status.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The proposal's event log, in the shape the History sheet merges (design.md §4.7). */
function proposalEvents(summary: QuoteSummary): RecordModuleEvent[] {
  return (summary.proposal_events ?? []).map((event) => ({
    id: String(event.id),
    occurredAt: event.occurred_at,
    label: `Proposal ${event.event_type.replace(/_/g, " ")}`,
    detail: event.recipient_email || "Signed link",
  }));
}

function QuoteStatus({ status }: { status: string }) {
  return <StatusValue status={getQuoteStatus(status)} context="record" />;
}
