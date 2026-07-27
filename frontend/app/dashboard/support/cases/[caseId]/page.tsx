"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquareText, Save } from "lucide-react";
import { toast } from "sonner";

import CrmRecordActivitySection from "@/components/recordActivity/CrmRecordActivitySection";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Pill } from "@/components/ui/Pill";
import { RouteErrorState, RouteLoadingState, RouteNotFoundState } from "@/components/ui/RouteStates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  SUPPORT_CASES_QUERY_KEY,
  SUPPORT_CASES_SUMMARY_QUERY_KEY,
  supportCaseQueryKey,
  type SupportCase,
  useSupportCase,
} from "@/hooks/support/useCases";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { getSupportCasePriorityStyle, getSupportCaseStatusStyle } from "@/lib/statusStyles";

const STATUSES = ["new", "open", "pending", "resolved", "closed"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const CATEGORIES = ["general", "billing", "technical", "order", "account"] as const;

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

  return <SupportCaseWorkspace key={`${caseQuery.data.id}:${caseQuery.data.updated_at}`} item={caseQuery.data} />;
}

function SupportCaseWorkspace({ item }: { item: SupportCase }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(item.status ?? "new");
  const [priority, setPriority] = useState(item.priority ?? "medium");
  const [category, setCategory] = useState(item.category ?? "general");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [commentError, setCommentError] = useState(false);
  const initialSnapshot = useMemo(() => JSON.stringify([item.status, item.priority, item.category ?? "general"]), [item]);
  const currentSnapshot = useMemo(() => JSON.stringify([status, priority, category]), [status, priority, category]);
  const isDirty = currentSnapshot !== initialSnapshot;

  useUnsavedChangesGuard(isDirty, saving);

  async function handleSave() {
    if (!isDirty || saving) return;
    try {
      setSaving(true);
      setSaveError(false);
      const res = await apiFetch(`/support/cases/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, priority, category }),
      });
      const body = await res.json().catch(() => null) as SupportCase | null;
      if (!res.ok || !body) throw new Error("save-failed");
      queryClient.setQueryData(supportCaseQueryKey(item.id), body);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SUPPORT_CASES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: SUPPORT_CASES_SUMMARY_QUERY_KEY }),
      ]);
      toast.success("Support case updated.");
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
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
    <div className="flex flex-col gap-6">
      <RecordPageHeader
        backHref="/dashboard/support/cases"
        backLabel="Back to support cases"
        title={item.case_number}
        description={item.subject}
        primaryAction={<Button onClick={() => void handleSave()} disabled={saving || !isDirty}><Save />{saving ? "Saving…" : "Save changes"}</Button>}
      />

      {saveError ? (
        <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          The case could not be updated. Review the fields and try again.
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="grid content-start gap-4">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-copy-primary">Case overview</h2>
                <FieldDescription className="mt-1">Manage the response state, urgency, and queue context.</FieldDescription>
              </div>
              <div className="flex gap-2">
                <CasePill value={status} type="status" />
                <CasePill value={priority} type="priority" />
              </div>
            </div>
            <FieldGroup className="mt-5 grid gap-4 md:grid-cols-3">
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((value) => <SelectItem key={value} value={value}>{titleCase(value)}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Priority</FieldLabel>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger aria-label="Priority"><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map((value) => <SelectItem key={value} value={value}>{titleCase(value)}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Category</FieldLabel>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((value) => <SelectItem key={value} value={value}>{titleCase(value)}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <SummaryTile label="Requester" value={item.contact_name || item.organization_name || "No requester linked"} />
              <SummaryTile label="Assignee" value={item.assigned_to_name || "Unassigned"} />
              <SummaryTile label="SLA due" value={item.sla_due_at ? formatDateTime(item.sla_due_at) : "No SLA deadline"} />
              <SummaryTile label="Source" value={item.source ? titleCase(item.source) : "Not recorded"} />
            </div>
            {item.description ? <p className="mt-5 whitespace-pre-wrap border-t border-line-subtle pt-5 text-sm leading-6 text-copy-secondary">{item.description}</p> : null}
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
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-copy-primary">{entry.body}</div>
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
    </div>
  );
}

function CasePill({ value, type }: { value: string; type: "status" | "priority" }) {
  const style = type === "priority" ? getSupportCasePriorityStyle(value) : getSupportCaseStatusStyle(value);
  return <Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill>;
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-copy-muted">{label}</div>
      <div className="mt-1 text-sm font-medium text-copy-primary">{value}</div>
    </div>
  );
}

function LinkedTile({ label, value, href }: { label: string; value: string; href: string | null }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-copy-muted">{label}</div>
      <div className="mt-1 text-sm font-medium text-copy-primary">
        {href ? <Link href={href} className="hover:text-action-primary hover:underline">{value}</Link> : value}
      </div>
    </div>
  );
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
