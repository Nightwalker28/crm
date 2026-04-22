"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export type CalendarParticipantType = "user" | "team";
export type CalendarParticipantStatus = "pending" | "accepted" | "declined" | "shared";
export type CalendarProvider = "google" | "microsoft";

export type CalendarParticipantInput = {
  participant_type: CalendarParticipantType;
  user_id?: number | null;
  team_id?: number | null;
};

export type CalendarParticipant = {
  participant_type: CalendarParticipantType;
  participant_key: string;
  user_id?: number | null;
  team_id?: number | null;
  response_status: CalendarParticipantStatus;
  is_owner: boolean;
  label: string;
};

export type CalendarEvent = {
  id: number;
  title: string;
  description?: string | null;
  start_at: string;
  end_at: string;
  is_all_day: boolean;
  location?: string | null;
  meeting_url?: string | null;
  status: string;
  owner_user_id: number;
  owner_name?: string | null;
  source_module_key?: string | null;
  source_entity_id?: string | null;
  source_label?: string | null;
  current_user_response?: CalendarParticipantStatus | null;
  participants: CalendarParticipant[];
  created_at: string;
  updated_at: string;
};

export type CalendarConnectionSummary = {
  provider: CalendarProvider;
  status: "connected" | "disconnected" | "error";
  account_email?: string | null;
  provider_calendar_id?: string | null;
  provider_calendar_name?: string | null;
  sync_enabled_for_current_session: boolean;
  last_synced_at?: string | null;
  last_error?: string | null;
};

export type CalendarAssignmentUserOption = {
  id: number;
  name: string;
  email?: string | null;
  team_id?: number | null;
  team_name?: string | null;
};

export type CalendarAssignmentTeamOption = {
  id: number;
  name: string;
  department_id?: number | null;
};

export type CalendarContext = {
  users: CalendarAssignmentUserOption[];
  teams: CalendarAssignmentTeamOption[];
  connections: CalendarConnectionSummary[];
  pending_invite_count: number;
};

export type CalendarEventPayload = {
  title: string;
  description?: string | null;
  start_at: string;
  end_at: string;
  is_all_day: boolean;
  location?: string | null;
  meeting_url?: string | null;
  participants: CalendarParticipantInput[];
  source_module_key?: string | null;
  source_entity_id?: string | null;
  source_label?: string | null;
};

type CalendarEventListResponse = {
  results: CalendarEvent[];
};

type CalendarTaskCreateResponse = {
  event: CalendarEvent;
  created_from_task_id: number;
  reused_existing: boolean;
};

type CalendarTaskEventResponse = {
  event: CalendarEvent | null;
  task_id: number;
};

export type CalendarSyncResponse = {
  provider: CalendarProvider;
  synced_event_count: number;
  provider_calendar_id?: string | null;
  provider_calendar_name?: string | null;
  last_synced_at?: string | null;
  status: "connected" | "disconnected" | "error";
  last_error?: string | null;
};

async function readJsonSafely(res: Response) {
  return res.json().catch(() => null);
}

export async function fetchCalendarContext() {
  const res = await apiFetch("/calendar/context");
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load calendar context.");
  }
  return body as CalendarContext;
}

export async function fetchCalendarEvents(startAt: string, endAt: string) {
  const params = new URLSearchParams({
    start_at: startAt,
    end_at: endAt,
    include_pending: "true",
  });
  const res = await apiFetch(`/calendar/events?${params.toString()}`);
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load calendar events.");
  }
  return body as CalendarEventListResponse;
}

export async function fetchCalendarEvent(eventId: number) {
  const res = await apiFetch(`/calendar/events/${eventId}`);
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load calendar event.");
  }
  return body as CalendarEvent;
}

async function createCalendarEvent(payload: CalendarEventPayload) {
  const res = await apiFetch("/calendar/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to create calendar event.");
  }
  return body as CalendarEvent;
}

async function updateCalendarEvent(eventId: number, payload: CalendarEventPayload) {
  const res = await apiFetch(`/calendar/events/${eventId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to update calendar event.");
  }
  return body as CalendarEvent;
}

async function respondToInvite(eventId: number, responseStatus: "accepted" | "declined") {
  const res = await apiFetch(`/calendar/events/${eventId}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_status: responseStatus }),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to update invite response.");
  }
  return body as CalendarEvent;
}

