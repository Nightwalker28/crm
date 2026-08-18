"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { toast } from "sonner";

import CrmRecordActivitySection from "@/components/recordActivity/CrmRecordActivitySection";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { InlineFieldEdit } from "@/components/ui/InlineFieldEdit";
import { PageShell } from "@/components/ui/PageShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { RouteErrorState, RouteLoadingState, RouteNotFoundState } from "@/components/ui/RouteStates";
import { Textarea } from "@/components/ui/textarea";
import {
  SUPPORT_CASES_QUERY_KEY,
  SUPPORT_CASES_SUMMARY_QUERY_KEY,
  supportCaseQueryKey,
  type SupportCase,
  useSupportCase,
} from "@/hooks/support/useCases";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { getSupportCasePriority, getSupportCaseStatus } from "@/lib/statusStyles";

const STATUSES = ["new", "open", "pending", "resolved", "closed"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const CATEGORIES = ["general", "billing", "technical", "order", "account"] as const;
const STATUS_OPTIONS = STATUSES.map((value) => ({ value, ...getSupportCaseStatus(value) }));
const PRIORITY_OPTIONS = PRIORITIES.map((value) => ({ value, ...getSupportCasePriority(value) }));
/** Category is a category, not a status (R5) — no tone, ever. */
const CATEGORY_OPTIONS = CATEGORIES.map((value) => ({ value, tone: null, label: titleCase(value) }));

export default function SupportCaseDetailPage() {
  const params = useParams<{ caseId: string }>();
  const caseQuery = useSupportCase(params.caseId);

  if (caseQuery.isLoading) return <RouteLoadingState label="support case" />;
  if (caseQuery.error instanceof Error && caseQuery.error.message === "not-found") {
    return <RouteNotFoundState recordLabel="Support case" backHref="/dashboard/support/cases" backLabel="Back to support cases" />;
  }
  if (caseQuery.error || !caseQuery.data) {
    return <RouteErrorState title="Unable to load this support case" reset={() => void caseQuery.refetch()} backHref="/dashboard/support/cases" backLabel="Back to support cases" />;
  }

  return <SupportCaseWorkspace key={caseQuery.data.id} item={caseQuery.data} />;
}

function SupportCaseWorkspace({ item }: { item: SupportCase }) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [commentError, setCommentError] = useState(false);

  async function updateField(field: "status" | "priority" | "category", next: string) {
    const res = await apiFetch(`/support/cases/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: next }),
    });
    const body = await res.json().catch(() => null) as SupportCase | null;
    if (!res.ok || !body) throw new Error("save-failed");
    queryClient.setQueryData(supportCaseQueryKey(item.id), body);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: SUPPORT_CASES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: SUPPORT_CASES_SUMMARY_QUERY_KEY }),
    ]);
  }

  async function handleComment() {
    if (!comment.trim() || commenting) return;
    try {
      setCommenting(true);
      setCommentError(false);
      const res = await apiFetch(`/support/cases/${item.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: comment.trim(), is_internal: false }),
      });
      if (!res.ok) throw new Error("comment-failed");
      setComment("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SUPPORT_CASES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: SUPPORT_CASES_SUMMARY_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: supportCaseQueryKey(item.id) }),
      ]);
      toast.success("Reply added.");
    } catch {
      setCommentError(true);
    } finally {
      setCommenting(false);
    }
  }

  return (
    <PageShell
      title={item.case_number}
      description={item.subject}
    >
      <RecordPageHeader
        backHref="/dashboard/support/cases"
        backLabel="Back to support cases"
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="grid content-start gap-4">
          <Card className="p-5">
            <h2 className="text-lg font-semibold text-copy-primary">Case overview</h2>
            <FieldDescription className="mt-1">Manage the response state, urgency, and queue context.</FieldDescription>
            <FieldGroup className="mt-5 grid gap-4 md:grid-cols-3">
              <Field>
                <FieldLabel>Status</FieldLabel>
                <InlineFieldEdit
                  fieldLabel="Status"
                  value={item.status ?? "new"}
                  options={STATUS_OPTIONS}
                  onCommit={(next) => updateField("status", next.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Priority</FieldLabel>
                <InlineFieldEdit
                  fieldLabel="Priority"
                  value={item.priority ?? "medium"}
                  options={PRIORITY_OPTIONS}
                  onCommit={(next) => updateField("priority", next.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Category</FieldLabel>
                <InlineFieldEdit
                  fieldLabel="Category"
                  value={item.category ?? "general"}
                  options={CATEGORY_OPTIONS}
                  onCommit={(next) => updateField("category", next.value)}
                />
              </Field>
            </FieldGroup>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <SummaryTile label="Requester" value={item.contact_name || item.organization_name || "No requester linked"} />
              <SummaryTile label="Assignee" value={item.assigned_to_name || "Unassigned"} />
              <SummaryTile label="SLA due" value={item.sla_due_at ? formatDateTime(item.sla_due_at) : "No SLA deadline"} />
              <SummaryTile label="Source" value={item.source ? titleCase(item.source) : "Not recorded"} />
            </div>
            {item.description ? <p className="mt-5 whitespace-pre-wrap border-t border-line-subtle pt-5 text-p-sm text-copy-secondary">{item.description}</p> : null}
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-5 w-5 text-copy-muted" />
              <h2 className="text-lg font-semibold text-copy-primary">Conversation</h2>
            </div>
            <FieldDescription className="mt-1">Keep the customer-facing response history together with the case.</FieldDescription>
            <div className="mt-5 grid gap-3">
              {(item.comments ?? []).length ? item.comments?.map((entry) => (
                <article key={entry.id} className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-copy-muted">
                    <span>{entry.author_name || "Team member"}</span>
                    <time dateTime={entry.created_at}>{formatDateTime(entry.created_at)}</time>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-p-sm text-copy-primary">{entry.body}</div>
                </article>
              )) : (
                <div className="rounded-[var(--radius-control)] border border-dashed border-line-default px-4 py-8 text-center text-sm text-copy-muted">No replies yet. Add the first response below.</div>
              )}
            </div>
            <Field className="mt-5">
              <FieldLabel htmlFor="support-case-reply">Add reply</FieldLabel>
              <Textarea id="support-case-reply" value={comment} onChange={(event) => { setComment(event.target.value); if (commentError) setCommentError(false); }} rows={4} placeholder="Write a customer-facing reply" aria-invalid={commentError} aria-describedby={commentError ? "support-case-reply-error" : undefined} />
              {commentError ? <p id="support-case-reply-error" role="alert" className="text-sm text-state-danger">The reply could not be added. Try again.</p> : null}
              <Button onClick={() => void handleComment()} disabled={!comment.trim() || commenting} className="w-fit">{commenting ? "Adding…" : "Add reply"}</Button>
            </Field>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card className="p-5">
            <h2 className="text-lg font-semibold text-copy-primary">Related records</h2>
            <FieldDescription className="mt-1">Open the customer and commercial context connected to this case.</FieldDescription>
            <div className="mt-4 grid gap-3">
              <LinkedTile label="Contact" value={item.contact_name || (item.contact_id ? "Linked contact" : "No contact")} href={item.contact_id ? `/dashboard/sales/contacts/${item.contact_id}` : null} />
              <LinkedTile label="Account" value={item.organization_name || (item.organization_id ? "Linked account" : "No account")} href={item.organization_id ? `/dashboard/sales/organizations/${item.organization_id}` : null} />
              <LinkedTile label="Deal" value={item.opportunity_name || (item.opportunity_id ? "Linked deal" : "No deal")} href={item.opportunity_id ? `/dashboard/sales/opportunities/${item.opportunity_id}` : null} />
              <LinkedTile label="Quote" value={item.quote_label || (item.quote_id ? "Linked quote" : "No quote")} href={item.quote_id ? `/dashboard/sales/quotes/${item.quote_id}` : null} />
              <LinkedTile label="Order" value={item.order_label || (item.order_id ? "Linked order" : "No order")} href={item.order_id ? `/dashboard/sales/orders/${item.order_id}` : null} />
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-lg font-semibold text-copy-primary">Case history</h2>
            <div className="mt-4 grid gap-3">
              {(item.events ?? []).length ? item.events?.map((event) => (
                <div key={event.id} className="border-l-2 border-line-default pl-3">
                  <div className="text-sm font-medium text-copy-primary">{titleCase(event.event_type)}</div>
                  <time dateTime={event.created_at} className="mt-1 block text-xs text-copy-muted">{formatDateTime(event.created_at)}</time>
                </div>
              )) : <div className="text-sm text-copy-muted">No case history yet.</div>}
            </div>
          </Card>
        </div>

        <CrmRecordActivitySection
          className="xl:col-span-2"
          moduleKey="support_cases"
          entityId={item.id}
          recordLabel="Support case"
          taskSourceLabel={item.case_number}
        />
      </div>
    </PageShell>
  );
}

// An ink group, not a box: a read-only field display is static, so it is not earned by
// interactivity, and it groups rather than separates (design.md 1.3). It sits inside a
// Card already, so a border here is the third container level 1.3 forbids.
function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-copy-label">{label}</div>
      <div className="mt-1 text-sm text-copy-primary">{value}</div>
    </div>
  );
}

function LinkedTile({ label, value, href }: { label: string; value: string; href: string | null }) {
  return (
    <div>
      <div className="text-xs font-medium text-copy-label">{label}</div>
      <div className="mt-1 text-sm text-copy-primary">
        {href ? <Link href={href} className="hover:text-action-primary hover:underline">{value}</Link> : value}
      </div>
    </div>
  );
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
