"use client";

import { useMemo } from "react";
import { ClipboardList } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/Pill";
import { RecordTable, type RecordTableColumn } from "@/components/ui/RecordTable";
import type { Task, TaskSortState } from "@/hooks/useTasks";
import { formatDateTime } from "@/lib/datetime";
import { getTaskPriorityStyle, getTaskStatusStyle } from "@/lib/statusStyles";

type Props = {
  tasks: Task[];
  isLoading: boolean;
  isRefreshing?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  visibleColumns: string[];
  onEdit: (task: Task) => void;
  isFiltered?: boolean;
  /** Opens the list's create dialog. Omitted when the user cannot create tasks. */
  onCreateTask?: () => void;
  sort?: TaskSortState;
  onSortChange?: (sort: TaskSortState) => void;
};

const SORTABLE_COLUMNS = new Set(["title", "priority", "status", "assigned_at", "due_at", "start_at", "updated_at"]);

const COLUMN_SIZES: Record<string, "sm" | "md" | "lg"> = {
  title: "lg",
  assignees: "lg",
  priority: "sm",
  status: "sm",
};

function columnLabel(column: string) {
  return column === "due_at"
    ? "Due"
    : column === "start_at"
      ? "Start"
      : column === "assigned_by_name"
        ? "Assigned By"
        : column === "assigned_at"
          ? "Assigned"
          : column === "updated_at"
            ? "Updated"
            : column === "assignees"
              ? "Assignees"
              : column.replace(/_/g, " ").replace(/\b\w/g, (value) => value.toUpperCase());
}

function renderCell(task: Task, column: string) {
  switch (column) {
    case "title":
      return (
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-copy-primary">{task.title}</div>
          <div className="mt-1 line-clamp-2 text-p-xs text-copy-muted">
            {task.description || "No additional task notes yet."}
          </div>
        </div>
      );
    case "priority": {
      const pill = getTaskPriorityStyle(task.priority);
      return <Pill bg={pill.bg} text={pill.text} border={pill.border} className="w-20">{pill.label}</Pill>;
    }
    case "status": {
      const pill = getTaskStatusStyle(task.status);
      return <Pill bg={pill.bg} text={pill.text} border={pill.border} className="w-28">{pill.label}</Pill>;
    }
    case "assigned_by_name":
      return (
        <span className="text-sm text-copy-secondary">
          {task.assigned_by_name || <span className="text-copy-disabled">Unassigned</span>}
        </span>
      );
    case "assigned_at":
      return (
        <span className="text-sm text-copy-muted">
          {task.assigned_at ? formatDateTime(task.assigned_at) : <span className="text-copy-disabled">—</span>}
        </span>
      );
    case "due_at":
      return (
        <span className="text-sm text-copy-secondary">
          {task.due_at ? formatDateTime(task.due_at) : <span className="text-copy-disabled">No due date</span>}
        </span>
      );
    case "start_at":
      return (
        <span className="text-sm text-copy-muted">
          {task.start_at ? formatDateTime(task.start_at) : <span className="text-copy-disabled">—</span>}
        </span>
      );
    case "assignees":
      return task.assignees.length ? (
        <div className="flex flex-wrap gap-1.5">
          {task.assignees.slice(0, 3).map((assignee) => (
            <Pill key={assignee.assignee_key}>{assignee.label}</Pill>
          ))}
          {task.assignees.length > 3 ? <Pill text="text-copy-muted">+{task.assignees.length - 3}</Pill> : null}
        </div>
      ) : (
        <span className="text-sm text-copy-disabled">Unassigned</span>
      );
    case "updated_at":
      return (
        <span className="text-sm text-copy-muted">
          {task.updated_at ? formatDateTime(task.updated_at) : <span className="text-copy-disabled">—</span>}
        </span>
      );
    default:
      return <span className="text-sm text-copy-disabled">—</span>;
  }
}

export default function TasksTable({
  tasks,
  isLoading,
  isRefreshing = false,
  hasError = false,
  onRetry,
  visibleColumns,
  onEdit,
  isFiltered = false,
  onCreateTask,
  sort = null,
  onSortChange,
}: Props) {
  const columns = useMemo<RecordTableColumn<Task>[]>(
    () =>
      visibleColumns.map((column) => ({
        key: column,
        label: columnLabel(column),
        sortable: SORTABLE_COLUMNS.has(column),
        size: COLUMN_SIZES[column],
        render: (task) => renderCell(task, column),
      })),
    [visibleColumns],
  );

  return (
    <RecordTable
      label="Tasks"
      columns={columns}
      rows={tasks}
      rowKey={(task) => task.id}
      onOpenRow={onEdit}
      rowLabel={(task) => `Open task ${task.title}`}
      sort={sort ? { column: sort.key, direction: sort.direction } : null}
      onSortChange={onSortChange ? (next) => onSortChange({ key: next.column, direction: next.direction }) : undefined}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError}
      onRetry={onRetry}
      hasActiveFilters={isFiltered}
      emptyState={{
        icon: ClipboardList,
        title: "No tasks yet",
        description: "Create a task to start coordinating team work.",
        action: onCreateTask ? <Button type="button" onClick={onCreateTask}>Add task</Button> : undefined,
      }}
      filteredEmptyState={{
        icon: ClipboardList,
        title: "No tasks match this view",
        description: "Adjust or clear the current search and filters.",
      }}
    />
  );
}
