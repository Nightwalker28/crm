"use client";

import { useState } from "react";

import CalendarParticipantPicker from "@/components/calendar/CalendarParticipantPicker";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  CalendarAssignmentTeamOption,
  CalendarAssignmentUserOption,
  CalendarEvent,
  CalendarEventPayload,
} from "@/hooks/useCalendar";

type Props = {
  open: boolean;
  event: CalendarEvent | null;
  draftStartAt: string;
  draftEndAt: string;
  users: CalendarAssignmentUserOption[];
  teams: CalendarAssignmentTeamOption[];
  isSubmitting?: boolean;
  isDeleting?: boolean;
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
  onClose,
  onSubmit,
  onDelete,
}: Props) {
  const [form, setForm] = useState<CalendarEventPayload>(() => buildInitialState(event, draftStartAt, draftEndAt));
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    try {
      setError(null);
      const startAt = toIsoOrNull(toDatetimeLocalValue(form.start_at));
      const endAt = toIsoOrNull(toDatetimeLocalValue(form.end_at));
      if (!startAt || !endAt) {
        throw new Error("Start and end time are required.");
      }
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
    if (!window.confirm(`Move "${event.title}" to the recycle bin?`)) return;
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
        <DialogPanel size="3xl">
          <DialogHeader>
            <DialogTitle>{event ? "Edit Event" : "Create Event"}</DialogTitle>
            <DialogIconClose />
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error ? (
              <div className="rounded-md border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <Field className="md:col-span-2">
                <FieldLabel>Event Title</FieldLabel>
                <Input
                  value={form.title}
                  onChange={(nextEvent) => setForm((current) => ({ ...current, title: nextEvent.target.value }))}
                  placeholder="Join weekly customer kickoff"
                />
              </Field>

              <Field className="md:col-span-2">
                <FieldLabel>Description</FieldLabel>
                <Textarea
                  rows={4}
                  value={form.description ?? ""}
                  onChange={(nextEvent) => setForm((current) => ({ ...current, description: nextEvent.target.value }))}
                  placeholder="Agenda, prep notes, handoff details, or CRM context."
                />
              </Field>

              <Field>
                <FieldLabel>Start</FieldLabel>
                <Input
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
                <FieldLabel>End</FieldLabel>
                <Input
                  type="datetime-local"
                  value={toDatetimeLocalValue(form.end_at)}
                  onChange={(nextEvent) =>
                    setForm((current) => ({
                      ...current,
                      end_at: toIsoOrNull(nextEvent.target.value) || current.end_at,
                    }))
                  }
                />
              </Field>

              <Field>
                <FieldLabel>Location</FieldLabel>
                <Input
                  value={form.location ?? ""}
                  onChange={(nextEvent) => setForm((current) => ({ ...current, location: nextEvent.target.value }))}
                  placeholder="Boardroom A / Customer HQ"
                />
              </Field>

              <Field>
                <FieldLabel>Meeting Link</FieldLabel>
                <Input
                  value={form.meeting_url ?? ""}
                  onChange={(nextEvent) => setForm((current) => ({ ...current, meeting_url: nextEvent.target.value }))}
                  placeholder="https://meet.google.com/..."
                />
              </Field>
            </FieldGroup>

            <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-neutral-100">Participants</div>
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
          </div>

          <DialogFooter className="mt-6">
            {event && onDelete ? (
              <Button
                type="button"
                variant="outline"
                className="mr-auto border-red-800/70 text-red-200 hover:bg-red-950/40 hover:text-red-100"
                onClick={() => void handleDelete()}
                disabled={isSubmitting || isDeleting}
              >
                Move To Recycle Bin
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || isDeleting || !form.title.trim()}>
              {event ? "Save Event" : "Create Event"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
