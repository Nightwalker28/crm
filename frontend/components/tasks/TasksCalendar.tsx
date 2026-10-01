"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";

import { renderListState } from "@/components/ui/ListStates";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { MonthGrid, todayInUserTimezone } from "@/components/ui/MonthGrid";
import type { Task } from "@/hooks/useTasks";
import { formatDateTime } from "@/lib/datetime";
import { getTaskPriority } from "@/lib/statusStyles";

type Props = {
  tasks: Task[];
  isLoading: boolean;
  isRefreshing?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  onOpen: (task: Task) => void;
};

const getTaskKey = (task: Task) => task.id;
const getTaskDueAt = (task: Task) => task.due_at;

/**
 * The task list's calendar display — the third render of the same loaded rows, beside the table
 * and the board, so it sits in the same `ModuleTableShell` and says the same four states.
 */
export default function TasksCalendar({ tasks, isLoading, isRefreshing = false, hasError = false, onRetry, hasActiveFilters = false, onClearFilters, onOpen }: Props) {
  const [selectedDay, setSelectedDay] = useState(todayInUserTimezone);
  const scheduledCount = tasks.filter((task) => task.due_at).length;
  const state = renderListState({
    label: "Tasks",
    hasItems: tasks.length > 0,
    isLoading,
    hasError,
    onRetry,
    hasActiveFilters,
    onClearFilters,
    emptyState: { icon: CalendarDays, title: "No tasks to schedule", description: "Tasks matching the current view will appear here." },
  });

  return (
    <ModuleTableShell label="Tasks" isLoading={isLoading} isRefreshing={isRefreshing}>
      <MonthGrid
        label="Task due date calendar"
        entryNoun={{ one: "task", other: "tasks" }}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        entries={tasks}
        getKey={getTaskKey}
        getDate={getTaskDueAt}
        onOpenEntry={onOpen}
        emptyDayMessage="No tasks due this day."
        description={isLoading ? undefined : `${scheduledCount} of ${tasks.length} loaded tasks have a due date`}
        isLoading={isLoading}
        state={state}
        renderEntry={(task, layout) =>
          layout === "cell" ? (
            <span className="block truncate font-medium">{task.title}</span>
          ) : (
            <>
              <span className="block font-medium">{task.title}</span>
              <span className="mt-0.5 block text-xs text-copy-muted">
                {task.due_at ? formatDateTime(task.due_at) : "No due date"} · {getTaskPriority(task.priority).label} priority
              </span>
            </>
          )
        }
      />
    </ModuleTableShell>
  );
}
