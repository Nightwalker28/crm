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
import { useWhatsAppCapabilities } from "@/hooks/useWhatsAppCapabilities";
import { apiFetch } from "@/lib/api";
import { recordActivityQueryKeyPrefix } from "@/hooks/useRecordActivity";
import {
  CALL_OUTCOMES,
  CALL_OUTCOME_LABELS,
  callLogEndpoint,
  telHref,
  type CallDirection,
  type CallOutcome,
} from "@/lib/calls";
import { cn } from "@/lib/utils";
import {
  WHATSAPP_NUMBER_MESSAGES,
  openPendingWhatsAppWindow,
  whatsAppChatTarget,
  whatsAppChatUrl,
} from "@/lib/whatsapp";
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

/** A person who may have been on a call logged on this record (a deal's participant). */
export type CallPerson = {
  contactId: number;
  name: string;
  phone: string | null;
  roleLabel?: string | null;
};

type CallConfig = {
  /** The record's own number: a lead's or a contact's. */
  phone?: string | null;
  /**
   * Who the call can be with, where the record is not itself a person — a deal's
   * participants, a quote's contact. One is preselected; several leave the choice to the
   * operator, as the deal's Email does (§4.7).
   */
  people?: CallPerson[];
  canCreateTask?: boolean;
  onLogged?: () => Promise<void> | void;
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
  /** Email and WhatsApp follow-up modes. Omitted where the record has no follow-up endpoint. */
  followUp?: FollowUpConfig;
  /** Call mode: a call log (07). Omitted where calls are not logged or the operator cannot. */
  call?: CallConfig;
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

type Channel = "whatsapp" | "email";

const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
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
  call,
  reply,
  whatsApp,
  className,
}: Props) {
  // Both WhatsApp modes are external click-to-chat; neither is offered once the
  // workspace no longer allows that mode.
  const { canOpenExternally } = useWhatsAppCapabilities();
  const modes: { id: string; label: string; icon: typeof StickyNote }[] = [
    ...(canAddNote ? [{ id: "note", label: "Note", icon: StickyNote }] : []),
    ...(reply ? [{ id: "reply", label: reply.label, icon: Mail }] : []),
    ...(call ? [{ id: "call", label: "Call", icon: Phone }] : []),
    ...(followUp ? [{ id: "email", label: "Email", icon: Mail }] : []),
    ...((followUp || whatsApp) && canOpenExternally
      ? [{ id: "whatsapp", label: "WhatsApp", icon: MessageCircle }]
      : []),
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
        ) : activeMode === "call" && call ? (
          <CallMode moduleKey={moduleKey} entityId={entityId} config={call} />
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
        query: mentionQuery ?? "",
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
        queryKey: [recordActivityQueryKeyPrefix, moduleKey, String(entityId)],
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
  // WhatsApp opens only for a number it can dial. A national number is still logged —
  // the operator may have messaged from their phone — but the chat is not opened onto
  // WhatsApp's "invalid number" screen.
  const chat = channel === "whatsapp" && target ? whatsAppChatTarget(target) : null;

  async function logFollowUp() {
    if (logging) return;
    // Before the first await, or the browser may block it (`lib/whatsapp.ts`).
    const pendingChat = chat?.ok ? openPendingWhatsAppWindow() : null;
    let logged = false;
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
      logged = true;
      if (channel === "email" && config.email) window.location.href = `mailto:${config.email}`;
      if (pendingChat && chat?.ok) pendingChat.go(whatsAppChatUrl(chat.digits));
      setNote("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [recordActivityQueryKeyPrefix, moduleKey, String(entityId)] }),
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
      // Logged already: the chat is open and the row exists, so a failed refresh is not
      // a failed log.
      if (logged) return;
      pendingChat?.cancel();
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
        ) : chat && !chat.ok ? (
          <p className="text-p-xs text-copy-muted">
            {WHATSAPP_NUMBER_MESSAGES[chat.reason]} Logging still records the follow-up.
          </p>
        ) : null}
        <Button type="button" size="sm" disabled={logging || !target} onClick={() => void logFollowUp()}>
          {logging ? "Logging…" : `Log ${CHANNEL_LABELS[channel].toLocaleLowerCase()}`}
        </Button>
      </div>
    </div>
  );
}

const NOT_LISTED = "not-listed";
// The server allows five minutes of clock skew; the form is stricter than that only by
// not offering it.
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const MAX_DURATION_MINUTES = 1440;

