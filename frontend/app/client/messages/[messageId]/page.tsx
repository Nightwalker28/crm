"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useClientMessage, useClientMessageActions } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default function ClientMessageDetailPage() {
  const params = useParams();
  const messageId = String(params.messageId ?? "");
  const messageQuery = useClientMessage(messageId);
  const { addMessageComment, isAddingMessageComment } = useClientMessageActions();
  const [reply, setReply] = useState("");
  const item = messageQuery.data;

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reply.trim()) return;
    try {
      await addMessageComment({ messageId, body: reply.trim() });
      setReply("");
      toast.success("Reply sent.");
    } catch {
      toast.error("Failed to send reply.");
    }
  }

  return (
    <main className="min-h-screen bg-app text-copy-primary">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line-default pb-4">
          <Link href="/client" className="font-lynk text-3xl text-copy-primary">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client/messages">
              <ArrowLeft className="h-4 w-4" />
              Messages
            </Link>
          </Button>
        </header>

        {messageQuery.isLoading ? (
          <div className="rounded-[var(--radius-card)] border border-line-default bg-surface p-8 text-center text-sm text-copy-muted">Loading message...</div>
        ) : messageQuery.error ? (
          <div className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted p-5 text-sm text-state-danger">
            {messageQuery.error instanceof Error ? messageQuery.error.message : "Message unavailable."}
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
                <div className="text-right">
                  <div className="capitalize text-copy-secondary">{statusLabel(item.status)}</div>
                  <div className="text-xs text-copy-muted">Quick question</div>
                </div>
              </div>
              {item.description ? <p className="mt-5 whitespace-pre-wrap text-p-sm text-copy-secondary">{item.description}</p> : null}
            </section>

            <section className="rounded-[var(--radius-card)] border border-line-default bg-surface p-5">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-copy-secondary" />
                <h2 className="text-base font-semibold text-copy-primary">Conversation</h2>
              </div>
              <div className="mt-4 grid gap-3">
                {item.comments.length ? item.comments.map((comment) => (
                  <div key={comment.id} className="rounded-[var(--radius-control)] border border-line-subtle bg-app p-4">
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
                <Button type="submit" className="w-fit" disabled={!reply.trim() || isAddingMessageComment}>
                  {isAddingMessageComment ? "Sending..." : "Send Reply"}
                </Button>
              </form>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
