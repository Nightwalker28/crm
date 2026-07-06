"use client";

import type { KeyboardEvent } from "react";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, PlugZap, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import CalendarEventDialog from "@/components/calendar/CalendarEventDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import {
  fetchCalendarEvent,
  useCalendarActions,
  useCalendarContext,
  useCalendarEvents,
  type CalendarConnectionSummary,
  type CalendarEvent,
  type CalendarEventPayload,
  type CalendarSyncJob,
} from "@/hooks/useCalendar";
import { useJobPoller } from "@/hooks/useJobPoller";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function endOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0);
}

function startOfGrid(value: Date) {
  const first = startOfMonth(value);
  return new Date(first.getFullYear(), first.getMonth(), first.getDate() - first.getDay());
}

function endOfGrid(value: Date) {
  const last = endOfMonth(value);
  return new Date(last.getFullYear(), last.getMonth(), last.getDate() + (6 - last.getDay()), 23, 59, 59, 999);
}

function formatIso(date: Date) {
  return date.toISOString();
}

function buildDayTime(day: Date, hour: number) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0).toISOString();
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getEventTone(event: CalendarEvent) {
  if (event.current_user_response === "pending") return "border-amber-800/70 bg-amber-950/30 text-amber-100";
  if (event.current_user_response === "shared") return "border-sky-800/70 bg-sky-950/30 text-sky-100";
  if (event.current_user_response === "declined") return "border-neutral-800 bg-neutral-950/40 text-neutral-500";
  return "border-neutral-800 bg-neutral-900/70 text-neutral-100";
}

function providerLabel(provider: CalendarConnectionSummary["provider"]) {
  return provider === "microsoft" ? "Microsoft" : "Google";
}

function connectionStatusLabel(connection: CalendarConnectionSummary) {
  if (connection.health_status === "healthy") return "Ready";
  if (connection.health_status === "session_provider_mismatch") return "Connected, sign-in mismatch";
  if (connection.health_status === "warning") return "Needs attention";
  if (connection.health_status === "error") return "Sync error";
  if (connection.health_status === "reconnect_required") return "Reconnect required";
  return connection.status.replaceAll("_", " ");
}

function connectionStatusTone(connection: CalendarConnectionSummary) {
  if (connection.health_status === "healthy") return "border-emerald-800/70 bg-emerald-950/20 text-emerald-200";
  if (connection.health_status === "warning" || connection.health_status === "session_provider_mismatch") {
    return "border-amber-800/70 bg-amber-950/20 text-amber-200";
  }
  return "border-red-800/70 bg-red-950/20 text-red-200";
}

function isActivationKey(event: KeyboardEvent) {
  return event.key === "Enter" || event.key === " ";
}

function syncJobLabel(job: CalendarSyncJob) {
  if (job.status === "completed") {
    const syncedCount = typeof job.summary?.synced_event_count === "number" ? job.summary.synced_event_count : null;
    return syncedCount === null ? "Completed" : `Synced ${syncedCount} event${syncedCount === 1 ? "" : "s"}`;
  }
  if (job.status === "failed") return job.error_message || "Failed";
  if (job.progress_message) return job.progress_message;
  return job.status;
}

