"use client";

import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/hooks/useConfirm";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

type CommentItem = {
  id: number;
  actor_user_id?: number | null;
  module_key: string;
  entity_id: string;
  body: string;
  author_name: string;
  created_at: string;
  updated_at: string;
};

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
  moduleKey: "sales_contacts" | "sales_organizations" | "sales_opportunities";
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
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load notes.");
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
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load mention suggestions.");
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
    const match = /(^|\s)@([^\s@]*)$/.exec(prefix);
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
      const responseBody = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((responseBody && typeof responseBody.detail === "string" && responseBody.detail) || "Failed to add note.");
      }
      setDraft("");
      setSelectedMentions([]);
      setMentionStart(null);
      setMentionQuery(null);
      await refreshPanels();
      toast.success("Note added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add note.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(commentId: number) {
    const confirmed = await confirm({
      title: "Delete note?",
      description: "Delete this note?",
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
      const responseBody = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((responseBody && typeof responseBody.detail === "string" && responseBody.detail) || "Failed to delete note.");
      }
      await refreshPanels();
      toast.success("Note deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete note.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card className="px-5 py-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-100">{title}</h2>
          <p className="mt-1 text-sm text-neutral-500">{description}</p>
        </div>
        <MessageSquareText className="mt-1 h-4 w-4 text-neutral-500" />
      </div>

      <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
        <div className="relative">
          <Textarea
            value={draft}
            onChange={(event) => updateDraft(event.target.value, event.target.selectionStart)}
            onClick={(event) => updateDraft(event.currentTarget.value, event.currentTarget.selectionStart)}
            onKeyUp={(event) => updateDraft(event.currentTarget.value, event.currentTarget.selectionStart)}
            rows={4}
            maxLength={5000}
            placeholder="Add internal context, decisions, or follow-up notes for this record. Type @ to mention a teammate."
          />
          {mentionQuery !== null ? (
            <div className="absolute left-2 right-2 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-950 py-1 shadow-xl">
              {mentionQueryResult.isLoading ? (
                <div className="px-3 py-2 text-sm text-neutral-500">Loading people...</div>
              ) : mentionQueryResult.data?.results.length ? (
                mentionQueryResult.data.results.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className="flex w-full flex-col px-3 py-2 text-left hover:bg-white/8"
                    onClick={() => insertMention(user)}
                  >
                    <span className="text-sm font-medium text-neutral-100">{user.label}</span>
                    <span className="text-xs text-neutral-500">{user.email}</span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-sm text-neutral-500">No matching users with record access.</div>
              )}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-neutral-500">Mentions only include users who can view this module.</div>
          <Button type="submit" disabled={submitting || !draft.trim()}>
            {submitting ? "Saving..." : "Add Note"}
          </Button>
        </div>
      </form>

      {query.isLoading ? (
        <div className="mt-4 text-sm text-neutral-500">Loading notes…</div>
      ) : query.error ? (
        <div className="mt-4 rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {query.error instanceof Error ? query.error.message : "Failed to load notes."}
        </div>
      ) : query.data?.results.length ? (
        <div className="mt-4 space-y-3">
          {query.data.results.map((item) => (
            <div key={item.id} className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-neutral-100">{item.author_name}</div>
                  <div className="mt-1 text-xs text-neutral-500">{formatDateTime(item.created_at)}</div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-neutral-500 hover:text-red-300"
                  onClick={() => void handleDelete(item.id)}
                  disabled={deletingId === item.id}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Delete note</span>
                </Button>
              </div>
              <div className="mt-3 whitespace-pre-wrap text-sm text-neutral-200">{item.body}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-neutral-800 bg-neutral-950/40 px-4 py-6 text-sm text-neutral-500">
          No notes on this record yet.
        </div>
      )}
    </Card>
  );
}
