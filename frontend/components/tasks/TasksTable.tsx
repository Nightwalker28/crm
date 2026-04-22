"use client";

import { Fragment } from "react";

import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Pill } from "@/components/ui/Pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/Table";
import type { Task } from "@/hooks/useTasks";
import { formatDateTime } from "@/lib/datetime";

type Props = {
  tasks: Task[];
  isLoading: boolean;
  isRefreshing?: boolean;
  visibleColumns: string[];
  onEdit: (task: Task) => void;
};

function getPriorityPill(priority: Task["priority"]) {
  switch (priority) {
    case "high":
      return { bg: "bg-red-950/60", text: "text-red-200", border: "border-red-800/70", label: "High" };
    case "low":
      return { bg: "bg-emerald-950/60", text: "text-emerald-200", border: "border-emerald-800/70", label: "Low" };
    default:
      return { bg: "bg-amber-950/60", text: "text-amber-200", border: "border-amber-800/70", label: "Medium" };
  }
}

function getStatusPill(status: Task["status"]) {
  switch (status) {
    case "completed":
      return { bg: "bg-emerald-950/60", text: "text-emerald-200", border: "border-emerald-800/70", label: "Completed" };
    case "blocked":
      return { bg: "bg-red-950/60", text: "text-red-200", border: "border-red-800/70", label: "Blocked" };
    case "in_progress":
      return { bg: "bg-sky-950/60", text: "text-sky-200", border: "border-sky-800/70", label: "In Progress" };
    default:
      return { bg: "bg-neutral-900", text: "text-neutral-200", border: "border-neutral-700", label: "To Do" };
  }
}

export default function TasksTable({
  tasks,
  isLoading,
  isRefreshing = false,
  visibleColumns,
  onEdit,
}: Props) {
  const columnCount = visibleColumns.length;

  function renderCell(task: Task, column: string) {
    switch (column) {
      case "title":
        return (
          <TableCell>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-neutral-100">{task.title}</div>
              <div className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-500">
                {task.description || "No additional task notes yet."}
              </div>
            </div>
          </TableCell>
        );
      case "priority": {
        const pill = getPriorityPill(task.priority);
        return (
          <TableCell>
            <Pill bg={pill.bg} text={pill.text} border={pill.border} className="w-20">
              {pill.label}
            </Pill>
          </TableCell>
        );
      }
      case "status": {
        const pill = getStatusPill(task.status);
        return (
          <TableCell>
            <Pill bg={pill.bg} text={pill.text} border={pill.border} className="w-28">
              {pill.label}
            </Pill>
          </TableCell>
        );
      }
      case "due_at":
        return (
          <TableCell>
            <span className="text-sm text-neutral-300">
              {task.due_at ? formatDateTime(task.due_at) : <span className="text-neutral-600">No due date</span>}
            </span>
          </TableCell>
        );
      case "start_at":
        return (
          <TableCell>
            <span className="text-sm text-neutral-400">
              {task.start_at ? formatDateTime(task.start_at) : <span className="text-neutral-600">—</span>}
            </span>
          </TableCell>
        );
      case "assignees":
        return (
          <TableCell>
            {task.assignees.length ? (
              <div className="flex flex-wrap gap-1.5">
                {task.assignees.slice(0, 3).map((assignee) => (
                  <span
                    key={assignee.assignee_key}
                    className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-300"
                  >
                    {assignee.label}
                  </span>
                ))}
                {task.assignees.length > 3 ? (
                  <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-500">
                    +{task.assignees.length - 3}
                  </span>
                ) : null}
              </div>
            ) : (
              <span className="text-neutral-600">Unassigned</span>
            )}
          </TableCell>
        );
      case "updated_at":
        return (
          <TableCell>
            <span className="text-sm text-neutral-500">
              {task.updated_at ? formatDateTime(task.updated_at) : <span className="text-neutral-600">—</span>}
            </span>
          </TableCell>
        );
      default:
        return <TableCell><span className="text-neutral-600">—</span></TableCell>;
    }
  }

  return (
    <ModuleTableShell isRefreshing={isRefreshing}>
      <Table className="min-w-[920px]">
        <TableHeader>
          <TableHeaderRow>
            {visibleColumns.map((column) => (
              <TableHead key={column}>
                {column === "due_at"
                  ? "Due"
                  : column === "start_at"
                    ? "Start"
                    : column === "updated_at"
                      ? "Updated"
                      : column === "assignees"
                        ? "Assignees"
                        : column.replace(/_/g, " ").replace(/\b\w/g, (value) => value.toUpperCase())}
              </TableHead>
            ))}
          </TableHeaderRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <ModuleTableLoading columnCount={columnCount} />
          ) : tasks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-16 text-center text-neutral-500">
                No tasks found for the current view.
              </TableCell>
            </TableRow>
          ) : (
            tasks.map((task) => (
              <TableRow
                key={task.id}
                className="cursor-pointer"
                onClick={() => onEdit(task)}
              >
                {visibleColumns.map((column) => (
                  <Fragment key={column}>{renderCell(task, column)}</Fragment>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
