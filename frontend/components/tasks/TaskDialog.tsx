"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import TaskAssigneePicker from "@/components/tasks/TaskAssigneePicker";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchTaskAssignmentOptions,
  type Task,
  type TaskPayload,
} from "@/hooks/useTasks";
import { useConfirm } from "@/hooks/useConfirm";
import type { CalendarEvent } from "@/hooks/useCalendar";
import { formatDateTime } from "@/lib/datetime";

type Props = {
  open: boolean;
  task: Task | null;
  isSubmitting?: boolean;
  isDeleting?: boolean;
  isAddingToCalendar?: boolean;
  isRemovingFromCalendar?: boolean;
  linkedCalendarEvent?: CalendarEvent | null;
  onClose: () => void;
  onSubmit: (payload: TaskPayload) => Promise<void>;
  onDelete?: () => Promise<void>;
  onAddToCalendar?: () => Promise<void>;
  onRemoveFromCalendar?: () => Promise<void>;
  onOpenCalendarEvent?: () => void;
};

type FormState = TaskPayload;

const emptyForm: FormState = {
  title: "",
  description: "",
  status: "todo",
  priority: "medium",
  start_at: null,
  due_at: null,
  completed_at: null,
  assignees: [],
};

function buildFormState(task: Task | null): FormState {
  if (!task) {
    return emptyForm;
  }

  return {
    title: task.title ?? "",
    description: task.description ?? "",
    status: task.status,
    priority: task.priority,
    start_at: task.start_at ?? null,
    due_at: task.due_at ?? null,
    completed_at: task.completed_at ?? null,
    assignees: task.assignees.map((assignee) => ({
      assignee_type: assignee.assignee_type,
      user_id: assignee.user_id ?? null,
      team_id: assignee.team_id ?? null,
    })),
  };
}

function toDatetimeLocalValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIsoOrNull(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export default function TaskDialog({
  open,
  task,
  isSubmitting = false,
  isDeleting = false,
  isAddingToCalendar = false,
  isRemovingFromCalendar = false,
  linkedCalendarEvent = null,
  onClose,
  onSubmit,
  onDelete,
  onAddToCalendar,
  onRemoveFromCalendar,
  onOpenCalendarEvent,
}: Props) {
  const { confirm } = useConfirm();
  const [form, setForm] = useState<FormState>(() => buildFormState(task));
  const [error, setError] = useState<string | null>(null);
  const optionsQuery = useQuery({
    queryKey: ["task-assignment-options"],
    queryFn: fetchTaskAssignmentOptions,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const selectedAssigneeCount = form.assignees.length;

  async function handleSubmit() {
    try {
      setError(null);
      await onSubmit({
        ...form,
        title: form.title.trim(),
        description: form.description?.trim() || null,
      });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save task");
    }
  }

  async function handleDelete() {
    if (!task || !onDelete) return;
    const confirmed = await confirm({
      title: "Move task to recycle bin?",
      description: `Move "${task.title}" to the recycle bin?`,
      confirmLabel: "Move to Recycle Bin",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      setError(null);
      await onDelete();
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete task");
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel size="3xl">
          <DialogHeader>
            <DialogTitle>{task ? "Edit Task" : "Create Task"}</DialogTitle>
            <DialogIconClose />
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error ? (
              <div className="rounded-md border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <Field className="md:col-span-2">
                <FieldLabel>Task Title</FieldLabel>
                <Input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Follow up with new opportunity stakeholders"
                />
              </Field>

              <Field className="md:col-span-2">
                <FieldLabel>Description</FieldLabel>
                <Textarea
                  rows={4}
                  value={form.description ?? ""}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Capture the work needed, expected handoff, and any customer context."
                />
              </Field>

              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select
                  value={form.status}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      status: value as FormState["status"],
                      completed_at:
                        value === "completed"
                          ? current.completed_at ?? new Date().toISOString()
                          : null,
                    }))
                  }
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

              <Field>
                <FieldLabel>Priority</FieldLabel>
                <Select
                  value={form.priority}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, priority: value as FormState["priority"] }))
                  }
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
                <FieldLabel>Start</FieldLabel>
                <Input
                  type="datetime-local"
                  value={toDatetimeLocalValue(form.start_at)}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, start_at: toIsoOrNull(event.target.value) }))
                  }
                />
              </Field>

              <Field>
                <FieldLabel>Due</FieldLabel>
                <Input
                  type="datetime-local"
                  value={toDatetimeLocalValue(form.due_at)}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, due_at: toIsoOrNull(event.target.value) }))
                  }
                />
              </Field>
            </FieldGroup>

            <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-neutral-100">Assignments</div>
                  <FieldDescription>
                    Search and assign individual users or whole teams. Team assignments notify the full team.
                  </FieldDescription>
                </div>
                <div className="text-xs uppercase tracking-[0.16em] text-neutral-500">
                  {selectedAssigneeCount} selected
                </div>
              </div>

              {optionsQuery.isLoading ? (
                <div className="mt-4 text-sm text-neutral-500">Loading assignee options…</div>
              ) : optionsQuery.error ? (
                <div className="mt-4 text-sm text-red-300">
                  {optionsQuery.error instanceof Error
                    ? optionsQuery.error.message
                    : "Failed to load assignment options."}
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <TaskAssigneePicker
                    users={optionsQuery.data?.users ?? []}
                    teams={optionsQuery.data?.teams ?? []}
                    value={form.assignees}
                    onChange={(assignees) => setForm((current) => ({ ...current, assignees }))}
                    disabled={isSubmitting || isDeleting}
                  />
                  {task?.assigned_by_name ? (
                    <div className="text-xs text-neutral-500">
                      Last assigned by {task.assigned_by_name}
                      {task.assigned_at ? ` on ${formatDateTime(task.assigned_at)}` : ""}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="mt-6">
            {task && onDelete ? (
              <Button
                type="button"
                variant="outline"
                className="mr-auto border-red-800/70 text-red-200 hover:bg-red-950/40 hover:text-red-100"
                onClick={() => void handleDelete()}
                disabled={isSubmitting || isDeleting}
              >
                Move To Recycle Bin
              </Button>
            ) : null}
            {task && onAddToCalendar ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void onAddToCalendar()}
                disabled={isSubmitting || isDeleting || isAddingToCalendar || Boolean(linkedCalendarEvent)}
              >
                {linkedCalendarEvent ? "Already On Calendar" : isAddingToCalendar ? "Adding..." : "Add To Calendar"}
              </Button>
            ) : null}
            {task && linkedCalendarEvent && onOpenCalendarEvent ? (
              <Button type="button" variant="outline" onClick={onOpenCalendarEvent} disabled={isSubmitting || isDeleting}>
                Open Calendar Event
              </Button>
            ) : null}
            {task && linkedCalendarEvent && onRemoveFromCalendar ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void onRemoveFromCalendar()}
                disabled={isSubmitting || isDeleting || isRemovingFromCalendar}
              >
                {isRemovingFromCalendar ? "Removing..." : "Remove From Calendar"}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={isSubmitting || isDeleting || !form.title.trim()}
            >
              {task ? "Save Task" : "Create Task"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
