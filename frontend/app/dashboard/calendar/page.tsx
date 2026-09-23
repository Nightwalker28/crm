"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, PlugZap, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import CalendarEventDialog from "@/components/calendar/CalendarEventDialog";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Fact, FactList } from "@/components/ui/Fact";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { MonthGrid, monthGridDays, todayInUserTimezone } from "@/components/ui/MonthGrid";
import { PageShell } from "@/components/ui/PageShell";
import { PanelEmpty, PanelError, PanelHeader, PanelLoading } from "@/components/ui/PanelStates";
import { StatusValue } from "@/components/ui/StatusValue";
import { Button } from "@/components/ui/button";
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
import { formatDateTime } from "@/lib/datetime";
import type { StatusDescriptor } from "@/lib/statusStyles";

function buildDayTime(day: Date, hour: number) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0).toISOString();
}

function providerLabel(provider: CalendarConnectionSummary["provider"]) {
  return provider === "microsoft" ? "Microsoft" : "Google";
}

/**
 * A provider's health, as a status (R5): *ready* is the normal state and reads as ink; only a
 * connection the operator has to act on is painted.
 */
function connectionStatus(connection: CalendarConnectionSummary): StatusDescriptor {
  if (connection.health_status === "healthy") return { tone: "neutral", label: "Ready" };
  if (connection.health_status === "session_provider_mismatch") return { tone: "attention", label: "Connected, sign-in mismatch" };
  if (connection.health_status === "warning") return { tone: "attention", label: "Needs attention" };
  if (connection.health_status === "error") return { tone: "critical", label: "Sync error" };
  if (connection.health_status === "reconnect_required") return { tone: "critical", label: "Reconnect required" };
  return { tone: "neutral", label: connection.status.replaceAll("_", " ") };
}

const timeOnly = { hour: "numeric", minute: "2-digit", month: undefined, day: undefined, year: undefined } as const;
const getEventKey = (event: CalendarEvent) => event.id;
const getEventStart = (event: CalendarEvent) => event.start_at;

