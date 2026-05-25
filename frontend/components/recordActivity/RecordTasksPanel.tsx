"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { CheckCircle2, ClipboardList, Plus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import TaskAssigneePicker from "@/components/tasks/TaskAssigneePicker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import {
  fetchRecordTasks,
  fetchTaskAssignmentOptions,
  type Task,
  type TaskAssigneeInput,
  type TaskPriority,
  type TaskStatus,
} from "@/hooks/useTasks";
import { formatDateTime } from "@/lib/datetime";
import type { RecordModuleKey } from "@/types/record-activity";

type Props = {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  sourceLabel?: string;
};

type TaskDraft = {
  title: string;
  description: string;
  dueAt: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignees: TaskAssigneeInput[];
};

function statusLabel(status: string) {
  return status.replace(/_/g, " ");
}

function toIsoOrNull(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function emptyDraft(): TaskDraft {
  return {
    title: "",
    description: "",
    dueAt: "",
    status: "todo",
    priority: "medium",
    assignees: [],
  };
}

async function createRecordTask({
  moduleKey,
  entityId,
  sourceLabel,
  draft,
}: {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  sourceLabel?: string;
  draft: TaskDraft;
}) {
  const res = await apiFetch("/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      status: draft.status,
      priority: draft.priority,
      due_at: toIsoOrNull(draft.dueAt),
      source_module_key: moduleKey,
      source_entity_id: String(entityId),
      source_label: sourceLabel || null,
      assignees: draft.assignees,
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to create task.");
  }
  return body as Task;
}

async function completeTask(task: Task) {
  const res = await apiFetch(`/tasks/${task.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "completed",
      completed_at: new Date().toISOString(),
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to complete task.");
  }
  return body as Task;
}

export default function RecordTasksPanel({ moduleKey, entityId, sourceLabel }: Props) {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft());
  const [submitting, setSubmitting] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ["record-tasks", moduleKey, String(entityId)],
    queryFn: () => fetchRecordTasks(moduleKey, entityId),
    staleTime: 30_000,
  });
  const optionsQuery = useQuery({
    queryKey: ["task-assignment-options"],
    queryFn: fetchTaskAssignmentOptions,
    enabled: isCreating,
    staleTime: 5 * 60_000,
  });
  const tasks = query.data?.results ?? [];

  async function refreshTaskQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["record-tasks", moduleKey, String(entityId)] }),
      queryClient.invalidateQueries({ queryKey: ["record-activity", moduleKey, String(entityId)] }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["user-notifications"] }),
    ]);
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.title.trim()) return;

    try {
      setSubmitting(true);
      await createRecordTask({ moduleKey, entityId, sourceLabel, draft });
      setDraft(emptyDraft());
      setIsCreating(false);
      await refreshTaskQueries();
      toast.success("Task linked to record.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create task.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCompleteTask(task: Task) {
    try {
      setCompletingTaskId(task.id);
      await completeTask(task);
      await refreshTaskQueries();
      toast.success("Task marked complete.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to complete task.");
    } finally {
      setCompletingTaskId(null);
    }
  }

  return (
    <Card className="px-5 py-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-100">Tasks & Reminders</h2>
          <FieldDescription className="mt-1">Follow-up tasks linked to this record.</FieldDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setIsCreating((current) => !current)}>
            <Plus className="h-4 w-4" />
            {isCreating ? "Close" : "Add Task"}
          </Button>
          <ClipboardList className="h-5 w-5 text-neutral-500" />
        </div>
      </div>

      {isCreating ? (
        <form onSubmit={handleCreateTask} className="mb-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-4">
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field className="md:col-span-2">
              <FieldLabel>Task Title</FieldLabel>
              <Input
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="Schedule next customer follow-up"
              />
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel>Description</FieldLabel>
              <Textarea
                rows={3}
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="Capture the next action and owner context."
              />
            </Field>
            <Field>
              <FieldLabel>Due</FieldLabel>
              <Input
                type="datetime-local"
                value={draft.dueAt}
                onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))}
              />
            </Field>
            <Field>
              <FieldLabel>Priority</FieldLabel>
              <Select
                value={draft.priority}
                onValueChange={(value) => setDraft((current) => ({ ...current, priority: value as TaskPriority }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Status</FieldLabel>
              <Select
                value={draft.status}
                onValueChange={(value) => setDraft((current) => ({ ...current, status: value as TaskStatus }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">To Do</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel>Assigned User or Team</FieldLabel>
              {optionsQuery.isLoading ? (
                <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-4 py-3 text-sm text-neutral-500">
                  Loading assignees...
                </div>
              ) : optionsQuery.error ? (
                <div className="rounded-md border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm text-red-300">
                  {optionsQuery.error instanceof Error ? optionsQuery.error.message : "Failed to load assignees."}
                </div>
              ) : (
                <TaskAssigneePicker
                  users={optionsQuery.data?.users ?? []}
                  teams={optionsQuery.data?.teams ?? []}
                  value={draft.assignees}
                  onChange={(assignees) => setDraft((current) => ({ ...current, assignees }))}
                  disabled={submitting}
                />
              )}
            </Field>
          </FieldGroup>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setIsCreating(false);
                setDraft(emptyDraft());
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !draft.title.trim()}>
              {submitting ? "Creating..." : "Create Linked Task"}
            </Button>
          </div>
        </form>
      ) : null}

      {query.isLoading ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-4 py-6 text-sm text-neutral-500">Loading tasks...</div>
      ) : query.error ? (
        <div className="rounded-md border border-red-900/50 bg-red-950/20 px-4 py-4 text-sm text-red-300">
          {query.error instanceof Error ? query.error.message : "Failed to load tasks."}
        </div>
      ) : tasks.length ? (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/tasks?taskId=${task.id}`}
                    className="block truncate text-sm font-semibold text-neutral-100 hover:text-white"
                  >
                    {task.title}
                  </Link>
                  <div className="mt-1 text-xs capitalize text-neutral-500">
                    {statusLabel(task.status)} / {task.priority}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {task.due_at ? <div className="text-xs text-neutral-400">Due {formatDateTime(task.due_at)}</div> : null}
                  {task.status !== "completed" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.preventDefault();
                        void handleCompleteTask(task);
                      }}
                      disabled={completingTaskId === task.id}
                      className="h-7 gap-1 border-emerald-800/60 bg-emerald-950/20 px-2 text-[11px] text-emerald-300 hover:bg-emerald-950/40 hover:text-emerald-200"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {completingTaskId === task.id ? "Saving..." : "Complete"}
                    </Button>
                  ) : null}
                </div>
              </div>
              {task.description ? <div className="mt-2 line-clamp-2 text-sm text-neutral-400">{task.description}</div> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-neutral-800 bg-neutral-950/40 px-4 py-6 text-sm text-neutral-500">
          No tasks are linked to this record yet.
        </div>
      )}
    </Card>
  );
}
