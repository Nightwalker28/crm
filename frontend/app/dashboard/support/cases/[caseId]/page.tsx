"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SupportCase } from "@/hooks/support/useCases";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

const STATUSES = [
  { value: "new", label: "New" },
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export default function SupportCaseDetailPage() {
  const params = useParams<{ caseId: string }>();
  const queryClient = useQueryClient();
  const [item, setItem] = useState<SupportCase | null>(null);
  const [status, setStatus] = useState("new");
  const [priority, setPriority] = useState("medium");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadCase(signal?: { cancelled: boolean }) {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/support/cases/${params.caseId}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      if (signal?.cancelled) return;
      setItem(body);
      setStatus(body.status ?? "new");
      setPriority(body.priority ?? "medium");
    } catch (loadError) {
      if (!signal?.cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load support case");
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }

  useEffect(() => {
    const signal = { cancelled: false };
    void loadCase(signal);
    return () => {
      signal.cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.caseId]);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      const res = await apiFetch(`/support/cases/${params.caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, priority }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      setItem(body);
      await queryClient.invalidateQueries({ queryKey: ["support-cases"] });
      toast.success("Support case updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update support case");
    } finally {
      setSaving(false);
    }
  }

  async function handleComment() {
    if (!comment.trim() || commenting) return;
    try {
      setCommenting(true);
      setError(null);
      const res = await apiFetch(`/support/cases/${params.caseId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: comment.trim(), is_internal: false }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      setComment("");
      await loadCase();
      toast.success("Comment added.");
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : "Failed to add comment");
    } finally {
      setCommenting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <RecordPageHeader
        backHref="/dashboard/support/cases"
        backLabel="Back to Support Cases"
        title={item ? item.case_number : "Support Case"}
        description={item?.subject ?? "Review ownership, SLA, customer links, and case activity."}
        primaryAction={<Button onClick={handleSave} disabled={saving || loading}>{saving ? "Saving..." : "Save Case"}</Button>}
      />

      {error ? <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}

      {loading || !item ? (
        <Card className="px-5 py-5 text-sm text-neutral-500">Loading support case...</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
          <Card className="px-5 py-5">
            <h2 className="text-lg font-semibold text-neutral-100">Case Details</h2>
            <FieldDescription className="mt-1">Update the case lifecycle and priority.</FieldDescription>
            <FieldGroup className="mt-4 grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Priority</FieldLabel>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <SummaryTile label="Source" value={item.source || "-"} />
              <SummaryTile label="Assignee" value={item.assigned_to_id ? `User #${item.assigned_to_id}` : "Unassigned"} />
              <SummaryTile label="SLA Due" value={item.sla_due_at ? formatDateTime(item.sla_due_at) : "-"} />
              <SummaryTile label="Updated" value={formatDateTime(item.updated_at)} />
            </FieldGroup>
            {item.description ? <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-neutral-300">{item.description}</p> : null}
          </Card>

          <Card className="px-5 py-5">
            <h2 className="text-lg font-semibold text-neutral-100">Related Records</h2>
            <div className="mt-4 grid gap-3">
              <LinkedTile label="Contact" value={item.contact_id ? `Contact #${item.contact_id}` : "No contact"} href={item.contact_id ? `/dashboard/sales/contacts/${item.contact_id}` : null} />
              <LinkedTile label="Account" value={item.organization_id ? `Account #${item.organization_id}` : "No account"} href={item.organization_id ? `/dashboard/sales/organizations/${item.organization_id}` : null} />
              <LinkedTile label="Deal" value={item.opportunity_id ? `Deal #${item.opportunity_id}` : "No deal"} href={item.opportunity_id ? `/dashboard/sales/opportunities/${item.opportunity_id}` : null} />
              <LinkedTile label="Quote" value={item.quote_id ? `Quote #${item.quote_id}` : "No quote"} href={item.quote_id ? `/dashboard/sales/quotes/${item.quote_id}` : null} />
              <LinkedTile label="Order" value={item.order_id ? `Order #${item.order_id}` : "No order"} href={item.order_id ? `/dashboard/sales/orders/${item.order_id}` : null} />
            </div>
          </Card>

          <Card className="px-5 py-5">
            <h2 className="text-lg font-semibold text-neutral-100">Comments</h2>
            <div className="mt-4 grid gap-3">
              {(item.comments ?? []).length ? item.comments?.map((entry) => (
                <div key={entry.id} className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-3">
                  <div className="text-xs text-neutral-500">{formatDateTime(entry.created_at)}{entry.author_id ? ` · User #${entry.author_id}` : ""}</div>
                  <div className="mt-2 whitespace-pre-wrap text-sm text-neutral-200">{entry.body}</div>
                </div>
              )) : <div className="text-sm text-neutral-500">No comments yet.</div>}
            </div>
            <div className="mt-4 grid gap-3">
              <Textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={4} placeholder="Add a case comment" />
              <Button onClick={handleComment} disabled={!comment.trim() || commenting} className="w-fit">{commenting ? "Adding..." : "Add Comment"}</Button>
            </div>
          </Card>

          <Card className="px-5 py-5">
            <h2 className="text-lg font-semibold text-neutral-100">Events</h2>
            <div className="mt-4 grid gap-3">
              {(item.events ?? []).length ? item.events?.map((event) => (
                <div key={event.id} className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-3">
                  <div className="text-sm font-medium text-neutral-200">{event.event_type.replace(/_/g, " ")}</div>
                  <div className="mt-1 text-xs text-neutral-500">{formatDateTime(event.created_at)}</div>
                </div>
              )) : <div className="text-sm text-neutral-500">No events yet.</div>}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-2 text-sm text-neutral-100">{value}</div>
    </div>
  );
}

function LinkedTile({ label, value, href }: { label: string; value: string; href: string | null }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-2 text-sm text-neutral-100">
        {href ? <Link href={href} className="hover:text-white">{value}</Link> : value}
      </div>
    </div>
  );
}
