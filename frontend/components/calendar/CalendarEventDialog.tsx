"use client";

import { useEffect, useMemo, useState } from "react";

import CalendarParticipantPicker from "@/components/calendar/CalendarParticipantPicker";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch, SwitchThumb } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
  CalendarAssignmentTeamOption,
  CalendarAssignmentUserOption,
  CalendarEvent,
  CalendarEventPayload,
} from "@/hooks/useCalendar";
import { useConfirm } from "@/hooks/useConfirm";

type Props = {
  open: boolean;
  event: CalendarEvent | null;
  draftStartAt: string;
  draftEndAt: string;
  users: CalendarAssignmentUserOption[];
  teams: CalendarAssignmentTeamOption[];
  isSubmitting?: boolean;
  isDeleting?: boolean;
  canManage?: boolean;
  onClose: () => void;
  onSubmit: (payload: CalendarEventPayload) => Promise<void>;
  onDelete?: () => Promise<void>;
};

function toDatetimeLocalValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIsoOrNull(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function calendarTimeRangeInvalid(form: CalendarEventPayload) {
  const startAt = toIsoOrNull(toDatetimeLocalValue(form.start_at));
  const endAt = toIsoOrNull(toDatetimeLocalValue(form.end_at));
  return Boolean(startAt && endAt && new Date(endAt).getTime() <= new Date(startAt).getTime());
}

function validateCalendarEventForm(form: CalendarEventPayload) {
  if (!form.title.trim()) return "Event title is required.";
  const startAt = toIsoOrNull(toDatetimeLocalValue(form.start_at));
  const endAt = toIsoOrNull(toDatetimeLocalValue(form.end_at));
  if (!startAt || !endAt) return "Start and end time are required.";
  if (calendarTimeRangeInvalid(form)) return "End time must be after the start time.";
  return null;
}

function buildInitialState(event: CalendarEvent | null, draftStartAt: string, draftEndAt: string): CalendarEventPayload {
  if (!event) {
    return {
      title: "",
      description: "",
      start_at: draftStartAt,
      end_at: draftEndAt,
      is_all_day: false,
      location: "",
      meeting_url: "",
      participants: [],
      source_module_key: null,
      source_entity_id: null,
      source_label: null,
    };
  }

  return {
    title: event.title,
    description: event.description ?? "",
    start_at: event.start_at,
    end_at: event.end_at,
    is_all_day: event.is_all_day,
    location: event.location ?? "",
    meeting_url: event.meeting_url ?? "",
    participants: event.participants
      .filter((participant) => !participant.is_owner)
      .map((participant) => ({
        participant_type: participant.participant_type,
        user_id: participant.user_id ?? null,
        team_id: participant.team_id ?? null,
      })),
    source_module_key: event.source_module_key ?? null,
    source_entity_id: event.source_entity_id ?? null,
    source_label: event.source_label ?? null,
  };
}

export default function CalendarEventDialog({
  open,
  event,
  draftStartAt,
  draftEndAt,
  users,
  teams,
  isSubmitting = false,
  isDeleting = false,
  canManage = true,
  onClose,
  onSubmit,
  onDelete,
}: Props) {
  const { confirm } = useConfirm();
  const [form, setForm] = useState<CalendarEventPayload>(() => buildInitialState(event, draftStartAt, draftEndAt));
  const [error, setError] = useState<string | null>(null);
  const validationError = useMemo(() => validateCalendarEventForm(form), [form]);
  const canSubmit = !validationError;

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(buildInitialState(event, draftStartAt, draftEndAt));
      setError(null);
    }
  }, [open, event, draftStartAt, draftEndAt]);

  async function handleSubmit() {
    try {
      setError(null);
      const nextValidationError = validateCalendarEventForm(form);
      if (nextValidationError) {
        setError(nextValidationError);
        return;
      }
      const startAt = toIsoOrNull(toDatetimeLocalValue(form.start_at));
      const endAt = toIsoOrNull(toDatetimeLocalValue(form.end_at));
      if (!startAt || !endAt) return;
      await onSubmit({
        ...form,
        title: form.title.trim(),
        description: form.description?.trim() || null,
        location: form.location?.trim() || null,
        meeting_url: form.meeting_url?.trim() || null,
        start_at: startAt,
        end_at: endAt,
      });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save calendar event");
    }
  }

  async function handleDelete() {
    if (!event || !onDelete) return;
    const confirmed = await confirm({
      title: "Delete event?",
      description: `Delete "${event.title}"?`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      setError(null);
      await onDelete();
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete calendar event");
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel size="3xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{event ? (canManage ? "Edit Event" : "Event details") : "Create Event"}</DialogTitle>
            <DialogIconClose />
          </DialogHeader>

          <fieldset disabled={!canManage} className="mt-4 space-y-4 disabled:opacity-80">
            {!canManage ? (
              <div className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-3 text-sm text-copy-secondary">
                Only the event owner can change or delete this event.
              </div>
            ) : null}
            {error ? (
              <div role="alert" className="rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
                {error}
              </div>
            ) : null}

            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <Field className="md:col-span-2">
                <FieldLabel htmlFor="calendar-event-title">Event title <RequiredMark /></FieldLabel>
                <Input
                  id="calendar-event-title"
                  value={form.title}
                  onChange={(nextEvent) => setForm((current) => ({ ...current, title: nextEvent.target.value }))}
                  placeholder="Join weekly customer kickoff"
                />
              </Field>

              <Field className="md:col-span-2">
                <FieldLabel htmlFor="calendar-event-description">Description</FieldLabel>
                <Textarea
                  id="calendar-event-description"
                  rows={4}
                  value={form.description ?? ""}
                  onChange={(nextEvent) => setForm((current) => ({ ...current, description: nextEvent.target.value }))}
                  placeholder="Agenda, prep notes, handoff details, or CRM context."
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="calendar-event-start">Start <RequiredMark /></FieldLabel>
                <Input
                  id="calendar-event-start"
                  type="datetime-local"
                  value={toDatetimeLocalValue(form.start_at)}
                  onChange={(nextEvent) =>
                    setForm((current) => ({
                      ...current,
                      start_at: toIsoOrNull(nextEvent.target.value) || current.start_at,
                    }))
                  }
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="calendar-event-end">End <RequiredMark /></FieldLabel>
                <Input
                  id="calendar-event-end"
                  type="datetime-local"
                  value={toDatetimeLocalValue(form.end_at)}
                  onChange={(nextEvent) =>
                    setForm((current) => ({
                      ...current,
                      end_at: toIsoOrNull(nextEvent.target.value) || current.end_at,
                    }))
                  }
                />
                {calendarTimeRangeInvalid(form) ? (
                  <FieldError>End time must be after the start time.</FieldError>
                ) : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="calendar-event-location">Location</FieldLabel>
                <Input
                  id="calendar-event-location"
                  value={form.location ?? ""}
                  onChange={(nextEvent) => setForm((current) => ({ ...current, location: nextEvent.target.value }))}
                  placeholder="Boardroom A / Customer HQ"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="calendar-event-link">Meeting link</FieldLabel>
                <Input
                  id="calendar-event-link"
                  value={form.meeting_url ?? ""}
                  onChange={(nextEvent) => setForm((current) => ({ ...current, meeting_url: nextEvent.target.value }))}
                  placeholder="https://meet.google.com/..."
                />
              </Field>

              <Field className="md:col-span-2">
                <div className="flex min-h-10 items-center justify-between gap-4 rounded-[var(--radius-control)] border border-line-subtle bg-surface-muted px-3 py-2">
                  <div>
                    <FieldLabel htmlFor="calendar-all-day">All-day event</FieldLabel>
                    <FieldDescription>Show this event without a specific meeting time.</FieldDescription>
                  </div>
                  <Switch
                    id="calendar-all-day"
                    checked={form.is_all_day}
                    onCheckedChange={(checked) => setForm((current) => ({ ...current, is_all_day: checked }))}
                    aria-label="All-day event"
                    className="relative h-6 w-11 shrink-0 rounded-full border border-line-control bg-surface data-[state=checked]:bg-primary"
                  >
                    <SwitchThumb className="block h-5 w-5 rounded-full bg-copy-primary data-[state=checked]:translate-x-5" />
                  </Switch>
                </div>
              </Field>
            </FieldGroup>

            <div className="border-t border-line-subtle pt-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-copy-primary">Participants</div>
                  <FieldDescription>
                    Invite users who should accept or decline, and share with teams that should see the event internally.
                  </FieldDescription>
                </div>
              </div>
              <div className="mt-4">
                <CalendarParticipantPicker
                  users={users}
                  teams={teams}
                  value={form.participants}
                  onChange={(participants) => setForm((current) => ({ ...current, participants }))}
                  disabled={isSubmitting || isDeleting}
                />
              </div>
            </div>
          </fieldset>

          <DialogFooter className="mt-6">
            {event && onDelete && canManage ? (
              <Button
                type="button"
                variant="destructiveOutline"
                className="mr-auto"
                onClick={() => void handleDelete()}
                disabled={isSubmitting || isDeleting}
              >
                Move To Recycle Bin
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {canManage ? (
              <Button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || isDeleting || !canSubmit}>
                {event ? "Save Event" : "Create Event"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
