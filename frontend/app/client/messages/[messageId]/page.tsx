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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send reply.");
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-4">
          <Link href="/client" className="font-lynk text-3xl text-white">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client/messages">
              <ArrowLeft className="h-4 w-4" />
              Messages
            </Link>
          </Button>
        </header>

        {messageQuery.isLoading ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-500">Loading message...</div>
        ) : messageQuery.error ? (
          <div className="rounded-md border border-red-900/60 bg-red-950/20 p-5 text-sm text-red-200">
            {messageQuery.error instanceof Error ? messageQuery.error.message : "Message unavailable."}
          </div>
        ) : item ? (
          <div className="grid gap-5">
            <section className="rounded-md border border-neutral-800 bg-neutral-900 p-5">
              <div className="text-xs uppercase text-neutral-500">{item.case_number}</div>
              <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-3xl font-semibold tracking-normal text-neutral-50">{item.subject}</h1>
                  <p className="mt-1 text-sm text-neutral-400">{formatDateTime(item.created_at)}</p>
                </div>
                <div className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-right">
                  <div className="capitalize text-neutral-200">{statusLabel(item.status)}</div>
                  <div className="text-xs text-neutral-500">Quick question</div>
                </div>
              </div>
              {item.description ? <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-neutral-300">{item.description}</p> : null}
            </section>

            <section className="rounded-md border border-neutral-800 bg-neutral-900 p-5">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-neutral-400" />
                <h2 className="text-base font-semibold text-neutral-100">Conversation</h2>
              </div>
              <div className="mt-4 grid gap-3">
                {item.comments.length ? item.comments.map((comment) => (
                  <div key={comment.id} className="rounded-md border border-neutral-800 bg-neutral-950 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
                      <span>{comment.author_type === "team" ? "Support team" : "You"}</span>
                      <span>{formatDateTime(comment.created_at)}</span>
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-200">{comment.body}</div>
                  </div>
                )) : <div className="text-sm text-neutral-500">No replies yet.</div>}
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
