"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import TaskAssigneePicker from "@/components/tasks/TaskAssigneePicker";
import { ActionBar } from "@/components/ui/ActionBar";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { PanelError, PanelLoading } from "@/components/ui/PanelStates";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchTaskAssignmentOptions,
  type Task,
  type TaskAssignmentTeamOption,
  type TaskAssignmentUserOption,
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
const EMPTY_USERS: TaskAssignmentUserOption[] = [];
const EMPTY_TEAMS: TaskAssignmentTeamOption[] = [];

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

function validateTaskForm(form: FormState) {
  if (!form.title.trim()) return "Task title is required.";
  if (form.title.trim().length > 255) return "Task title must be 255 characters or fewer.";
  if (form.start_at && form.due_at && new Date(form.due_at).getTime() < new Date(form.start_at).getTime()) {
    return "Due time must be after the start time.";
  }
  return null;
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
  const validationError = useMemo(() => validateTaskForm(form), [form]);
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
      const nextValidationError = validateTaskForm(form);
      if (nextValidationError) {
        setError(nextValidationError);
        return;
      }
      await onSubmit({
        ...form,
        title: form.title.trim(),
        description: form.description?.trim() || null,
      });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The task could not be saved.");
    }
  }

  async function handleDelete() {
    if (!task || !onDelete) return;
    const confirmed = await confirm({
      title: "Delete task?",
      description: `Delete "${task.title}"?`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      setError(null);
      await onDelete();
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The task could not be moved to the recycle bin.");
    }
  }

  async function runCalendarAction(action: (() => Promise<void>) | undefined, failureMessage: string) {
    if (!action) return;
    try {
      setError(null);
      await action();
    } catch {
      setError(failureMessage);
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel size="3xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{task ? "Edit task" : "Create task"}</DialogTitle>
            <DialogIconClose />
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error ? (
              <div role="alert" aria-live="polite" className="rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
                {error}
              </div>
            ) : null}

            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <Field className="md:col-span-2">
                <FieldLabel htmlFor="task-title">Task title <RequiredMark /></FieldLabel>
                <Input
                  id="task-title"
                  required
                  maxLength={255}
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Follow up with new opportunity stakeholders"
                />
              </Field>

              <Field className="md:col-span-2">
                <FieldLabel htmlFor="task-description">Description</FieldLabel>
                <Textarea
                  id="task-description"
                  rows={4}
                  value={form.description ?? ""}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Capture the work needed, expected handoff, and any customer context."
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="task-status">Status</FieldLabel>
                <Select
                  value={form.status}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      status: value as FormState["status"],
                      // Preserve existing completion timestamps while a task remains completed;
                      // stamp a fresh value only on the transition into completed.
                      completed_at:
                        value === "completed"
                          ? current.status === "completed"
                            ? current.completed_at ?? new Date().toISOString()
                            : new Date().toISOString()
                          : null,
                    }))
                  }
                >
                  <SelectTrigger id="task-status" className="w-full">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">To do</SelectItem>
                    <SelectItem value="in_progress">In progress</SelectItem>
                    <SelectItem value="blocked">Blocked</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="task-priority">Priority</FieldLabel>
                <Select
                  value={form.priority}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, priority: value as FormState["priority"] }))
                  }
                >
                  <SelectTrigger id="task-priority" className="w-full">
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
                <FieldLabel htmlFor="task-start">Start</FieldLabel>
                <Input
                  id="task-start"
                  type="datetime-local"
                  value={toDatetimeLocalValue(form.start_at)}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, start_at: toIsoOrNull(event.target.value) }))
                  }
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="task-due">Due</FieldLabel>
                <Input
                  id="task-due"
                  type="datetime-local"
                  value={toDatetimeLocalValue(form.due_at)}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, due_at: toIsoOrNull(event.target.value) }))
                  }
                />
                {validationError === "Due time must be after the start time." ? (
                  <FieldError>{validationError}</FieldError>
                ) : null}
              </Field>
            </FieldGroup>

            {/* R7: the section's name was `text-copy-primary`, as loud as the task title field under
                it, with its description borrowed from a form field. */}
            <section className="border-t border-line-subtle pt-4">
              <SectionHeading
                as="h3"
                description="Search and assign individual users or whole teams. Team assignments notify the full team."
                action={<span className="text-xs text-copy-muted tabular-nums">{selectedAssigneeCount} selected</span>}
              >
                Assignments
              </SectionHeading>

              {optionsQuery.isLoading ? (
                <PanelLoading label="Loading assignee options…" />
              ) : optionsQuery.error ? (
                <div className="mt-4">
                  <PanelError message="Task assignment options could not be loaded." onRetry={() => void optionsQuery.refetch()} />
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <TaskAssigneePicker
                    users={optionsQuery.data?.users ?? EMPTY_USERS}
                    teams={optionsQuery.data?.teams ?? EMPTY_TEAMS}
                    value={form.assignees}
                    onChange={(assignees) => setForm((current) => ({ ...current, assignees }))}
                    disabled={isSubmitting || isDeleting}
                  />
                  {task?.assigned_by_name ? (
                    <div className="text-xs text-copy-muted">
                      Last assigned by {task.assigned_by_name}
                      {task.assigned_at ? ` on ${formatDateTime(task.assigned_at)}` : ""}
                    </div>
                  ) : null}
                </div>
              )}
            </section>

            {/* The calendar's four buttons shared the footer with delete, cancel and save — six
                controls in the commit row, one of them a disabled *Already On Calendar* standing in
                for a sentence. They act on the task's calendar entry, not on the form, so they are
                a section of the body with its state written down. */}
            {task && (onAddToCalendar || linkedCalendarEvent) ? (
              <section className="space-y-3 border-t border-line-subtle pt-4">
                <SectionHeading
                  as="h3"
                  description={linkedCalendarEvent
                    ? `On the calendar${linkedCalendarEvent.start_at ? ` for ${formatDateTime(linkedCalendarEvent.start_at)}` : ""}.`
                    : "Not on the calendar."}
                >
                  Calendar
                </SectionHeading>
                <ActionBar size="sm" align="start">
                  {!linkedCalendarEvent && onAddToCalendar ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void runCalendarAction(onAddToCalendar, "The task could not be added to the calendar.")}
                      disabled={isSubmitting || isDeleting || isAddingToCalendar}
                    >
                      {isAddingToCalendar ? "Adding…" : "Add to calendar"}
                    </Button>
                  ) : null}
                  {linkedCalendarEvent && onOpenCalendarEvent ? (
                    <Button type="button" variant="outline" onClick={onOpenCalendarEvent} disabled={isSubmitting || isDeleting}>
                      Open calendar event
                    </Button>
                  ) : null}
                  {linkedCalendarEvent && onRemoveFromCalendar ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void runCalendarAction(onRemoveFromCalendar, "The task could not be removed from the calendar.")}
                      disabled={isSubmitting || isDeleting || isRemovingFromCalendar}
                    >
                      {isRemovingFromCalendar ? "Removing…" : "Remove from calendar"}
                    </Button>
                  ) : null}
                </ActionBar>
              </section>
            ) : null}
          </div>

          <DialogFooter className="mt-6">
            {task && onDelete ? (
              <Button
                type="button"
                variant="destructiveOutline"
                className="mr-auto"
                onClick={() => void handleDelete()}
                disabled={isSubmitting || isDeleting}
              >
                Move to recycle bin
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={isSubmitting || isDeleting || Boolean(validationError)}
            >
              {task ? "Save task" : "Create task"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
