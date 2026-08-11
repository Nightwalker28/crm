"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, MessageSquare, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useClientSupportActions, useClientSupportCase } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default function ClientSupportDetailPage() {
  const params = useParams();
  const caseId = String(params.caseId ?? "");
  const caseQuery = useClientSupportCase(caseId);
  const { addComment, updateStatus, isAddingComment, isUpdatingStatus } = useClientSupportActions();
  const [reply, setReply] = useState("");
  const item = caseQuery.data;
  const closed = item?.status === "closed" || item?.status === "resolved";

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reply.trim()) return;
    try {
      await addComment({ caseId, body: reply.trim() });
      setReply("");
      toast.success("Reply added.");
    } catch {
      toast.error("Failed to add reply.");
    }
  }

  async function changeStatus(action: "close" | "reopen") {
    try {
      await updateStatus({ caseId, action });
      toast.success(action === "close" ? "Ticket closed." : "Ticket reopened.");
    } catch {
      toast.error("Failed to update ticket.");
    }
  }

  return (
    <main className="min-h-screen bg-app text-copy-primary">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line-default pb-4">
          <Link href="/client" className="font-lynk text-3xl text-copy-primary">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client/support">
              <ArrowLeft className="h-4 w-4" />
              Support
            </Link>
          </Button>
        </header>

        {caseQuery.isLoading ? (
          <div className="rounded-[var(--radius-card)] border border-line-default bg-surface p-8 text-center text-sm text-copy-muted">Loading ticket...</div>
        ) : caseQuery.error ? (
          <div className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted p-5 text-sm text-state-danger">
            {caseQuery.error instanceof Error ? caseQuery.error.message : "Support ticket unavailable."}
          </div>
        ) : item ? (
          <div className="grid gap-5">
            <section className="rounded-[var(--radius-card)] border border-line-default bg-surface p-5">
              <div className="text-xs font-medium text-copy-label">{item.case_number}</div>
              <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-3xl font-semibold tracking-normal text-copy-primary">{item.subject}</h1>
                  <p className="mt-1 text-sm text-copy-secondary">{formatDateTime(item.created_at)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-[var(--radius-card)] border border-line-default bg-app px-3 py-2 text-right">
                    <div className="capitalize text-copy-secondary">{statusLabel(item.status)}</div>
                    <div className="text-xs capitalize text-copy-muted">{item.category || "general"} · {item.priority}</div>
                  </div>
                  {closed ? (
                    <Button type="button" variant="outline" size="sm" disabled={isUpdatingStatus} onClick={() => void changeStatus("reopen")}>
                      <RotateCcw className="h-4 w-4" />
                      Reopen
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" size="sm" disabled={isUpdatingStatus} onClick={() => void changeStatus("close")}>
                      <XCircle className="h-4 w-4" />
                      Close
                    </Button>
                  )}
                </div>
              </div>
              {item.description ? <p className="mt-5 whitespace-pre-wrap text-p-sm text-copy-secondary">{item.description}</p> : null}
            </section>

            <section className="rounded-[var(--radius-card)] border border-line-default bg-surface p-5">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-copy-secondary" />
                <h2 className="text-base font-semibold text-copy-primary">Thread</h2>
              </div>
              <div className="mt-4 grid gap-3">
                {item.comments.length ? item.comments.map((comment) => (
                  <div key={comment.id} className="rounded-[var(--radius-card)] border border-line-default bg-app p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-copy-muted">
                      <span>{comment.author_display_name || (comment.author_type === "team" ? "Support team" : "You")}</span>
                      <span>{formatDateTime(comment.created_at)}</span>
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-p-sm text-copy-secondary">{comment.body}</div>
                  </div>
                )) : <div className="text-sm text-copy-muted">No replies yet.</div>}
              </div>
              <form className="mt-4 grid gap-3" onSubmit={(event) => void submitReply(event)}>
                <Textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={4} placeholder="Write a reply" />
                <Button type="submit" className="w-fit" disabled={!reply.trim() || isAddingComment}>
                  {isAddingComment ? "Adding..." : "Add Reply"}
                </Button>
              </form>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
