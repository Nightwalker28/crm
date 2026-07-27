"use client";

import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  RecordPanelEmpty,
  RecordPanelError,
  RecordPanelHeader,
  RecordPanelLoading,
} from "@/components/recordActivity/RecordPanelStates";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/hooks/useConfirm";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import type { CommentItem, RecordModuleKey } from "@/types/record-activity";

type CommentsResponse = {
  results: CommentItem[];
};

type MentionableUser = {
  id: number;
  label: string;
  email: string;
};

type MentionableUsersResponse = {
  results: MentionableUser[];
};

type Props = {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  title?: string;
  description?: string;
};

async function fetchRecordComments(moduleKey: Props["moduleKey"], entityId: string | number): Promise<CommentsResponse> {
  const params = new URLSearchParams({
    module_key: moduleKey,
    entity_id: String(entityId),
    page: "1",
    page_size: "10",
  });
  const res = await apiFetch(`/record-comments?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error("Record notes could not be loaded.");
  }
  return body as CommentsResponse;
}

async function fetchMentionableUsers(
  moduleKey: Props["moduleKey"],
  entityId: string | number,
  query: string,
): Promise<MentionableUsersResponse> {
  const params = new URLSearchParams({
    module_key: moduleKey,
    entity_id: String(entityId),
  });
  if (query.trim()) params.set("query", query.trim());
  const res = await apiFetch(`/record-comments/mentionable-users?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error("Mention suggestions could not be loaded.");
  }
  return body as MentionableUsersResponse;
}

