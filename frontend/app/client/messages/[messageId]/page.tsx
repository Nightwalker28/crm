"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";

import { RecordWorkspace } from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { PanelHeader } from "@/components/ui/PanelStates";
import { StatusValue } from "@/components/ui/StatusValue";
import { Textarea } from "@/components/ui/textarea";
import { useClientMessage, useClientMessageActions } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";
import { getSupportCaseStatus } from "@/lib/statusStyles";

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
      toast.error("The reply could not be sent. Check your connection and try again.");
    }
  }

  return (
    // Archetype 2, read-only (§4.7): no `spine`. A reply creates a comment — a row pointing
    // at this record, which §4.7 keeps in the content region in any case.
    <RecordWorkspace
      title={item?.subject ?? "Question"}
      description="Read the thread and reply to the team."
      backHref="/client/messages"
      backLabel="Messages"
      isLoading={messageQuery.isLoading}
      hasError={Boolean(messageQuery.error) || (!messageQuery.isLoading && !item)}
      onRetry={() => void messageQuery.refetch()}
      status={item ? <StatusValue status={getSupportCaseStatus(item.status)} context="record" /> : null}
      subtitle={
        item ? (
          <>
            <span>{item.case_number}</span>
            <span>Asked {formatDateTime(item.created_at)}</span>
          </>
        ) : null
      }
      details={
        item ? (
          <div className="flex min-w-0 flex-col gap-6">
            {item.description ? (
              <Card className="flex min-w-0 flex-col gap-4 p-6">
                <PanelHeader title="Your question" />
                <p className="whitespace-pre-wrap text-p-sm text-copy-secondary">{item.description}</p>
              </Card>
            ) : null}

            <Card className="flex min-w-0 flex-col gap-4 p-6">
              <PanelHeader title="Conversation" />
              {item.comments.length === 0 ? (
                <EmptyState
                  title="No replies yet"
                  description="The team's replies will appear here, newest at the bottom."
                />
              ) : (
                <RowList label="Replies" ordered>
                  {item.comments.map((comment) => (
                    <ListRow
                      key={comment.id}
                      title={comment.author_display_name || (comment.author_type === "team" ? "Support team" : "You")}
                      trailing={formatDateTime(comment.created_at)}
                    >
                      <span className="whitespace-pre-wrap">{comment.body}</span>
                    </ListRow>
                  ))}
                </RowList>
              )}

              <form className="grid gap-3" onSubmit={(event) => void submitReply(event)}>
                <Textarea
                  aria-label="Your reply"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  rows={4}
                  placeholder="Write a reply"
                />
                <Button type="submit" className="w-fit" disabled={!reply.trim() || isAddingMessageComment}>
                  {isAddingMessageComment ? "Sending…" : "Send reply"}
                </Button>
              </form>
            </Card>
          </div>
        ) : null
      }
    />
  );
}