export default function CalendarPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user: currentUser } = useSidebarUser();
  const searchParams = useSearchParams();
  const eventIdParam = searchParams.get("eventId");
  const eventId = eventIdParam && /^\d+$/.test(eventIdParam) ? Number(eventIdParam) : null;

  const [selectedDay, setSelectedDay] = useState(todayInUserTimezone);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [draftStartAt, setDraftStartAt] = useState(() => buildDayTime(new Date(), 9));
  const [draftEndAt, setDraftEndAt] = useState(() => buildDayTime(new Date(), 10));
  const [syncJobId, setSyncJobId] = useState<number | null>(null);

  const contextQuery = useCalendarContext();
  // The query covers the 42 days the grid draws, so the padding days show their events too.
  // Keyed on the month, not the day, so selecting a day does not refetch.
  const monthIndex = selectedDay.getFullYear() * 12 + selectedDay.getMonth();
  const [rangeStart, rangeEnd] = useMemo(() => {
    const days = monthGridDays(new Date(Math.floor(monthIndex / 12), monthIndex % 12, 1));
    const last = days[days.length - 1];
    return [days[0].toISOString(), new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999).toISOString()];
  }, [monthIndex]);
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
  const createRequested = searchParams.get("action") === "create";
  const isDialogOpen = createRequested || (eventId ? Boolean(activeEvent) : dialogOpen);

  useEffect(() => {
    if (!eventId || !eventDetailQuery.error) return;
    toast.error("This calendar event could not be opened.");
    router.replace("/dashboard/calendar");
  }, [eventDetailQuery.error, eventId, router]);

  const pendingInvites = useMemo(() => events.filter((event) => event.current_user_response === "pending"), [events]);
  const hasActiveSyncConnection = Boolean(
    contextQuery.data?.connections.some((connection) => connection.sync_enabled_for_current_session),
  );
  const isCalendarSyncActive = isSyncingCalendar || syncJob.status === "queued" || syncJob.status === "running";

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
    <PageShell
      title="Calendar"
      actions={(
        <>
          <Button aria-label={isCalendarSyncActive ? "Syncing calendar" : "Sync calendar now"} variant="outline" onClick={() => void handleManualSync()} disabled={isCalendarSyncActive || !hasActiveSyncConnection}>
            <RefreshCw className={isCalendarSyncActive ? "animate-spin" : undefined} />
            <span className="hidden sm:inline">{isCalendarSyncActive ? "Syncing" : "Sync now"}</span>
          </Button>
          <Button aria-label="Create event" onClick={() => openCreateDialog(selectedDay)}>
            <Plus />
            <span className="hidden sm:inline">Create event</span>
          </Button>
        </>
      )}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="min-w-0">
          <MonthGrid
            label="Event calendar"
            entryNoun={{ one: "event", other: "events" }}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            entries={events}
            getKey={getEventKey}
            getDate={getEventStart}
            onOpenEntry={openEditDialog}
            emptyDayMessage="No events on this day."
            isLoading={eventsQuery.isLoading}
            state={eventsQuery.isError ? (
              <div className="p-4">
                <PanelError message="Calendar events could not be loaded." onRetry={() => void eventsQuery.refetch()} />
              </div>
            ) : undefined}
            renderDayAction={(day, { label, tabIndex }) => (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                tabIndex={tabIndex}
                aria-label={`Create event on ${label}`}
                onClick={() => openCreateDialog(day)}
                className="text-copy-muted"
              >
                <Plus />
              </Button>
            )}
            renderEntry={(event, layout) => {
              const isPending = event.current_user_response === "pending";
              const isDeclined = event.current_user_response === "declined";
              const time = event.is_all_day ? "All day" : formatDateTime(event.start_at, timeOnly);
              if (layout === "cell") {
                return (
                  <span className="flex min-w-0 items-center gap-1">
                    {isPending ? (
                      <>
                        <Mail className="size-3 shrink-0 text-state-warning" aria-hidden="true" />
                        <span className="sr-only">Awaiting your response: </span>
                      </>
                    ) : null}
                    {isDeclined ? <span className="sr-only">Declined: </span> : null}
                    <span className={isDeclined ? "truncate text-copy-disabled" : "truncate font-medium"}>{event.title}</span>
                    <span className="ml-auto shrink-0 text-2xs tabular-nums text-copy-muted">{time}</span>
                  </span>
                );
              }
              return (
                <>
                  <span className={isDeclined ? "block text-copy-disabled" : "block font-medium"}>{event.title}</span>
                  <span className="mt-0.5 block text-xs text-copy-muted">
                    {event.is_all_day ? "All day" : `${formatDateTime(event.start_at, timeOnly)} – ${formatDateTime(event.end_at, timeOnly)}`}
                    {isDeclined ? " · Declined" : ""}
                  </span>
                  {isPending ? (
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-state-warning">
                      <Mail className="size-3" aria-hidden="true" />
                      Awaiting your response
                    </span>
                  ) : null}
                </>
              );
            }}
          />
        </Card>

        <div className="space-y-6">
          <Card className="p-4">
            <PanelHeader
              title="Pending invites"
              description="Invitations sent directly to you."
              action={<Chip>{contextQuery.data?.pending_invite_count ?? pendingInvites.length}</Chip>}
            />
            <div className="mt-3">
              {eventsQuery.isLoading ? (
                <PanelLoading label="Loading invites…" />
              ) : pendingInvites.length ? (
                <RowList label="Pending invites">
                  {pendingInvites.map((event) => (
                    <ListRow
                      key={event.id}
                      title={event.title}
                      onSelect={() => openEditDialog(event)}
                      meta={`${formatDateTime(event.start_at)}${event.owner_name ? ` · from ${event.owner_name}` : ""}`}
                      actions={
                        <>
                          <Button type="button" disabled={isResponding} onClick={() => void handleInviteResponse(event, "accepted")}>
                            Accept
                          </Button>
                          <Button type="button" variant="outline" disabled={isResponding} onClick={() => void handleInviteResponse(event, "declined")}>
                            Decline
                          </Button>
                        </>
                      }
                    />
                  ))}
                </RowList>
              ) : (
                <PanelEmpty title="No pending invites" description="New calendar invitations will appear here." />
              )}
            </div>
          </Card>

          <Card className="p-4">
            <PanelHeader
              title="Calendar sync"
              description={hasActiveSyncConnection ? "External sync is active for this session." : "Internal calendar only for this session."}
            />
            <div className="mt-3">
              {contextQuery.isLoading ? (
                <PanelLoading label="Loading providers…" />
              ) : contextQuery.isError ? (
                <PanelError message="Provider status could not be loaded." onRetry={() => void contextQuery.refetch()} />
              ) : contextQuery.data?.connections.length ? (
                <RowList label="Calendar providers">
                  {contextQuery.data.connections.map((connection) => (
                    <ListRow
                      key={connection.provider}
                      title={`${providerLabel(connection.provider)} Calendar`}
                      meta={connection.account_email || "No account email"}
                      trailing={<StatusValue status={connectionStatus(connection)} />}
                      actions={
                        <Button type="button" variant="outline" onClick={() => router.push("/dashboard/settings/integrations")}>
                          {connection.reconnect_label || "Manage provider"}
                        </Button>
                      }
                    >
                      <FactList className="grid-cols-2">
                        <Fact label="Calendar">
                          {connection.provider_calendar_name || connection.provider_calendar_id || "Not selected yet"}
                        </Fact>
                        <Fact label="Last sync">
                          {connection.last_successful_sync_at ? formatDateTime(connection.last_successful_sync_at) : "No successful sync yet"}
                        </Fact>
                      </FactList>
                      {connection.last_failure_reason ? (
                        <p className="mt-3 flex gap-2 text-xs text-state-danger">
                          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                          The provider needs attention. Reconnect it, then try syncing again.
                        </p>
                      ) : null}
                    </ListRow>
                  ))}
                </RowList>
              ) : (
                <PanelEmpty
                  icon={PlugZap}
                  title="No calendar provider connected"
                  description="Your internal calendar still works. Connect Google or Microsoft to sync external events."
                  action={<Button type="button" variant="outline" onClick={() => router.push("/dashboard/settings/integrations")}>Manage integrations</Button>}
                />
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
    </PageShell>
  );
}