export default function RecordCommentsPanel({
  moduleKey,
  entityId,
  title = "Notes & Comments",
  description = "Shared record notes for internal collaboration and context.",
}: Props) {
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [selectedMentions, setSelectedMentions] = useState<MentionableUser[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const query = useQuery({
    queryKey: ["record-comments", moduleKey, String(entityId)],
    queryFn: () => fetchRecordComments(moduleKey, entityId),
    staleTime: 15_000,
  });

  const mentionQueryResult = useQuery({
    queryKey: ["record-comment-mentionable-users", moduleKey, String(entityId), mentionQuery ?? ""],
    queryFn: () => fetchMentionableUsers(moduleKey, entityId, mentionQuery ?? ""),
    enabled: mentionQuery !== null,
    staleTime: 30_000,
  });

  function updateDraft(value: string, cursorPosition: number | null) {
    setDraft(value);
    if (cursorPosition === null) {
      setMentionStart(null);
      setMentionQuery(null);
      return;
    }
    const prefix = value.slice(0, cursorPosition);
    const match = /(^|[\s([{])@([^\s@]*)$/.exec(prefix);
    if (!match) {
      setMentionStart(null);
      setMentionQuery(null);
      return;
    }
    const atIndex = prefix.length - match[2].length - 1;
    setMentionStart(atIndex);
    setMentionQuery(match[2]);
  }

  function insertMention(user: MentionableUser) {
    if (mentionStart === null) return;
    const before = draft.slice(0, mentionStart);
    const after = draft.slice(mentionStart).replace(/^@[^\s@]*/, "");
    const nextDraft = `${before}@${user.label} ${after.replace(/^\s*/, "")}`;
    setDraft(nextDraft);
    setSelectedMentions((current) => {
      if (current.some((item) => item.id === user.id)) return current;
      return [...current, user];
    });
    setMentionStart(null);
    setMentionQuery(null);
  }

  function mentionedUserIdsForBody(body: string) {
    return selectedMentions
      .filter((user) => body.includes(`@${user.label}`))
      .map((user) => user.id);
  }

  async function refreshPanels() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["record-comments", moduleKey, String(entityId)] }),
      queryClient.invalidateQueries({ queryKey: ["record-activity", moduleKey, String(entityId)] }),
    ]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) {
      return;
    }

    try {
      setSubmitting(true);
      const params = new URLSearchParams({
        module_key: moduleKey,
        entity_id: String(entityId),
      });
      const res = await apiFetch(`/record-comments?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, mentioned_user_ids: mentionedUserIdsForBody(body) }),
      });
      if (!res.ok) {
        throw new Error("The note could not be added.");
      }
      setDraft("");
      setSelectedMentions([]);
      setMentionStart(null);
      setMentionQuery(null);
      await refreshPanels();
      toast.success("Note added.");
    } catch {
      toast.error("The note could not be added. Check your access and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(commentId: number) {
    const confirmed = await confirm({
      title: "Delete note?",
      description: "Delete this internal note? This action cannot be undone.",
      confirmLabel: "Delete Note",
      variant: "destructive",
    });
    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(commentId);
      const res = await apiFetch(`/record-comments/${commentId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error("The note could not be deleted.");
      }
      await refreshPanels();
      toast.success("Note deleted.");
    } catch {
      toast.error("The note could not be deleted. Check your access and try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card className="px-5 py-5">
      <RecordPanelHeader title={title} description={description} icon={MessageSquareText} />

      <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
        <Field>
          <FieldLabel htmlFor={`record-note-${moduleKey}-${entityId}`}>Add internal note</FieldLabel>
          <div className="relative">
            <Textarea
              id={`record-note-${moduleKey}-${entityId}`}
              value={draft}
              onChange={(event) => updateDraft(event.target.value, event.target.selectionStart)}
              onClick={(event) => updateDraft(event.currentTarget.value, event.currentTarget.selectionStart)}
              onKeyUp={(event) => updateDraft(event.currentTarget.value, event.currentTarget.selectionStart)}
              rows={4}
              maxLength={5000}
              placeholder="Capture context, decisions, or next steps. Type @ to mention a teammate."
              aria-describedby={`record-note-help-${moduleKey}-${entityId}`}
              autoComplete="off"
            />
            {mentionQuery !== null ? (
              <div
                role="listbox"
                aria-label="Mention suggestions"
                className="absolute left-2 right-2 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-[var(--radius-control)] border border-line-default bg-surface-raised py-1 shadow-xl"
              >
                {mentionQueryResult.isLoading ? (
                  <div role="status" className="px-3 py-2 text-sm text-copy-muted">Loading people…</div>
                ) : mentionQueryResult.isError ? (
                  <div role="alert" className="px-3 py-2 text-sm text-state-danger">Mention suggestions could not be loaded.</div>
                ) : mentionQueryResult.data?.results.length ? (
                  mentionQueryResult.data.results.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      role="option"
                      aria-selected="false"
                      className="flex w-full flex-col px-3 py-2 text-left text-copy-secondary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                      onClick={() => insertMention(user)}
                    >
                      <span className="text-sm font-medium text-copy-primary">{user.label}</span>
                      <span className="text-xs text-copy-muted">{user.email}</span>
                    </button>
                  ))
                ) : (
                  <div role="status" className="px-3 py-2 text-sm text-copy-muted">No matching users with record access.</div>
                )}
              </div>
            ) : null}
          </div>
          <FieldDescription id={`record-note-help-${moduleKey}-${entityId}`}>
            Mentions only include active users who can view this module. {draft.length}/5000 characters.
          </FieldDescription>
        </Field>
        <div className="flex items-center justify-between gap-3">
          <div />
          <Button type="submit" disabled={submitting || !draft.trim()}>
            {submitting ? "Saving…" : "Add note"}
          </Button>
        </div>
      </form>

      {query.isLoading ? (
        <div className="mt-4"><RecordPanelLoading label="Loading notes…" /></div>
      ) : query.error ? (
        <div className="mt-4"><RecordPanelError message="Record notes could not be loaded." onRetry={() => void query.refetch()} /></div>
      ) : query.data?.results.length ? (
        <ol className="mt-4 space-y-3" aria-label="Record notes">
          {query.data.results.map((item) => (
            <li key={item.id} className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-copy-primary">{item.author_name}</div>
                  <div className="mt-1 text-xs text-copy-muted">{formatDateTime(item.created_at)}</div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-copy-muted hover:bg-state-danger-muted hover:text-state-danger"
                  onClick={() => void handleDelete(item.id)}
                  disabled={deletingId === item.id}
                  aria-label={`Delete note by ${item.author_name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-copy-secondary">{item.body}</div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-4"><RecordPanelEmpty icon={MessageSquareText} title="No notes yet" description="Add internal context or mention a teammate to begin collaborating." /></div>
      )}
    </Card>
  );
}
