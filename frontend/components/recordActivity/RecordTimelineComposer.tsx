"use client";

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, MessageCircle, Phone, StickyNote } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { RecordModuleKey } from "@/types/record-activity";

/**
 * The Timeline's composer — the one place a record's history is written from.
 *
 * §4.7 puts it at the top of the feed, above the entries it produces, because "log what
 * happened" and "read what happened" are the same surface. That is also the shape every
 * comparable CRM converged on: HubSpot, Pipedrive and Dynamics all sit the composer over
 * the timeline, and none of them keeps a separate Notes tab beside it — the note *is* a
 * timeline entry.
 *
 * It replaces two panels. `RecordCommentsPanel`'s composer becomes the `note` mode, and
 * `FollowUpPanel` becomes the channel modes; neither kept its own list, because the feed
 * underneath already renders both (`type="note"`, `type="follow_up"`). Rendering them
 * twice was the duplication 5.3 was called on to remove.
 *
 * A follow-up looks like state and is not: it creates a `RecordFollowUp` row and only
 * *stamps* `last_contacted_at`, so by §4.7's test it is an event and belongs here rather
 * than in the spine.
 */

type MentionableUser = { id: number; label: string; email: string };

type FollowUpConfig = {
  endpoint: string;
  email?: string | null;
  phone?: string | null;
  canCreateTask?: boolean;
  onLogged?: () => Promise<void> | void;
};

type ReplyConfig = {
  endpoint: string;
  label: string;
  placeholder: string;
  onReplied?: () => Promise<void> | void;
};

type WhatsAppConfig = {
  /** Click-to-chat. Records the interaction and returns the URL to open. */
  endpoint: string;
  phone?: string | null;
  canCreateTask?: boolean;
  onLogged?: () => Promise<void> | void;
};

type Props = {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  /** Note mode. Omitted when the operator cannot write to the record. */
  canAddNote?: boolean;
  /** Channel modes. Omitted where the record has no follow-up endpoint. */
  followUp?: FollowUpConfig;
  /** The support case's customer-facing reply. Appended as its own mode. */
  reply?: ReplyConfig;
  /**
   * Replaces the generic WhatsApp channel mode with the tracked one (§4.7).
   *
   * `followUp`'s WhatsApp is a `wa.me` link plus a logged follow-up row. Where the module
   * has a real click-to-chat endpoint — contacts do — it picks a template, records a
   * `WhatsAppInteraction` and can create the reminder, and that interaction is what the
   * feed below renders. The record page must then not offer the untracked path as well.
   */
  whatsApp?: WhatsAppConfig;
  className?: string;
};

type MessageTemplate = {
  id: number;
  name: string;
  body: string;
  variables: string[];
};

type Channel = "whatsapp" | "email" | "call";

const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  call: "Call",
};