async function deleteCalendarEvent(eventId: number) {
  const res = await apiFetch(`/calendar/events/${eventId}`, {
    method: "DELETE",
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to delete calendar event.");
  }
}

async function createEventFromTask(taskId: number) {
  const res = await apiFetch(`/calendar/events/from-task/${taskId}`, {
    method: "POST",
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to create calendar event from task.");
  }
  return body as CalendarTaskCreateResponse;
}

export async function fetchTaskCalendarEvent(taskId: number) {
  const res = await apiFetch(`/calendar/events/from-task/${taskId}`);
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load task calendar event.");
  }
  return body as CalendarTaskEventResponse;
}

async function deleteTaskCalendarEvent(taskId: number) {
  const res = await apiFetch(`/calendar/events/from-task/${taskId}`, {
    method: "DELETE",
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to remove task calendar event.");
  }
  return body as CalendarTaskEventResponse;
}

async function syncCalendar() {
  const res = await apiFetch("/calendar/sync", {
    method: "POST",
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to sync calendar.");
  }
  return body as CalendarSyncResponse;
}

export function useCalendarContext() {
  return useQuery({
    queryKey: ["calendar-context"],
    queryFn: fetchCalendarContext,
    staleTime: 5 * 60_000,
  });
}

export function useCalendarEvents(startAt?: string, endAt?: string) {
  return useQuery({
    queryKey: ["calendar-events", startAt, endAt],
    queryFn: () => fetchCalendarEvents(startAt as string, endAt as string),
    enabled: Boolean(startAt && endAt),
    staleTime: 30_000,
  });
}

export function useCalendarActions() {
  const queryClient = useQueryClient();

  const invalidateCalendar = async () => {
    await queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
    await queryClient.invalidateQueries({ queryKey: ["calendar-context"] });
    await queryClient.invalidateQueries({ queryKey: ["user-notifications"] });
    await queryClient.invalidateQueries({ queryKey: ["recycle-bin"] });
  };

  const createMutation = useMutation({
    mutationFn: createCalendarEvent,
    onSuccess: invalidateCalendar,
  });

  const updateMutation = useMutation({
    mutationFn: ({ eventId, payload }: { eventId: number; payload: CalendarEventPayload }) =>
      updateCalendarEvent(eventId, payload),
    onSuccess: async (_, variables) => {
      await invalidateCalendar();
      await queryClient.invalidateQueries({ queryKey: ["calendar-event", variables.eventId] });
    },
  });

  const respondMutation = useMutation({
    mutationFn: ({ eventId, responseStatus }: { eventId: number; responseStatus: "accepted" | "declined" }) =>
      respondToInvite(eventId, responseStatus),
    onSuccess: async (_, variables) => {
      await invalidateCalendar();
      await queryClient.invalidateQueries({ queryKey: ["calendar-event", variables.eventId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCalendarEvent,
    onSuccess: async (_, eventId) => {
      await invalidateCalendar();
      await queryClient.invalidateQueries({ queryKey: ["calendar-event", eventId] });
    },
  });

  const createFromTaskMutation = useMutation({
    mutationFn: createEventFromTask,
    onSuccess: async (result) => {
      await invalidateCalendar();
      await queryClient.invalidateQueries({ queryKey: ["task-calendar-event", result.created_from_task_id] });
    },
  });

  const deleteFromTaskMutation = useMutation({
    mutationFn: deleteTaskCalendarEvent,
    onSuccess: async (_, taskId) => {
      await invalidateCalendar();
      await queryClient.invalidateQueries({ queryKey: ["task-calendar-event", taskId] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: syncCalendar,
    onSuccess: invalidateCalendar,
  });

  return {
    createEvent: createMutation.mutateAsync,
    updateEvent: (eventId: number, payload: CalendarEventPayload) =>
      updateMutation.mutateAsync({ eventId, payload }),
    respondToInvite: (eventId: number, responseStatus: "accepted" | "declined") =>
      respondMutation.mutateAsync({ eventId, responseStatus }),
    deleteEvent: deleteMutation.mutateAsync,
    createEventFromTask: createFromTaskMutation.mutateAsync,
    deleteTaskCalendarEvent: deleteFromTaskMutation.mutateAsync,
    syncCalendar: syncMutation.mutateAsync,
    isSaving: createMutation.isPending || updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isResponding: respondMutation.isPending,
    isCreatingFromTask: createFromTaskMutation.isPending,
    isRemovingTaskCalendarEvent: deleteFromTaskMutation.isPending,
    isSyncingCalendar: syncMutation.isPending,
  };
}
