"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Clock3, PlugZap, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import CalendarEventDialog from "@/components/calendar/CalendarEventDialog";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchCalendarEvent,
  useCalendarActions,
  useCalendarContext,
  useCalendarEvents,
  type CalendarConnectionSummary,
  type CalendarEvent,
  type CalendarEventPayload,
} from "@/hooks/useCalendar";
import { useJobPoller } from "@/hooks/useJobPoller";
import { useSidebarUser } from "@/hooks/useSidebarUser";
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
  if (event.current_user_response === "pending") return "border-state-warning/40 bg-state-warning-muted text-copy-primary";
  if (event.current_user_response === "shared") return "border-state-info/40 bg-state-info-muted text-copy-primary";
  if (event.current_user_response === "declined") return "border-line-subtle bg-surface-muted text-copy-disabled";
  return "border-line-default bg-surface-raised text-copy-primary";
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
  if (connection.health_status === "healthy") return "border-state-success/40 bg-state-success-muted text-state-success";
  if (connection.health_status === "warning" || connection.health_status === "session_provider_mismatch") {
    return "border-state-warning/40 bg-state-warning-muted text-state-warning";
  }
  return "border-state-danger/40 bg-state-danger-muted text-state-danger";
}

export default function CalendarPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user: currentUser } = useSidebarUser();
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

  useEffect(() => {
    if (!eventId || !eventDetailQuery.error) return;
    toast.error("This calendar event could not be opened.");
    router.replace("/dashboard/calendar");
  }, [eventDetailQuery.error, eventId, router]);

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
    try {
      await respondToInvite(event.id, responseStatus);
      toast.success(responseStatus === "accepted" ? "Invite accepted." : "Invite declined.");
    } catch {
      toast.error("Your invitation response could not be saved.");
    }
  }

  async function handleManualSync() {
    try {
      const result = await syncCalendar();
      if (result.job_id) {
        setSyncJobId(result.job_id);
        syncJob.start(result.job_status || "queued", result.message || "Calendar sync queued.");
      }
      toast.success(result.message || "Calendar sync queued.");
    } catch {
      toast.error("Calendar sync could not be started. Reconnect the provider if the problem continues.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Calendar"
        description="Keep one internal collaboration calendar per user, share events with colleagues and teams, and let synced providers follow the current sign-in path where available."
        actions={
          <>
            <div className="hidden items-center gap-2 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-2 text-xs text-copy-muted xl:flex">
              <Clock3 className="h-4 w-4 text-copy-disabled" />
              {contextQuery.data?.connections.some((connection) => connection.sync_enabled_for_current_session)
                ? "External sync active for this session"
                : "Internal calendar only for this session"}
            </div>
            <Button aria-label={isCalendarSyncActive ? "Syncing calendar" : "Sync calendar now"} variant="outline" onClick={() => void handleManualSync()} disabled={isCalendarSyncActive || !hasActiveSyncConnection}>
              <RefreshCw className={"h-4 w-4 " + (isCalendarSyncActive ? "animate-spin" : "")} />
              <span className="hidden sm:inline">{isCalendarSyncActive ? "Syncing" : "Sync now"}</span>
            </Button>
            <Button aria-label="New event" onClick={() => openCreateDialog(selectedDay)}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New event</span>
            </Button>
          </>
        }
      />

      {contextQuery.isError ? (
        <div role="alert" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-secondary sm:flex-row sm:items-center sm:justify-between">
          <span>Calendar participants and provider status could not be loaded.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void contextQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <Card className="hidden lg:block">
          <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-5 py-4">
            <div>
              <div className="text-base font-semibold text-copy-primary">
                {month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </div>
              <div className="mt-1 text-sm text-copy-muted">
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

          <div className="grid grid-cols-7 border-b border-line-subtle text-[11px] font-semibold uppercase tracking-[0.18em] text-copy-muted">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div key={day} className="px-4 py-3">
                {day}
              </div>
            ))}
          </div>

          {eventsQuery.isLoading ? (
            <div className="grid grid-cols-7 gap-px bg-line-subtle p-px" aria-label="Loading calendar events">
              {Array.from({ length: 35 }, (_, index) => (
                <Skeleton key={index} className="h-28 rounded-none bg-surface" />
              ))}
            </div>
          ) : eventsQuery.error ? (
            <div className="px-5 py-10 text-center">
              <div className="text-sm font-medium text-copy-primary">Calendar events could not be loaded.</div>
              <Button className="mt-4" type="button" size="sm" variant="outline" onClick={() => void eventsQuery.refetch()}>
                Try again
              </Button>
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
                    className={
                      "min-h-[132px] border-b border-r border-line-subtle px-3 py-3 text-left align-top transition-colors " +
                      (isSelected ? "bg-surface-raised" : "hover:bg-surface-muted")
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        aria-label={`Select ${dayLabel}`}
                        onClick={() => setSelectedDay(day)}
                        className={"rounded-md px-1.5 py-0.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ring " + (isCurrentMonth ? "text-copy-primary" : "text-copy-disabled")}
                      >
                        {day.getDate()}
                      </button>
                      <button
                        type="button"
                        aria-label={`Create event on ${dayLabel}`}
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          openCreateDialog(day);
                        }}
                        className="rounded-full p-1 text-copy-disabled transition-colors hover:bg-surface-raised hover:text-copy-primary focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mt-3 space-y-2">
                      {dayEvents.slice(0, 3).map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            openEditDialog(event);
                          }}
                          className={"block w-full rounded-lg border px-2.5 py-2 text-left text-xs focus:outline-none focus:ring-2 focus:ring-ring " + getEventTone(event)}
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
                        </button>
                      ))}
                      {dayEvents.length > 3 ? (
                        <div className="text-[11px] uppercase tracking-[0.16em] text-copy-muted">+{dayEvents.length - 3} more</div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="lg:hidden" aria-label="Calendar month agenda">
          <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-4 py-4">
            <div>
              <div className="font-semibold text-copy-primary">
                {month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </div>
              <div className="mt-1 text-sm text-copy-muted">Choose a day to review or add events.</div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Previous month"
                onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
                Today
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Next month"
                onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {eventsQuery.isLoading ? (
            <div className="space-y-2 p-4" aria-label="Loading calendar events">
              {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}
            </div>
          ) : eventsQuery.isError ? (
            <div className="p-4 text-center">
              <div className="text-sm text-copy-secondary">Calendar events could not be loaded.</div>
              <Button className="mt-3" type="button" size="sm" variant="outline" onClick={() => void eventsQuery.refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1 p-3">
              {calendarDays
                .filter((day) => day.getMonth() === month.getMonth())
                .map((day) => {
                  const count = eventsByDay.get(dayKey(day))?.length ?? 0;
                  const selected = sameDay(day, selectedDay);
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${formatDateOnly(dayKey(day))}${count ? `, ${count} event${count === 1 ? "" : "s"}` : ""}`}
                      onClick={() => setSelectedDay(day)}
                      className={
                        "relative flex min-h-12 items-center justify-center rounded-[var(--radius-control)] border text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring " +
                        (selected
                          ? "border-primary bg-action-primary-muted text-copy-primary"
                          : "border-line-subtle bg-surface-muted text-copy-secondary hover:border-line-strong hover:bg-surface-raised")
                      }
                    >
                      {day.getDate()}
                      {count ? <span className="absolute bottom-1 h-1 w-1 rounded-full bg-state-info" /> : null}
                    </button>
                  );
                })}
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-5 py-4">
              <div>
                <div className="text-base font-semibold text-copy-primary">Selected day</div>
                <div className="mt-1 text-sm text-copy-muted">{formatDateOnly(selectedDay.toISOString())}</div>
              </div>
              <CalendarDays className="h-4 w-4 text-copy-muted" />
            </div>
            <div className="space-y-3 p-4">
              {selectedDayEvents.length ? (
                selectedDayEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => openEditDialog(event)}
                    className="block w-full rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-4 text-left transition-colors hover:border-line-strong hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <div className="text-sm font-semibold text-copy-primary">{event.title}</div>
                    <div className="mt-1 text-sm text-copy-muted">
                      {formatDateTime(event.start_at)} to {formatDateTime(event.end_at)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {event.participants.slice(0, 3).map((participant) => (
                        <span key={participant.participant_key} className="rounded-full border border-line-default bg-surface px-2 py-1 text-[11px] text-copy-secondary">
                          {participant.label}
                        </span>
                      ))}
                    </div>
                  </button>
                ))
              ) : (
                <EmptyState
                  icon={CalendarDays}
                  title="No events on this day"
                  description="Create an event or choose another date."
                  action={<Button type="button" size="sm" variant="outline" onClick={() => openCreateDialog(selectedDay)}>Add event</Button>}
                />
              )}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-5 py-4">
              <div>
                <div className="text-base font-semibold text-copy-primary">Calendar sync</div>
                <div className="mt-1 text-sm text-copy-muted">Provider health and most recent successful sync.</div>
              </div>
              <PlugZap className="h-4 w-4 text-copy-muted" />
            </div>
            <div className="space-y-3 p-4">
              {contextQuery.data?.connections.length ? (
                contextQuery.data.connections.map((connection) => (
                  <div key={connection.provider} className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-copy-primary">
                          {providerLabel(connection.provider)} Calendar
                        </div>
                        <div className="mt-1 text-xs text-copy-muted">{connection.account_email || "No account email"}</div>
                      </div>
                      <span className={"rounded-full border px-2.5 py-1 text-[11px] font-medium " + connectionStatusTone(connection)}>
                        {connectionStatusLabel(connection)}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-copy-muted sm:grid-cols-2">
                      <div>
                        <span>Calendar</span>
                        <div className="mt-0.5 truncate text-copy-secondary">
                          {connection.provider_calendar_name || connection.provider_calendar_id || "Not selected yet"}
                        </div>
                      </div>
                      <div>
                        <span>Last sync</span>
                        <div className="mt-0.5 text-copy-secondary">
                          {connection.last_successful_sync_at ? formatDateTime(connection.last_successful_sync_at) : "No successful sync yet"}
                        </div>
                      </div>
                    </div>
                    {connection.last_failure_reason ? (
                      <div className="mt-3 flex gap-2 rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-3 py-2 text-xs text-copy-primary">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>The provider needs attention. Reconnect it, then try syncing again.</span>
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
                <EmptyState
                  icon={PlugZap}
                  title="No calendar provider connected"
                  description="Your internal calendar still works. Connect Google or Microsoft to sync external events."
                  action={<Button type="button" size="sm" variant="outline" onClick={() => router.push("/dashboard/settings/integrations")}>Manage integrations</Button>}
                />
              )}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-5 py-4">
              <div>
                <div className="text-base font-semibold text-copy-primary">Pending invites</div>
                <div className="mt-1 text-sm text-copy-muted">Accept or decline invitations sent directly to you.</div>
              </div>
              <div className="rounded-full border border-line-default bg-surface-muted px-2.5 py-1 text-xs text-copy-secondary">
                {contextQuery.data?.pending_invite_count ?? pendingInvites.length}
              </div>
            </div>
            <div className="space-y-3 p-4">
              {pendingInvites.length ? (
                pendingInvites.map((event) => (
                  <div key={event.id} className="rounded-[var(--radius-control)] border border-state-warning/40 bg-state-warning-muted px-4 py-4">
                    <div className="text-sm font-semibold text-copy-primary">{event.title}</div>
                    <div className="mt-1 text-sm text-copy-secondary">{formatDateTime(event.start_at)}</div>
                    {event.owner_name ? <div className="mt-1 text-xs text-copy-muted">Owner: {event.owner_name}</div> : null}
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
                <EmptyState title="No pending invites" description="New calendar invitations will appear here." />
              )}
            </div>
          </Card>

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
        canManage={!activeEvent || activeEvent.owner_user_id === currentUser?.id}
        onClose={closeDialog}
        onSubmit={handleSubmit}
        onDelete={activeEvent ? handleDelete : undefined}
      />
    </div>
  );
}
