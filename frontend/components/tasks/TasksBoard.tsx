"use client";

import { AlertTriangle, ClipboardList } from "lucide-react";

import { Board, type BoardColumn } from "@/components/ui/Board";
import { StatusValue } from "@/components/ui/StatusValue";
import { Button } from "@/components/ui/button";
import type { Task, TaskStatus } from "@/hooks/useTasks";
import { formatDateTime } from "@/lib/datetime";
import { getTaskPriority, getTaskStatus } from "@/lib/statusStyles";

type Props = {
  tasks: Task[];
  isLoading: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  isRefreshing?: boolean;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  onCreate?: () => void;
  onOpen: (task: Task) => void;
  onStatusChange: (task: Task, status: TaskStatus) => Promise<void> | void;
};

const COLUMNS: BoardColumn[] = (["todo", "in_progress", "blocked", "completed"] as const).map((key) => {
  const status = getTaskStatus(key);
  return { key, label: status.label, status };
});

function isOverdue(task: Task) {
  return Boolean(task.due_at && task.status !== "completed" && new Date(task.due_at).getTime() < Date.now());
}

export default function TasksBoard({ tasks, isLoading, isRefreshing = false, hasError = false, onRetry, hasActiveFilters = false, onClearFilters, onCreate, onOpen, onStatusChange }: Props) {
  return (
    <Board
      label="Tasks"
      moveFieldLabel="status"
      columns={COLUMNS}
      items={tasks}
      getKey={(task) => task.id}
      getColumn={(task) => task.status}
      getItemLabel={(task) => task.title}
      onOpenItem={onOpen}
      onMove={(task, status) => onStatusChange(task, status as TaskStatus)}
      renderCardBody={(task) => (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <StatusValue status={getTaskPriority(task.priority)} />
            {isOverdue(task) ? (
              <span className="inline-flex items-center gap-1 text-state-warning">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                Overdue
              </span>
            ) : null}
          </div>
          <div>{task.due_at ? `Due ${formatDateTime(task.due_at)}` : "No due date"}</div>
          <div className="truncate">{task.assignees.length ? task.assignees.map((item) => item.label).join(", ") : "Unassigned"}</div>
        </>
      )}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError}
      onRetry={onRetry}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
      // The table's words, so switching display does not change what the empty list says.
      emptyState={{
        icon: ClipboardList,
        title: "No tasks yet",
        description: "Create a task to start coordinating team work.",
        action: onCreate ? <Button type="button" onClick={onCreate}>Create task</Button> : undefined,
      }}
      filteredEmptyState={{
        title: "No tasks match this view",
        description: "Adjust or clear the current search and filters.",
      }}
    />
  );
}
