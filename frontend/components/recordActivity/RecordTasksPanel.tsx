"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, ClipboardList, Plus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  PanelEmpty,
  PanelError,
  PanelHeader,
  PanelLoading,
} from "@/components/ui/PanelStates";
import TaskAssigneePicker from "@/components/tasks/TaskAssigneePicker";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
  canCreate?: boolean;
  canEdit?: boolean;
  createRequestId?: number;
  createActionVariant?: "default" | "outline";
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
    throw new Error("The linked task could not be created.");
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
    throw new Error("The linked task could not be completed.");
  }
  return body as Task;
}

export default function RecordTasksPanel({
  moduleKey,
  entityId,
  sourceLabel,
  canCreate = true,
  canEdit = true,
  createRequestId = 0,
  createActionVariant = "default",
}: Props) {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(createRequestId > 0);
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft());
  const [submitting, setSubmitting] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState<number | null>(null);

  useEffect(() => {
    if (!canCreate || createRequestId <= 0) return;
    setIsCreating(true);
  }, [canCreate, createRequestId]);

  useEffect(() => {
    if (!isCreating || createRequestId <= 0) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`record-task-title-${moduleKey}-${entityId}`)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [createRequestId, entityId, isCreating, moduleKey]);

  const query = useQuery({
    queryKey: ["record-tasks", moduleKey, String(entityId)],
    queryFn: () => fetchRecordTasks(moduleKey, entityId),
    staleTime: 30_000,
  });
  const optionsQuery = useQuery({
    queryKey: ["task-assignment-options"],
    queryFn: fetchTaskAssignmentOptions,
    enabled: canCreate && isCreating,
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
    if (!canCreate || !draft.title.trim()) return;

    try {
      setSubmitting(true);
      await createRecordTask({ moduleKey, entityId, sourceLabel, draft });
      setDraft(emptyDraft());
      setIsCreating(false);
      await refreshTaskQueries();
      toast.success("Task linked to record.");
    } catch {
      toast.error("The linked task could not be created. Check your access and try again.");
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
    } catch {
      toast.error("The linked task could not be completed. Check your access and try again.");
    } finally {
      setCompletingTaskId(null);
    }
  }

  return (
    <Card className="px-5 py-5">
      <PanelHeader
        title="Tasks & reminders"
        description="Follow-up tasks linked to this record."
        icon={ClipboardList}
        action={canCreate ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setIsCreating((current) => !current)}>
            <Plus className="h-4 w-4" />
            {isCreating ? "Close" : "Add task"}
          </Button>
        ) : undefined}
      />

      {canCreate && isCreating ? (
        <form onSubmit={handleCreateTask} className="my-4 rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-4">
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field className="md:col-span-2">
              <FieldLabel htmlFor={`record-task-title-${moduleKey}-${entityId}`}>Task title</FieldLabel>
              <Input
                id={`record-task-title-${moduleKey}-${entityId}`}
                required
                maxLength={255}
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="Schedule next customer follow-up"
              />
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel htmlFor={`record-task-description-${moduleKey}-${entityId}`}>Description</FieldLabel>
              <Textarea
                id={`record-task-description-${moduleKey}-${entityId}`}
                rows={3}
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="Capture the next action and owner context."
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`record-task-due-${moduleKey}-${entityId}`}>Due</FieldLabel>
              <Input
                id={`record-task-due-${moduleKey}-${entityId}`}
                type="datetime-local"
                value={draft.dueAt}
                onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`record-task-priority-${moduleKey}-${entityId}`}>Priority</FieldLabel>
              <Select
                value={draft.priority}
                onValueChange={(value) => setDraft((current) => ({ ...current, priority: value as TaskPriority }))}
              >
                <SelectTrigger id={`record-task-priority-${moduleKey}-${entityId}`} className="w-full">
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
              <FieldLabel htmlFor={`record-task-status-${moduleKey}-${entityId}`}>Status</FieldLabel>
              <Select
                value={draft.status}
                onValueChange={(value) => setDraft((current) => ({ ...current, status: value as TaskStatus }))}
              >
                <SelectTrigger id={`record-task-status-${moduleKey}-${entityId}`} className="w-full">
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
              <FieldLabel>Assigned user or team</FieldLabel>
              {optionsQuery.isLoading ? (
                <PanelLoading label="Loading assignees…" />
              ) : optionsQuery.error ? (
                <PanelError message="Task assignment options could not be loaded." onRetry={() => void optionsQuery.refetch()} />
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
            <Button type="submit" variant={createActionVariant} disabled={submitting || !draft.title.trim()}>
              {submitting ? "Creating…" : "Create linked task"}
            </Button>
          </div>
        </form>
      ) : null}

      {query.isLoading ? (
        <div className="mt-4"><PanelLoading label="Loading linked tasks…" /></div>
      ) : query.error ? (
        <div className="mt-4"><PanelError message="Linked tasks could not be loaded." onRetry={() => void query.refetch()} /></div>
      ) : tasks.length ? (
        <ol className="mt-4 space-y-3" aria-label="Linked tasks">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/tasks?taskId=${task.id}`}
                    className="block truncate text-sm font-semibold text-copy-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    {task.title}
                  </Link>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Chip>{statusLabel(task.status)}</Chip>
                    <Chip>{task.priority} priority</Chip>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {task.due_at ? <div className="text-xs text-copy-muted">Due {formatDateTime(task.due_at)}</div> : null}
                  {canEdit && task.status !== "completed" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.preventDefault();
                        void handleCompleteTask(task);
                      }}
                      disabled={completingTaskId === task.id}
                      className="border-state-success/40 bg-state-success-muted text-state-success hover:bg-state-success-muted hover:text-state-success"
                    >
                      <CheckCircle2 />
                      {completingTaskId === task.id ? "Saving…" : "Complete"}
                    </Button>
                  ) : null}
                </div>
              </div>
              {task.description ? <div className="mt-3 line-clamp-2 text-p-sm text-copy-secondary">{task.description}</div> : null}
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-4"><PanelEmpty icon={ClipboardList} title="No linked tasks yet" description="Create a task here to keep the next action attached to this record." /></div>
      )}
    </Card>
  );
}
