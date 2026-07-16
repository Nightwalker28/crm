"use client";

import { useState } from "react";
import { AlertTriangle, GripVertical } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { Pill } from "@/components/ui/Pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task, TaskStatus } from "@/hooks/useTasks";
import { formatDateTime } from "@/lib/datetime";
import { getTaskPriorityStyle, getTaskStatusStyle } from "@/lib/statusStyles";

type Props = {
  tasks: Task[];
  isLoading: boolean;
  isRefreshing?: boolean;
  onOpen: (task: Task) => void;
  onStatusChange: (task: Task, status: TaskStatus) => Promise<void> | void;
};

const STATUSES: Array<{ value: TaskStatus; label: string }> = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "completed", label: "Completed" },
];

function isOverdue(task: Task) {
  return Boolean(task.due_at && task.status !== "completed" && new Date(task.due_at).getTime() < Date.now());
}

export default function TasksBoard({ tasks, isLoading, isRefreshing = false, onOpen, onStatusChange }: Props) {
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dropStatus, setDropStatus] = useState<TaskStatus | null>(null);

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto rounded-xl border border-line-default bg-surface p-4">
        {STATUSES.map((status) => (
          <div key={status.value} className="min-w-[260px] flex-1 rounded-lg border border-line-default bg-surface-muted p-3">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="mt-4 h-32 w-full" />
            <Skeleton className="mt-3 h-32 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (!tasks.length) {
    return <EmptyState icon={GripVertical} title="No tasks to board" description="Tasks matching the current view will appear here." />;
  }

  return (
    <div className="relative overflow-x-auto rounded-xl border border-line-default bg-surface p-4">
      {isRefreshing ? <div className="absolute right-4 top-4 text-xs text-copy-muted">Refreshing…</div> : null}
      <div className="flex min-w-max gap-4">
        {STATUSES.map((column) => {
          const columnTasks = tasks.filter((task) => task.status === column.value);
          const statusStyle = getTaskStatusStyle(column.value);
          return (
            <section
              key={column.value}
              aria-label={`${column.label} tasks`}
              onDragOver={(event) => { event.preventDefault(); setDropStatus(column.value); }}
              onDragLeave={() => setDropStatus((current) => current === column.value ? null : current)}
              onDrop={() => {
                const task = tasks.find((item) => item.id === draggedId);
                setDraggedId(null);
                setDropStatus(null);
                if (task && task.status !== column.value) void onStatusChange(task, column.value);
              }}
              className={`min-w-[270px] w-[270px] rounded-lg border bg-surface-muted transition-colors ${dropStatus === column.value ? "border-action-primary bg-action-primary-muted/20" : "border-line-default"}`}
            >
              <div className="flex items-center justify-between border-b border-line-default px-3 py-3">
                <Pill bg={statusStyle.bg} text={statusStyle.text} border={statusStyle.border}>{column.label}</Pill>
                <span className="text-xs font-medium text-copy-muted">{columnTasks.length}</span>
              </div>
              <div className="flex min-h-48 flex-col gap-3 p-3">
                {columnTasks.length ? columnTasks.map((task) => {
                  const priorityStyle = getTaskPriorityStyle(task.priority);
                  return (
                    <article
                      key={task.id}
                      draggable
                      onDragStart={() => setDraggedId(task.id)}
                      onDragEnd={() => { setDraggedId(null); setDropStatus(null); }}
                      className={`rounded-lg border bg-surface p-3 shadow-sm ${isOverdue(task) ? "border-state-warning/60" : "border-line-default"}`}
                    >
                      <div className="flex items-start gap-2">
                        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-copy-muted" aria-hidden="true" />
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(task)}>
                          <span className="line-clamp-2 text-sm font-semibold text-copy-primary hover:underline">{task.title}</span>
                        </button>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Pill bg={priorityStyle.bg} text={priorityStyle.text} border={priorityStyle.border}>{priorityStyle.label}</Pill>
                        {isOverdue(task) ? <span className="inline-flex items-center gap-1 text-xs text-state-warning"><AlertTriangle className="h-3.5 w-3.5" />Overdue</span> : null}
                      </div>
                      <div className="mt-3 space-y-1 text-xs text-copy-muted">
                        <div>{task.due_at ? `Due ${formatDateTime(task.due_at)}` : "No due date"}</div>
                        <div className="truncate">{task.assignees.length ? task.assignees.map((item) => item.label).join(", ") : "Unassigned"}</div>
                      </div>
                      <Select value={task.status} onValueChange={(value) => void onStatusChange(task, value as TaskStatus)}>
                        <SelectTrigger className="mt-3 w-full" aria-label={`Change status for ${task.title}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>{STATUSES.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </article>
                  );
                }) : <div className="py-10 text-center text-sm text-copy-muted">Drop tasks here</div>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
