"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { PageShell } from "@/components/ui/PageShell";
import { PanelHeader } from "@/components/ui/PanelStates";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { StatusValue } from "@/components/ui/StatusValue";
import { Textarea } from "@/components/ui/textarea";
import { useClientMessageActions, useClientMessages } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";
import { getSupportCaseStatus } from "@/lib/statusStyles";

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
    } catch {
      toast.error("The question could not be sent. Check your connection and try again.");
    }
  }

  return (
    <PageShell
      title="Quick questions"
      isLoading={messagesQuery.isLoading}
      hasError={Boolean(messagesQuery.error)}
      backHref="/client"
      backLabel="Return to the portal"
      onRetry={() => messagesQuery.refetch()}
    >
      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="flex h-fit flex-col gap-4 p-4">
          <PanelHeader title="Ask a question" description="A member of the team replies in this thread." />
          <form className="grid gap-4" onSubmit={(event) => void submitQuestion(event)}>
            <Field>
              <FieldLabel htmlFor="client-message-subject">
                Subject <RequiredMark />
              </FieldLabel>
              <Input
                id="client-message-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Short question summary"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="client-message-body">
                Message <RequiredMark />
              </FieldLabel>
              <Textarea
                id="client-message-body"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={6}
                placeholder="Ask your question here."
                required
              />
            </Field>
            <Button type="submit" disabled={!subject.trim() || !message.trim() || isCreatingMessage}>
              {isCreatingMessage ? "Sending…" : "Send question"}
            </Button>
          </form>
        </Card>

        {messages.length === 0 ? (
          <EmptyState
            title="No questions yet"
            description="Ask a question and the thread will appear here with the team's replies."
          />
        ) : (
          <Card className="h-fit p-0">
            <RowList label="Questions" inset>
              {messages.map((item) => (
                <ListRow
                  key={item.id}
                  title={item.subject}
                  href={`/client/messages/${item.id}`}
                  meta={`${item.case_number} · ${formatDateTime(item.updated_at)} · ${item.comments.length} ${item.comments.length === 1 ? "reply" : "replies"}`}
                  trailing={<StatusValue status={getSupportCaseStatus(item.status)} />}
                />
              ))}
            </RowList>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