function toIsoOrNull(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export default function RecordTimelineComposer({
  moduleKey,
  entityId,
  canAddNote = false,
  followUp,
  reply,
  whatsApp,
  className,
}: Props) {
  const modes: { id: string; label: string; icon: typeof StickyNote }[] = [
    ...(canAddNote ? [{ id: "note", label: "Note", icon: StickyNote }] : []),
    ...(reply ? [{ id: "reply", label: reply.label, icon: Mail }] : []),
    ...(followUp ? [{ id: "call", label: "Call", icon: Phone }] : []),
    ...(followUp ? [{ id: "email", label: "Email", icon: Mail }] : []),
    ...(followUp || whatsApp ? [{ id: "whatsapp", label: "WhatsApp", icon: MessageCircle }] : []),
  ];
  const [mode, setMode] = useState(modes[0]?.id ?? "note");

  if (!modes.length) return null;
  const activeMode = modes.some((item) => item.id === mode) ? mode : modes[0].id;

  return (
    <div
      data-slot="record-timeline-composer"
      className={cn(
        // Level 2 (§1.3): the composer is interactive, so it earns its border inside the
        // Timeline panel; the entries under it do not and are `divide-y` lines instead.
        "rounded-[var(--radius-control)] border border-line-subtle",
        className,
      )}
    >
      <div className="border-b border-line-subtle px-2 py-2">
        <SegmentedControl
          value={activeMode}
          onValueChange={setMode}
          aria-label="Add to the timeline"
        >
          {modes.map((item) => {
            const Icon = item.icon;
            return (
              <SegmentedItem key={item.id} value={item.id}>
                <Icon />
                {item.label}
              </SegmentedItem>
            );
          })}
        </SegmentedControl>
      </div>

      <div className="px-4 py-4">
        {activeMode === "note" ? (
          <NoteMode moduleKey={moduleKey} entityId={entityId} />
        ) : activeMode === "reply" && reply ? (
          <ReplyMode moduleKey={moduleKey} entityId={entityId} config={reply} />
        ) : activeMode === "whatsapp" && whatsApp ? (
          <WhatsAppMode moduleKey={moduleKey} entityId={entityId} config={whatsApp} />
        ) : followUp ? (
          <FollowUpMode
            moduleKey={moduleKey}
            entityId={entityId}
            channel={activeMode as Channel}
            config={followUp}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Note mode — carried over from `RecordCommentsPanel` with its `@` mention picker intact.
 *
 * The picker is a bounded overlay rather than page content, so its own scroll is exempt
 * under §4.5.
 */
function NoteMode({
  moduleKey,
  entityId,
}: {
  moduleKey: RecordModuleKey;
  entityId: string | number;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [selectedMentions, setSelectedMentions] = useState<MentionableUser[]>([]);
  const fieldId = `record-note-${moduleKey}-${entityId}`;

  const mentionQueryResult = useQuery({
    queryKey: ["record-comment-mentionable-users", moduleKey, String(entityId), mentionQuery ?? ""],
    queryFn: async () => {
      const params = new URLSearchParams({
        module_key: moduleKey,
        entity_id: String(entityId),
        search: mentionQuery ?? "",
      });
      const res = await apiFetch(`/record-comments/mentionable-users?${params.toString()}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error("Mention suggestions could not be loaded.");
      return body as { results: MentionableUser[] };
    },
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
    setMentionStart(prefix.length - match[2].length - 1);
    setMentionQuery(match[2]);
  }

  function insertMention(user: MentionableUser) {
    if (mentionStart === null) return;
    const before = draft.slice(0, mentionStart);
    const after = draft.slice(mentionStart).replace(/^@[^\s@]*/, "");
    setDraft(`${before}@${user.label} ${after.replace(/^\s*/, "")}`);
    setSelectedMentions((current) =>
      current.some((item) => item.id === user.id) ? current : [...current, user],
    );
    setMentionStart(null);
    setMentionQuery(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || submitting) return;

    try {
      setSubmitting(true);
      const params = new URLSearchParams({ module_key: moduleKey, entity_id: String(entityId) });
      const res = await apiFetch(`/record-comments?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          mentioned_user_ids: selectedMentions
            .filter((user) => body.includes(`@${user.label}`))
            .map((user) => user.id),
        }),
      });
      if (!res.ok) throw new Error("The note could not be added.");
      setDraft("");
      setSelectedMentions([]);
      setMentionStart(null);
      setMentionQuery(null);
      await queryClient.invalidateQueries({
        queryKey: ["record-activity", moduleKey, String(entityId)],
      });
      toast.success("Note added.");
    } catch {
      toast.error("The note could not be added. Check your access and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-3" onSubmit={handleSubmit}>
      <Field>
        <FieldLabel htmlFor={fieldId}>Add internal note</FieldLabel>
        <div className="relative">
          <Textarea
            id={fieldId}
            value={draft}
            onChange={(event) => updateDraft(event.target.value, event.target.selectionStart)}
            onClick={(event) => updateDraft(event.currentTarget.value, event.currentTarget.selectionStart)}
            onKeyUp={(event) => updateDraft(event.currentTarget.value, event.currentTarget.selectionStart)}
            rows={3}
            maxLength={5000}
            placeholder="Capture context, decisions, or next steps. Type @ to mention a teammate."
            aria-describedby={`${fieldId}-help`}
            autoComplete="off"
          />
          {mentionQuery !== null ? (
            <div
              role="listbox"
              aria-label="Mention suggestions"
              data-bounded-list
              // A bounded overlay, not page content — exempt from §4.5 by that rule's own
              // list. An uncapped one would push the feed underneath off the screen.
              className="absolute left-2 right-2 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-[var(--radius-control)] border border-line-default bg-surface-raised py-1 shadow-[var(--shadow-panel)]"
            >
              {mentionQueryResult.isLoading ? (
                <div role="status" className="px-3 py-2 text-sm text-copy-muted">Loading people…</div>
              ) : mentionQueryResult.isError ? (
                <div role="alert" className="px-3 py-2 text-sm text-state-danger">
                  Mention suggestions could not be loaded.
                </div>
              ) : mentionQueryResult.data?.results.length ? (
                mentionQueryResult.data.results.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    role="option"
                    aria-selected="false"
                    className="flex w-full flex-col px-3 py-2 text-left text-copy-secondary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                    onClick={() => insertMention(user)}
                  >
                    <span className="text-sm font-medium text-copy-primary">{user.label}</span>
                    <span className="text-xs text-copy-muted">{user.email}</span>
                  </button>
                ))
              ) : (
                <div role="status" className="px-3 py-2 text-sm text-copy-muted">
                  No matching users with record access.
                </div>
              )}
            </div>
          ) : null}
        </div>
        <FieldDescription id={`${fieldId}-help`}>
          Mentions only include active users who can view this module. {draft.length}/5000 characters.
        </FieldDescription>
      </Field>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={submitting || !draft.trim()}>
          {submitting ? "Saving…" : "Add note"}
        </Button>
      </div>
    </form>
  );
}

/** Channel modes — logging an outbound contact, and optionally the reminder that follows. */
function FollowUpMode({
  moduleKey,
  entityId,
  channel,
  config,
}: {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  channel: Channel;
  config: FollowUpConfig;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [createReminder, setCreateReminder] = useState(true);
  const [dueAt, setDueAt] = useState("");
  const [logging, setLogging] = useState(false);
  const fieldId = `record-follow-up-note-${channel}`;
  const shouldCreateReminder = Boolean(config.canCreateTask) && createReminder;
  const target = channel === "email" ? config.email : config.phone;

  async function logFollowUp() {
    if (logging) return;
    try {
      setLogging(true);
      const res = await apiFetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          note: note.trim() || null,
          create_follow_up_task: shouldCreateReminder,
          follow_up_due_at: shouldCreateReminder ? toIsoOrNull(dueAt) : null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error("not-logged");
      if (channel === "email" && config.email) window.location.href = `mailto:${config.email}`;
      if (channel === "call" && config.phone) window.location.href = `tel:${config.phone}`;
      if (channel === "whatsapp" && config.phone) {
        window.open(`https://wa.me/${config.phone.replace(/\D/g, "")}`, "_blank", "noopener,noreferrer");
      }
      setNote("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["record-activity", moduleKey, String(entityId)] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["record-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["user-notifications"] }),
      ]);
      toast.success(
        body?.follow_up_task_id
          ? `${CHANNEL_LABELS[channel]} logged and reminder created.`
          : `${CHANNEL_LABELS[channel]} logged.`,
      );
      await config.onLogged?.();
    } catch {
      toast.error(`The ${CHANNEL_LABELS[channel]} follow-up could not be logged. Try again.`);
    } finally {
      setLogging(false);
    }
  }

  return (
    <div className="grid gap-3">
      <Field>
        <FieldLabel htmlFor={fieldId}>Follow-up note</FieldLabel>
        <Textarea
          id={fieldId}
          rows={3}
          maxLength={5000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Capture the outcome and next action."
        />
      </Field>
      {config.canCreateTask ? (
        <label className="flex items-center gap-2 text-sm text-copy-secondary">
          <Checkbox
            checked={createReminder}
            onCheckedChange={(checked) => setCreateReminder(checked === true)}
          />
          Create reminder task
        </label>
      ) : null}
      {shouldCreateReminder ? (
        <Field>
          <FieldLabel htmlFor={`${fieldId}-due`}>Reminder due</FieldLabel>
          <Input
            id={`${fieldId}-due`}
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
          <FieldDescription>Leave blank to create the reminder without a due time.</FieldDescription>
        </Field>
      ) : null}
      <div className="flex items-center justify-end gap-3">
        {!target ? (
          <p className="text-p-xs text-copy-muted">
            No {channel === "email" ? "email address" : "phone number"} is recorded for this record.
          </p>
        ) : null}
        <Button type="button" size="sm" disabled={logging || !target} onClick={() => void logFollowUp()}>
          {logging ? "Logging…" : `Log ${CHANNEL_LABELS[channel].toLocaleLowerCase()}`}
        </Button>
      </div>
    </div>
  );
}

/**
 * Tracked WhatsApp — the pre-5.3 `WhatsApp` panel, now a composer mode.
 *
 * The panel sat in the contact's primary region with its own "Last contacted" line, three
 * fields and a button, directly above a feed that renders every one of its clicks as a
 * `whatsapp` entry. Folding it in drops the duplicated summary line — the feed underneath
 * *is* the history — and puts the record's one WhatsApp affordance where the other
 * channels already live (§4.7).
 *
 * The blank window is opened synchronously on the click and only then pointed at the URL
 * the server returns. Opening it after the `await` is a popup the browser blocks, which is
 * the behaviour the panel already had and the reason it is preserved here.
 */
function WhatsAppMode({
  moduleKey,
  entityId,
  config,
}: {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  config: WhatsAppConfig;
}) {
  const queryClient = useQueryClient();
  const [templateId, setTemplateId] = useState("");
  const [createReminder, setCreateReminder] = useState(true);
  const [dueAt, setDueAt] = useState("");
  const [sending, setSending] = useState(false);
  const fieldId = `record-whatsapp-${moduleKey}-${entityId}`;

  const templatesQuery = useQuery({
    queryKey: ["message-templates", "whatsapp", moduleKey],
    queryFn: async () => {
      const params = new URLSearchParams({ channel: "whatsapp", module_key: moduleKey });
      const res = await apiFetch(`/message-templates?${params.toString()}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error("WhatsApp templates could not be loaded.");
      return (body?.results ?? []) as MessageTemplate[];
    },
    staleTime: 5 * 60_000,
  });

  const templates = templatesQuery.data ?? [];
  const activeTemplate =
    templates.find((template) => String(template.id) === templateId) ?? templates[0] ?? null;
  const shouldCreateReminder = Boolean(config.canCreateTask) && createReminder;
  const blocked = sending || !config.phone || !templates.length || templatesQuery.isLoading;

  async function openChat() {
    if (blocked) return;
    // Synchronously, before any await — see the note above.
    const pending =
      typeof window !== "undefined" && typeof window.open === "function"
        ? window.open("about:blank", "_blank")
        : null;
    if (pending) pending.opener = null;

    try {
      setSending(true);
      const res = await apiFetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: activeTemplate ? activeTemplate.id : null,
          create_follow_up_task: shouldCreateReminder,
          follow_up_due_at: shouldCreateReminder ? toIsoOrNull(dueAt) : null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.whatsapp_url) throw new Error("not-opened");
      if (pending) pending.location.href = body.whatsapp_url;
      else window.open(body.whatsapp_url, "_blank", "noopener,noreferrer");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["record-activity", moduleKey, String(entityId)] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["record-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["user-notifications"] }),
      ]);
      toast.success(
        body.follow_up_task ? "WhatsApp chat opened and reminder created." : "WhatsApp chat opened.",
      );
      await config.onLogged?.();
    } catch {
      pending?.close();
      toast.error("WhatsApp chat could not be started. Check the phone number and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-3">
      <Field>
        <FieldLabel htmlFor={fieldId}>Message template</FieldLabel>
        <Select
          value={activeTemplate ? String(activeTemplate.id) : ""}
          onValueChange={setTemplateId}
          disabled={!templates.length || templatesQuery.isLoading}
        >
          <SelectTrigger id={fieldId}>
            <SelectValue
              placeholder={
                templatesQuery.isLoading
                  ? "Loading templates"
                  : templates.length
                    ? "Select template"
                    : "No templates available"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {templates.map((template) => (
              <SelectItem key={template.id} value={String(template.id)}>
                {template.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeTemplate ? (
          <FieldDescription>{activeTemplate.body}</FieldDescription>
        ) : null}
      </Field>
      {config.canCreateTask ? (
        <label className="flex items-center gap-2 text-sm text-copy-secondary">
          <Checkbox
            checked={createReminder}
            onCheckedChange={(checked) => setCreateReminder(checked === true)}
          />
          Create reminder task
        </label>
      ) : null}
      {shouldCreateReminder ? (
        <Field>
          <FieldLabel htmlFor={`${fieldId}-due`}>Reminder due</FieldLabel>
          <Input
            id={`${fieldId}-due`}
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
          <FieldDescription>Leave blank to create the reminder without a due time.</FieldDescription>
        </Field>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {!config.phone ? (
          <p className="text-p-xs text-copy-muted">No phone number is recorded for this record.</p>
        ) : !templatesQuery.isLoading && !templates.length ? (
          <p className="text-p-xs text-copy-muted">
            No WhatsApp template is configured for this module yet.
          </p>
        ) : null}
        <Button type="button" size="sm" disabled={blocked} onClick={() => void openChat()}>
          {sending ? "Opening…" : "Open WhatsApp"}
        </Button>
      </div>
      <p className="text-p-xs text-copy-muted">
        Lynk opens the chat in WhatsApp and records it here. Delivery is not tracked.
      </p>
    </div>
  );
}

/** The support case's customer-facing reply, now writing into the same feed it reads from. */
function ReplyMode({
  moduleKey,
  entityId,
  config,
}: {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  config: ReplyConfig;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const fieldId = `record-reply-${moduleKey}-${entityId}`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || submitting) return;

    try {
      setSubmitting(true);
      setFailed(false);
      const res = await apiFetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, is_internal: false }),
      });
      if (!res.ok) throw new Error("not-sent");
      setDraft("");
      await queryClient.invalidateQueries({
        queryKey: ["record-activity", moduleKey, String(entityId)],
      });
      await config.onReplied?.();
      toast.success("Reply added.");
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-3" onSubmit={handleSubmit}>
      <Field>
        <FieldLabel htmlFor={fieldId}>{config.label}</FieldLabel>
        <Textarea
          id={fieldId}
          rows={3}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (failed) setFailed(false);
          }}
          placeholder={config.placeholder}
          aria-invalid={failed}
          aria-describedby={failed ? `${fieldId}-error` : undefined}
        />
        {failed ? (
          <p id={`${fieldId}-error`} role="alert" className="text-sm text-state-danger">
            The reply could not be added. Try again.
          </p>
        ) : null}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={submitting || !draft.trim()}>
          {submitting ? "Adding…" : "Add reply"}
        </Button>
      </div>
    </form>
  );
}