/**
 * Call mode — the call log (07-telephony.md Phase 1).
 *
 * It records a call that already happened; it does not place one. That is the change from
 * the Call follow-up it replaces, which wrote its row *before* opening `tel:` and so logged
 * every call as made, with no outcome, whether or not anyone picked up. Dialling is now its
 * own link, and logging asks what the operator knows: direction, outcome, when, how long.
 *
 * On a deal or a quote the call names who was on the line, so it lands on that person's
 * Timeline too. One candidate is preselected; several are left for the operator to choose,
 * as the deal's Email does — the primary contact is never picked silently (§4.7).
 */
function CallMode({
  moduleKey,
  entityId,
  config,
}: {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  config: CallConfig;
}) {
  const queryClient = useQueryClient();
  const people = config.people ?? [];
  const [personId, setPersonId] = useState(people.length === 1 ? String(people[0].contactId) : "");
  const [direction, setDirection] = useState<CallDirection>("outbound");
  const [outcome, setOutcome] = useState<CallOutcome | "">("");
  const [occurredAt, setOccurredAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [note, setNote] = useState("");
  const [createReminder, setCreateReminder] = useState(true);
  const [dueAt, setDueAt] = useState("");
  const [logging, setLogging] = useState(false);
  const fieldId = `record-call-${moduleKey}-${entityId}`;
  const shouldCreateReminder = Boolean(config.canCreateTask) && createReminder;

  const person = people.find((item) => String(item.contactId) === personId) ?? null;
  const dialHref = telHref(people.length ? person?.phone : config.phone);
  const dialNumber = people.length ? person?.phone : config.phone;

  const needsPerson = people.length > 0 && !personId;
  const when = occurredAt ? new Date(occurredAt) : null;
  const whenError =
    when && (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + FUTURE_TOLERANCE_MS)
      ? "A call cannot be logged in the future."
      : null;
  const minutes = durationMinutes.trim() ? Number(durationMinutes) : null;
  const durationError =
    minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_DURATION_MINUTES)
      ? `Enter whole minutes, from 0 to ${MAX_DURATION_MINUTES}.`
      : null;
  const blocked = logging || !outcome || needsPerson || Boolean(whenError || durationError);

  function reset() {
    setDirection("outbound");
    setOutcome("");
    setOccurredAt("");
    setDurationMinutes("");
    setNote("");
    setDueAt("");
    if (people.length !== 1) setPersonId("");
  }

  async function logCall() {
    if (blocked) return;
    let logged = false;
    try {
      setLogging(true);
      const res = await apiFetch(callLogEndpoint(moduleKey, entityId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction,
          outcome,
          occurred_at: toIsoOrNull(occurredAt),
          duration_seconds: minutes === null ? null : minutes * 60,
          note: note.trim() || null,
          contact_id: person ? person.contactId : null,
          create_follow_up_task: shouldCreateReminder,
          follow_up_due_at: shouldCreateReminder ? toIsoOrNull(dueAt) : null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // A refusal names its cause (not on this deal, no task access, in the future); a
        // server fault does not, and gets the generic line.
        throw new Error(res.status < 500 && typeof body?.detail === "string" ? body.detail : "");
      }
      logged = true;
      reset();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [recordActivityQueryKeyPrefix, moduleKey, String(entityId)] }),
        ...(person
          ? [queryClient.invalidateQueries({ queryKey: [recordActivityQueryKeyPrefix, "sales_contacts", String(person.contactId)] })]
          : []),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["record-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["user-notifications"] }),
      ]);
      toast.success(body?.follow_up_task_id ? "Call logged and reminder created." : "Call logged.");
      await config.onLogged?.();
    } catch (error) {
      // Logged already: a failed refresh is not a failed log, and the form was cleared.
      if (logged) return;
      const detail = error instanceof Error && error.message ? `${error.message}` : "Try again.";
      toast.error(`The call could not be logged. ${detail}`);
    } finally {
      setLogging(false);
    }
  }

  return (
    <div className="grid gap-3">
      {people.length ? (
        <Field>
          <FieldLabel htmlFor={`${fieldId}-person`}>Who was on the call</FieldLabel>
          <Select value={personId} onValueChange={setPersonId}>
            <SelectTrigger id={`${fieldId}-person`}>
              <SelectValue placeholder="Choose a person" />
            </SelectTrigger>
            <SelectContent>
              {people.map((item) => (
                <SelectItem key={item.contactId} value={String(item.contactId)}>
                  {item.roleLabel ? `${item.name} · ${item.roleLabel}` : item.name}
                </SelectItem>
              ))}
              <SelectItem value={NOT_LISTED}>Someone not listed</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>
            The call is also added to that person&apos;s timeline.
          </FieldDescription>
        </Field>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={direction}
          onValueChange={(value) => setDirection(value as CallDirection)}
          aria-label="Call direction"
        >
          <SegmentedItem value="outbound">Outbound</SegmentedItem>
          <SegmentedItem value="inbound">Inbound</SegmentedItem>
        </SegmentedControl>
        {dialHref ? (
          <Button asChild variant="outline" size="sm">
            <a href={dialHref}>
              <Phone />
              Call {dialNumber}
            </a>
          </Button>
        ) : null}
      </div>

      <Field>
        <FieldLabel htmlFor={`${fieldId}-outcome`}>Outcome</FieldLabel>
        <Select value={outcome} onValueChange={(value) => setOutcome(value as CallOutcome)}>
          <SelectTrigger id={`${fieldId}-outcome`}>
            <SelectValue placeholder="Choose an outcome" />
          </SelectTrigger>
          <SelectContent>
            {CALL_OUTCOMES.map((value) => (
              <SelectItem key={value} value={value}>
                {CALL_OUTCOME_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${fieldId}-when`}>When</FieldLabel>
          <Input
            id={`${fieldId}-when`}
            type="datetime-local"
            value={occurredAt}
            onChange={(event) => setOccurredAt(event.target.value)}
            aria-invalid={Boolean(whenError)}
            aria-describedby={`${fieldId}-when-help`}
          />
          <FieldDescription id={`${fieldId}-when-help`}>
            {whenError ? (
              <span role="alert" className="text-state-danger">{whenError}</span>
            ) : (
              "Leave blank for just now."
            )}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${fieldId}-duration`}>Duration in minutes</FieldLabel>
          <Input
            id={`${fieldId}-duration`}
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_DURATION_MINUTES}
            step={1}
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
            aria-invalid={Boolean(durationError)}
            aria-describedby={`${fieldId}-duration-help`}
          />
          <FieldDescription id={`${fieldId}-duration-help`}>
            {durationError ? (
              <span role="alert" className="text-state-danger">{durationError}</span>
            ) : (
              "Optional."
            )}
          </FieldDescription>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor={`${fieldId}-note`}>Call note</FieldLabel>
        <Textarea
          id={`${fieldId}-note`}
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What was discussed, and what happens next."
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
      <div className="flex flex-wrap items-center justify-end gap-3">
        {needsPerson ? (
          <p className="text-p-xs text-copy-muted">Choose who was on the call.</p>
        ) : !outcome ? (
          <p className="text-p-xs text-copy-muted">Choose an outcome to log the call.</p>
        ) : null}
        <Button type="button" size="sm" disabled={blocked} onClick={() => void logCall()}>
          {logging ? "Logging…" : "Log call"}
        </Button>
      </div>
      <p className="text-p-xs text-copy-muted">
        This records the call you describe. Lynk does not place, time or record calls.
      </p>
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
 * the server returns (`openPendingWhatsAppWindow`). The server builds that URL because it
 * can add the workspace country to a national number; the untracked paths cannot.
 *
 * External mode: the operator sends the message in WhatsApp. What this records, and what
 * the feed shows, is that the chat was prepared and opened — never that it was sent.
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
    const pending = openPendingWhatsAppWindow();
    let opened = false;

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
      if (!res.ok || !body?.whatsapp_url) {
        // A refusal names its cause (no phone, no country code, no template, no task
        // access); a server fault does not, and gets the generic line.
        throw new Error(res.status < 500 && typeof body?.detail === "string" ? body.detail : "");
      }
      pending.go(body.whatsapp_url);
      opened = true;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [recordActivityQueryKeyPrefix, moduleKey, String(entityId)] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["record-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["user-notifications"] }),
      ]);
      toast.success(
        body.follow_up_task ? "WhatsApp chat opened and reminder created." : "WhatsApp chat opened.",
      );
      await config.onLogged?.();
    } catch (error) {
      // Once the chat is open, a failed refresh must not close it or report it unopened.
      if (opened) return;
      pending.cancel();
      const detail = error instanceof Error && error.message ? `${error.message}.` : "Check the phone number and try again.";
      toast.error(`WhatsApp chat could not be started. ${detail}`);
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
        You send the message in WhatsApp. Lynk records that the chat was opened, not whether
        it was sent, delivered or read.
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
        queryKey: [recordActivityQueryKeyPrefix, moduleKey, String(entityId)],
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
