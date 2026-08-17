"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";

import { StatusValue } from "@/components/ui/StatusValue";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/hooks/useTasks";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { getTaskPriority } from "@/lib/statusStyles";

type Props = { tasks: Task[]; isLoading: boolean; isRefreshing?: boolean; hasError?: boolean; onRetry?: () => void; onOpen: (task: Task) => void };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function taskDateKey(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateKey(date);
}

function buildCalendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

export default function TasksCalendar({ tasks, isLoading, isRefreshing = false, hasError = false, onRetry, onOpen }: Props) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const days = useMemo(() => buildCalendarDays(month), [month]);
  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    tasks.forEach((task) => {
      if (!task.due_at) return;
      const key = taskDateKey(task.due_at);
      if (key) grouped.set(key, [...(grouped.get(key) ?? []), task]);
    });
    return grouped;
  }, [tasks]);
  const scheduledCount = tasks.filter((task) => task.due_at).length;
  const selectedTasks = tasksByDate.get(dateKey(selectedDay)) ?? [];

  function goToMonth(offset: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next);
    setSelectedDay(next);
  }

  function goToToday() {
    const today = new Date();
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDay(today);
  }

  // §7.4 — same four states as the table this view replaces.
  if (hasError) {
    return (
      <div role="alert">
        <EmptyState
          icon={TriangleAlert}
          title="Tasks could not be loaded"
          description="Check your connection and try again."
          action={onRetry ? <Button type="button" variant="outline" onClick={onRetry}>Try again</Button> : undefined}
        />
      </div>
    );
  }
  if (isLoading) return <Skeleton className="h-[640px] w-full rounded-[var(--radius-panel)]" />;
  if (!tasks.length) return <EmptyState icon={CalendarDays} title="No tasks to schedule" description="Tasks matching the current view will appear here." />;

  return (
    <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line-default bg-surface" aria-label="Task due date calendar">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-default px-4 py-3">
        <div>
          <h2 className="font-semibold text-copy-primary">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
          <p className="text-xs text-copy-muted">{scheduledCount} of {tasks.length} loaded tasks have a due date{isRefreshing ? " · Refreshing…" : ""}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" aria-label="Previous month" onClick={() => goToMonth(-1)}><ChevronLeft /></Button>
          <Button type="button" variant="outline" size="sm" onClick={goToToday}>Today</Button>
          <Button type="button" variant="outline" size="sm" aria-label="Next month" onClick={() => goToMonth(1)}><ChevronRight /></Button>
        </div>
      </div>

      <div className="md:hidden">
        <div className="grid grid-cols-7 gap-1 border-b border-line-default p-3">
          {days
            .filter((date) => date.getMonth() === month.getMonth())
            .map((date) => {
              const count = tasksByDate.get(dateKey(date))?.length ?? 0;
              const selected = dateKey(date) === dateKey(selectedDay);
              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${formatDateOnly(dateKey(date))}${count ? `, ${count} task${count === 1 ? "" : "s"}` : ""}`}
                  onClick={() => setSelectedDay(date)}
                  className={
                    "relative flex min-h-12 items-center justify-center rounded-[var(--radius-control)] border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring " +
                    (selected
                      ? "border-primary bg-action-primary-muted text-copy-primary"
                      : "border-line-subtle bg-surface-muted text-copy-secondary")
                  }
                >
                  {date.getDate()}
                  {count ? <span className="absolute bottom-1 h-1 w-1 rounded-full bg-state-info" /> : null}
                </button>
              );
            })}
        </div>
        <div className="space-y-2 p-3">
          <div className="px-1 text-sm font-medium text-copy-primary">{formatDateOnly(dateKey(selectedDay))}</div>
          {selectedTasks.length ? selectedTasks.map((task) => {
            const priority = getTaskPriority(task.priority);
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpen(task)}
                className="block w-full rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-3 text-left focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <span className="block text-sm font-semibold text-copy-primary">{task.title}</span>
                <span className="mt-1 block text-xs text-copy-muted">{task.due_at ? formatDateTime(task.due_at) : "No due date"}</span>
                <StatusValue status={priority} className="mt-2" />
              </button>
            );
          }) : (
            <EmptyState title="No tasks due this day" description="Choose another date or add a due date to a task." />
          )}
        </div>
      </div>

      <div className="hidden overflow-x-auto md:block">
        <div className="min-w-[840px]">
          <div className="grid grid-cols-7 border-b border-line-default bg-surface-muted">
            {WEEKDAYS.map((day) => <div key={day} className="px-2 py-2 text-center text-xs font-semibold text-copy-label">{day}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((date) => {
              const entries = tasksByDate.get(dateKey(date)) ?? [];
              const outsideMonth = date.getMonth() !== month.getMonth();
              const today = dateKey(date) === dateKey(new Date());
              return (
                <div key={date.toISOString()} className={`min-h-28 border-b border-r border-line-subtle p-2 ${outsideMonth ? "bg-surface-muted/50" : "bg-surface"}`}>
                  <div className={`mb-2 flex h-6 w-6 items-center justify-center rounded-full text-xs ${today ? "bg-action-primary text-primary-foreground" : outsideMonth ? "text-copy-disabled" : "text-copy-muted"}`}>{date.getDate()}</div>
                  <div className="space-y-1.5">
                    {entries.slice(0, 3).map((task) => {
                      const priority = getTaskPriority(task.priority);
                      return (
                        <button key={task.id} type="button" onClick={() => onOpen(task)} className="block w-full rounded-[var(--radius-control)] border border-line-subtle bg-surface px-2 py-1.5 text-left hover:border-action-primary">
                          <span className="block truncate text-xs font-medium text-copy-primary">{task.title}</span>
                          <StatusValue status={priority} className="mt-1" />
                        </button>
                      );
                    })}
                    {entries.length > 3 ? <div className="px-1 text-[11px] text-copy-muted">+{entries.length - 3} more</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