export default function CalendarPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const eventIdParam = searchParams.get("eventId");
  const eventId = eventIdParam && /^\d+$/.test(eventIdParam) ? Number(eventIdParam) : null;

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [draftStartAt, setDraftStartAt] = useState(() => buildDayTime(new Date(), 9));
  const [draftEndAt, setDraftEndAt] = useState(() => buildDayTime(new Date(), 10));
  const [syncJobId, setSyncJobId] = useState<number | null>(null);

  const contextQuery = useCalendarContext();
  const rangeStart = useMemo(() => formatIso(startOfGrid(month)), [month]);
  const rangeEnd = useMemo(() => formatIso(endOfGrid(month)), [month]);
  const eventsQuery = useCalendarEvents(rangeStart, rangeEnd);
  const events = useMemo(() => eventsQuery.data?.results ?? [], [eventsQuery.data?.results]);
  const {
    createEvent,
    updateEvent,
    deleteEvent,
    respondToInvite,
    syncCalendar,
    isSaving,
    isDeleting,
    isResponding,
    isSyncingCalendar,
  } = useCalendarActions();
  const syncJob = useJobPoller<Record<string, unknown>>(
    syncJobId,
    (job) => {
      setSyncJobId(null);
      void queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      void queryClient.invalidateQueries({ queryKey: ["calendar-context"] });
      const syncedCount = typeof job.summary?.synced_event_count === "number" ? job.summary.synced_event_count : null;
      toast.success(
        syncedCount === null
          ? "Calendar sync completed."
          : `Synced ${syncedCount} event${syncedCount === 1 ? "" : "s"}.`,
      );
    },
    { failureMessage: "Calendar sync failed." },
  );

  const eventDetailQuery = useQuery({
    queryKey: ["calendar-event", eventId],
    queryFn: () => fetchCalendarEvent(eventId as number),
    enabled: Boolean(eventId),
    placeholderData: () => events.find((event) => event.id === eventId),
    staleTime: 30_000,
  });

  const activeEvent = eventId ? (eventDetailQuery.data ?? selectedEvent) : selectedEvent;
  const isDialogOpen = eventId ? Boolean(activeEvent) : dialogOpen;

  const calendarDays = useMemo(() => {
    const first = startOfGrid(month);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(first);
      date.setDate(first.getDate() + index);
      return date;
    });
  }, [month]);

  const eventsByDay = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = dayKey(event.start_at);
      const existing = grouped.get(key) ?? [];
      existing.push(event);
      grouped.set(key, existing);
    }
    return grouped;
  }, [events]);
  const pendingInvites = useMemo(() => events.filter((event) => event.current_user_response === "pending"), [events]);
  const hasActiveSyncConnection = Boolean(
    contextQuery.data?.connections.some((connection) => connection.sync_enabled_for_current_session),
  );
  const isCalendarSyncActive = isSyncingCalendar || syncJob.status === "queued" || syncJob.status === "running";
  const selectedDayEvents = useMemo(
    () => (eventsByDay.get(dayKey(selectedDay)) ?? []).filter((event) => event.current_user_response !== "pending"),
    [eventsByDay, selectedDay],
  );

  function openCreateDialog(day: Date) {
    setSelectedEvent(null);
    setDraftStartAt(buildDayTime(day, 9));
    setDraftEndAt(buildDayTime(day, 10));
    setDialogOpen(true);
    router.replace("/dashboard/calendar");
  }

  function openEditDialog(event: CalendarEvent) {
    setSelectedEvent(event);
    setDialogOpen(true);
    router.replace(`/dashboard/calendar?eventId=${event.id}`);
  }

  function closeDialog() {
    setDialogOpen(false);
    setSelectedEvent(null);
    router.replace("/dashboard/calendar");
  }

  async function handleSubmit(payload: CalendarEventPayload) {
    if (activeEvent) {
      await updateEvent(activeEvent.id, payload);
      toast.success("Calendar event updated.");
      return;
    }
    await createEvent(payload);
    toast.success("Calendar event created.");
  }

  async function handleDelete() {
    if (!activeEvent) return;
    await deleteEvent(activeEvent.id);
    toast.success("Calendar event moved to the recycle bin.");
  }

  async function handleInviteResponse(event: CalendarEvent, responseStatus: "accepted" | "declined") {
    await respondToInvite(event.id, responseStatus);
    toast.success(responseStatus === "accepted" ? "Invite accepted." : "Invite declined.");
  }

  async function handleManualSync() {
    const result = await syncCalendar();
    if (result.job_id) {
      setSyncJobId(result.job_id);
      syncJob.start(result.job_status || "queued", result.message || "Calendar sync queued.");
    }
    toast.success(result.message || "Calendar sync queued.");
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Calendar"
        description="Keep one internal collaboration calendar per user, share events with colleagues and teams, and let synced providers follow the current sign-in path where available."
        actions={
          <>
            <div className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-400">
              <Clock3 className="h-4 w-4 text-neutral-500" />
              {contextQuery.data?.connections.some((connection) => connection.sync_enabled_for_current_session)
                ? "External sync active for this session"
                : "Internal calendar only for this session"}
            </div>
            <Button variant="outline" onClick={() => void handleManualSync()} disabled={isCalendarSyncActive || !hasActiveSyncConnection}>
              <RefreshCw className={"h-4 w-4 " + (isCalendarSyncActive ? "animate-spin" : "")} />
              {isCalendarSyncActive ? "Syncing" : "Sync Now"}
            </Button>
            <Button onClick={() => openCreateDialog(selectedDay)}>
              <Plus className="h-4 w-4" />
              New Event
            </Button>
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/60">
          <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4">
            <div>
              <div className="text-base font-semibold text-neutral-100">
                {month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </div>
              <div className="mt-1 text-sm text-neutral-400">
                Personal scheduling, shared team events, and task-driven calendar entries in one view.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
                Today
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-neutral-800 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div key={day} className="px-4 py-3">
                {day}
              </div>
            ))}
          </div>

          {eventsQuery.isLoading ? (
            <div className="px-5 py-10 text-sm text-neutral-500">Loading calendar events…</div>
          ) : eventsQuery.error ? (
            <div className="px-5 py-10 text-sm text-red-300">
              {eventsQuery.error instanceof Error ? eventsQuery.error.message : "Failed to load calendar events."}
            </div>
          ) : (
            <div className="grid grid-cols-7">
              {calendarDays.map((day) => {
                const dayEvents = eventsByDay.get(dayKey(day)) ?? [];
                const isCurrentMonth = day.getMonth() === month.getMonth();
                const isSelected = sameDay(day, selectedDay);
                const dayLabel = formatDateOnly(dayKey(day));
                return (
                  <div
                    key={day.toISOString()}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`Select ${dayLabel}`}
                    onClick={() => setSelectedDay(day)}
                    onKeyDown={(keyEvent) => {
                      if (isActivationKey(keyEvent)) {
                        keyEvent.preventDefault();
                        setSelectedDay(day);
                      }
                    }}
                    className={
                      "min-h-[132px] cursor-pointer border-b border-r border-neutral-800 px-3 py-3 text-left align-top transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white/20 " +
                      (isSelected ? "bg-white/[0.04]" : "hover:bg-white/[0.02]")
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={"text-sm font-semibold " + (isCurrentMonth ? "text-neutral-100" : "text-neutral-600")}>
                        {day.getDate()}
                      </span>
                      <button
                        type="button"
                        aria-label={`Create event on ${dayLabel}`}
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          openCreateDialog(day);
                        }}
                        onKeyDown={(keyEvent) => {
                          if (isActivationKey(keyEvent)) {
                            keyEvent.stopPropagation();
                          }
                        }}
                        className="rounded-full p-1 text-neutral-600 transition-colors hover:bg-white/8 hover:text-neutral-200"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mt-3 space-y-2">
                      {dayEvents.slice(0, 3).map((event) => (
                        <div
                          key={event.id}
                          role="button"
                          tabIndex={0}
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            openEditDialog(event);
                          }}
                          onKeyDown={(keyEvent) => {
                            if (isActivationKey(keyEvent)) {
                              keyEvent.preventDefault();
                              keyEvent.stopPropagation();
                              openEditDialog(event);
                            }
                          }}
                          className={"rounded-lg border px-2.5 py-2 text-xs " + getEventTone(event)}
                        >
                          <div className="truncate font-medium">{event.title}</div>
                          <div className="mt-1 truncate text-[11px] opacity-80">
                            {formatDateTime(event.start_at, {
                              hour: "numeric",
                              minute: "2-digit",
                              month: undefined,
                              day: undefined,
                              year: undefined,
                            })}
                          </div>
                        </div>
                      ))}
                      {dayEvents.length > 3 ? (
                        <div className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">+{dayEvents.length - 3} more</div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="space-y-5">
          <section className="rounded-2xl border border-neutral-800 bg-neutral-950/60">
            <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4">
              <div>
                <div className="text-base font-semibold text-neutral-100">Selected Day</div>
                <div className="mt-1 text-sm text-neutral-400">{formatDateOnly(selectedDay.toISOString())}</div>
              </div>
              <CalendarDays className="h-4 w-4 text-neutral-500" />
            </div>
            <div className="space-y-3 p-4">
              {selectedDayEvents.length ? (
                selectedDayEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => openEditDialog(event)}
                    className="block w-full rounded-xl border border-neutral-800 bg-black/20 px-4 py-4 text-left transition-colors hover:border-neutral-700 hover:bg-neutral-900/60"
                  >
                    <div className="text-sm font-semibold text-neutral-100">{event.title}</div>
                    <div className="mt-1 text-sm text-neutral-400">
                      {formatDateTime(event.start_at)} to {formatDateTime(event.end_at)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {event.participants.slice(0, 3).map((participant) => (
                        <span key={participant.participant_key} className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-300">
                          {participant.label}
                        </span>
                      ))}
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-neutral-800 bg-black/20 px-4 py-8 text-center text-sm text-neutral-500">
                  No events on this day yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-950/60">
            <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4">
              <div>
                <div className="text-base font-semibold text-neutral-100">Calendar Sync</div>
                <div className="mt-1 text-sm text-neutral-400">Provider health and recent sync activity.</div>
              </div>
              <PlugZap className="h-4 w-4 text-neutral-500" />
            </div>
            <div className="space-y-3 p-4">
              {contextQuery.data?.connections.length ? (
                contextQuery.data.connections.map((connection) => (
                  <div key={connection.provider} className="rounded-xl border border-neutral-800 bg-black/20 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-neutral-100">
                          {providerLabel(connection.provider)} Calendar
                        </div>
                        <div className="mt-1 text-xs text-neutral-500">{connection.account_email || "No account email"}</div>
                      </div>
                      <span className={"rounded-full border px-2.5 py-1 text-[11px] font-medium " + connectionStatusTone(connection)}>
                        {connectionStatusLabel(connection)}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-neutral-400 sm:grid-cols-2">
                      <div>
                        <span className="text-neutral-500">Calendar</span>
                        <div className="mt-0.5 truncate text-neutral-300">
                          {connection.provider_calendar_name || connection.provider_calendar_id || "Not selected yet"}
                        </div>
                      </div>
                      <div>
                        <span className="text-neutral-500">Last sync</span>
                        <div className="mt-0.5 text-neutral-300">
                          {connection.last_successful_sync_at ? formatDateTime(connection.last_successful_sync_at) : "No successful sync yet"}
                        </div>
                      </div>
                    </div>
                    {connection.last_failure_reason ? (
                      <div className="mt-3 flex gap-2 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-200">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{connection.last_failure_reason}</span>
                      </div>
                    ) : null}
                    {connection.scopes.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {connection.scopes.slice(0, 3).map((scope) => (
                          <span key={scope} className="max-w-full truncate rounded-full border border-neutral-800 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-400">
                            {scope}
                          </span>
                        ))}
                        {connection.scopes.length > 3 ? (
                          <span className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-500">
                            +{connection.scopes.length - 3}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => router.push("/dashboard/settings/integrations")}>
                        {connection.reconnect_label || "Manage Provider"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!connection.sync_enabled_for_current_session || isCalendarSyncActive}
                        onClick={() => void handleManualSync()}
                      >
                        <RefreshCw className={"h-3.5 w-3.5 " + (isCalendarSyncActive ? "animate-spin" : "")} />
                        Sync
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-neutral-800 bg-black/20 px-4 py-8 text-center text-sm text-neutral-500">
                  No external calendar provider connected.
                </div>
              )}

              {contextQuery.data?.recent_sync_jobs.length ? (
                <div className="space-y-2 pt-1">
                  {contextQuery.data.recent_sync_jobs.slice(0, 3).map((job) => (
                    <div key={job.id} className="flex items-start gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-3">
                      {job.status === "completed" ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      ) : job.status === "failed" ? (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                      ) : (
                        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-neutral-200">{syncJobLabel(job)}</div>
                        <div className="mt-0.5 text-[11px] text-neutral-500">
                          {formatDateTime(job.completed_at || job.started_at || job.created_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-950/60">
            <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4">
              <div>
                <div className="text-base font-semibold text-neutral-100">Pending Invites</div>
                <div className="mt-1 text-sm text-neutral-400">Accept or decline user-targeted invites here.</div>
              </div>
              <div className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300">
                {contextQuery.data?.pending_invite_count ?? pendingInvites.length}
              </div>
            </div>
            <div className="space-y-3 p-4">
              {pendingInvites.length ? (
                pendingInvites.map((event) => (
                  <div key={event.id} className="rounded-xl border border-amber-800/60 bg-amber-950/20 px-4 py-4">
                    <div className="text-sm font-semibold text-neutral-100">{event.title}</div>
                    <div className="mt-1 text-sm text-neutral-400">{formatDateTime(event.start_at)}</div>
                    {event.owner_name ? <div className="mt-1 text-xs text-neutral-500">Owner: {event.owner_name}</div> : null}
                    <div className="mt-3 flex gap-2">
                      <Button type="button" size="sm" disabled={isResponding} onClick={() => void handleInviteResponse(event, "accepted")}>
                        Accept
                      </Button>
                      <Button type="button" size="sm" variant="outline" disabled={isResponding} onClick={() => void handleInviteResponse(event, "declined")}>
                        Decline
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-neutral-800 bg-black/20 px-4 py-8 text-center text-sm text-neutral-500">
                  No pending invites right now.
                </div>
              )}
            </div>
          </section>

        </div>
      </div>

      <CalendarEventDialog
        open={isDialogOpen}
        event={activeEvent}
        draftStartAt={draftStartAt}
        draftEndAt={draftEndAt}
        users={contextQuery.data?.users ?? []}
        teams={contextQuery.data?.teams ?? []}
        isSubmitting={isSaving}
        isDeleting={isDeleting}
        onClose={closeDialog}
        onSubmit={handleSubmit}
        onDelete={activeEvent ? handleDelete : undefined}
      />
    </div>
  );
}
