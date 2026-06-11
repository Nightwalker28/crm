"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, MessageSquare, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Textarea } from "@/components/ui/textarea";
import { useClientMessageActions, useClientMessages } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default function ClientMessagesPage() {
  const messagesQuery = useClientMessages();
  const { createMessage, isCreatingMessage } = useClientMessageActions();
  const messages = messagesQuery.data?.results ?? [];
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    try {
      const created = await createMessage({ subject: subject.trim(), message: message.trim() });
      setSubject("");
      setMessage("");
      toast.success(`Question ${created.case_number} sent.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send question.");
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-4">
          <Link href="/client" className="font-lynk text-3xl text-white">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client">Overview</Link>
          </Button>
        </header>

        <section className="mb-5">
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <MessageSquare className="h-4 w-4" />
            Client messages
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-neutral-50">Quick questions</h1>
        </section>

        <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="h-fit rounded-md border border-neutral-800 bg-neutral-900 p-5">
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-neutral-400" />
              <h2 className="text-base font-semibold text-neutral-100">Ask a question</h2>
            </div>
            <form className="mt-4 grid gap-4" onSubmit={(event) => void submitQuestion(event)}>
              <Field>
                <FieldLabel>Subject <RequiredMark /></FieldLabel>
                <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Short question summary" required />
              </Field>
              <Field>
                <FieldLabel>Message <RequiredMark /></FieldLabel>
                <Textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={6} placeholder="Ask your question here." required />
              </Field>
              <Button type="submit" disabled={!subject.trim() || !message.trim() || isCreatingMessage}>
                {isCreatingMessage ? "Sending..." : "Send Question"}
              </Button>
            </form>
          </section>

          <section>
            {messagesQuery.isLoading ? (
              <div className="rounded-md border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-500">Loading messages...</div>
            ) : messagesQuery.error ? (
              <div className="rounded-md border border-red-900/60 bg-red-950/20 p-5 text-sm text-red-200">
                {messagesQuery.error instanceof Error ? messagesQuery.error.message : "Failed to load messages."}
              </div>
            ) : messages.length === 0 ? (
              <div className="rounded-md border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-500">No quick questions yet.</div>
            ) : (
              <div className="grid gap-3">
                {messages.map((item) => (
                  <Link key={item.id} href={`/client/messages/${item.id}`} className="group rounded-md border border-neutral-800 bg-neutral-900 p-4 transition-colors hover:border-neutral-600 hover:bg-neutral-800/70">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs uppercase text-neutral-500">{item.case_number}</div>
                        <h2 className="mt-1 truncate font-semibold text-neutral-100">{item.subject}</h2>
                        <p className="mt-1 text-xs text-neutral-500">{formatDateTime(item.updated_at)}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="capitalize text-neutral-300">{statusLabel(item.status)}</div>
                          <div className="text-xs text-neutral-500">{item.comments.length} repl{item.comments.length === 1 ? "y" : "ies"}</div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-neutral-500 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
