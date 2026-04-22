"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Button } from "@/components/ui/button";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
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
  type TaskAssigneeInput,
  type TaskPayload,
} from "@/hooks/useTasks";

type Props = {
  open: boolean;
  task: Task | null;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: TaskPayload) => Promise<void>;
};

type FormState = TaskPayload;

type SessionUser = {
  id?: number;
  team_id?: number | null;
};

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

function readSessionUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem("lynk_user");
    if (!raw) return null;
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
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

function hasAssignee(
  assignees: TaskAssigneeInput[],
  assigneeType: TaskAssigneeInput["assignee_type"],
  targetId: number,
) {
  return assignees.some((assignee) =>
    assignee.assignee_type === assigneeType &&
    (assigneeType === "user" ? assignee.user_id === targetId : assignee.team_id === targetId),
  );
}

export default function TaskDialog({
  open,
  task,
  isSubmitting = false,
  onClose,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const optionsQuery = useQuery({
    queryKey: ["task-assignment-options"],
    queryFn: fetchTaskAssignmentOptions,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!open) return;
    setSessionUser(readSessionUser());
    setForm(
      task
        ? {
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
          }
        : {
            ...emptyForm,
            assignees: sessionUser?.id
              ? [{ assignee_type: "user", user_id: sessionUser.id, team_id: null }]
              : [],
          },
    );
    setError(null);
  }, [open, task, sessionUser?.id]);

  const selectedAssigneeCount = form.assignees.length;

  const myUserOption = useMemo(
    () => optionsQuery.data?.users.find((user) => user.id === sessionUser?.id) ?? null,
    [optionsQuery.data?.users, sessionUser?.id],
  );
  const myTeamOption = useMemo(
    () => optionsQuery.data?.teams.find((team) => team.id === sessionUser?.team_id) ?? null,
    [optionsQuery.data?.teams, sessionUser?.team_id],
  );

  function toggleAssignee(assigneeType: TaskAssigneeInput["assignee_type"], targetId: number, checked: boolean) {
    setForm((current) => {
      const nextAssignees = checked
        ? [
            ...current.assignees,
            assigneeType === "user"
              ? { assignee_type: "user", user_id: targetId, team_id: null }
              : { assignee_type: "team", team_id: targetId, user_id: null },
          ]
        : current.assignees.filter((assignee) =>
            assigneeType === "user"
              ? !(assignee.assignee_type === "user" && assignee.user_id === targetId)
              : !(assignee.assignee_type === "team" && assignee.team_id === targetId),
          );
      return { ...current, assignees: nextAssignees };
    });
  }

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
                    Assign tasks to yourself, individual users, and teams. Team assignments notify the full team.
                  </FieldDescription>
                </div>
                <div className="text-xs uppercase tracking-[0.16em] text-neutral-500">
                  {selectedAssigneeCount} selected
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {myUserOption ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => toggleAssignee("user", myUserOption.id, !hasAssignee(form.assignees, "user", myUserOption.id))}
                  >
                    {hasAssignee(form.assignees, "user", myUserOption.id) ? "Remove Me" : "Assign To Me"}
                  </Button>
                ) : null}
                {myTeamOption ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      toggleAssignee("team", myTeamOption.id, !hasAssignee(form.assignees, "team", myTeamOption.id))
                    }
                  >
                    {hasAssignee(form.assignees, "team", myTeamOption.id) ? "Remove My Team" : "Assign My Team"}
                  </Button>
                ) : null}
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
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-neutral-800 bg-black/20">
                    <div className="border-b border-neutral-800 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                      Teams
                    </div>
                    <div className="max-h-60 space-y-2 overflow-y-auto p-3">
                      {(optionsQuery.data?.teams ?? []).map((team) => (
                        <label
                          key={team.id}
                          className="flex cursor-pointer items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950/50 px-3 py-2"
                        >
                          <Checkbox
                            checked={hasAssignee(form.assignees, "team", team.id)}
                            onCheckedChange={(checked) => toggleAssignee("team", team.id, checked === true)}
                            className="h-4 w-4 rounded border border-neutral-700 bg-neutral-900"
                          >
                            <CheckboxIndicator className="h-3 w-3" />
                          </Checkbox>
                          <div>
                            <div className="text-sm text-neutral-100">{team.name}</div>
                            <div className="text-xs text-neutral-500">
                              Team assignment notifies everyone currently in this team.
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-neutral-800 bg-black/20">
                    <div className="border-b border-neutral-800 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                      Users
                    </div>
                    <div className="max-h-60 space-y-2 overflow-y-auto p-3">
                      {(optionsQuery.data?.users ?? []).map((user) => (
                        <label
                          key={user.id}
                          className="flex cursor-pointer items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950/50 px-3 py-2"
                        >
                          <Checkbox
                            checked={hasAssignee(form.assignees, "user", user.id)}
                            onCheckedChange={(checked) => toggleAssignee("user", user.id, checked === true)}
                            className="h-4 w-4 rounded border border-neutral-700 bg-neutral-900"
                          >
                            <CheckboxIndicator className="h-3 w-3" />
                          </Checkbox>
                          <div className="min-w-0">
                            <div className="truncate text-sm text-neutral-100">{user.name}</div>
                            <div className="truncate text-xs text-neutral-500">
                              {user.team_name ? `${user.team_name} · ` : ""}
                              {user.email || "No email"}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={isSubmitting || !form.title.trim()}
            >
              {task ? "Save Task" : "Create Task"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
