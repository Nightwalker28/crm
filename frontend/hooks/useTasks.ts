"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { SavedViewFilters } from "@/hooks/useSavedViews";

export type TaskStatus = "todo" | "in_progress" | "blocked" | "completed";
export type TaskPriority = "high" | "medium" | "low";
export type TaskAssigneeType = "user" | "team";

export type TaskAssigneeInput = {
  assignee_type: TaskAssigneeType;
  user_id?: number | null;
  team_id?: number | null;
};

export type TaskAssignee = {
  assignee_type: TaskAssigneeType;
  assignee_key: string;
  user_id?: number | null;
  team_id?: number | null;
  label: string;
};

export type Task = {
  id: number;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  start_at?: string | null;
  due_at?: string | null;
  completed_at?: string | null;
  source_module_key?: string | null;
  source_entity_id?: string | null;
  source_label?: string | null;
  created_by_user_id?: number | null;
  updated_by_user_id?: number | null;
  assigned_by_user_id?: number | null;
  created_by_name?: string | null;
  updated_by_name?: string | null;
  assigned_by_name?: string | null;
  assigned_at?: string | null;
  created_at: string;
  updated_at: string;
  assignees: TaskAssignee[];
};

export type TaskPayload = {
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  start_at?: string | null;
  due_at?: string | null;
  completed_at?: string | null;
  source_module_key?: string | null;
  source_entity_id?: string | null;
  source_label?: string | null;
  assignees: TaskAssigneeInput[];
};

export type TaskAssignmentUserOption = {
  id: number;
  name: string;
  email?: string | null;
  team_id?: number | null;
  team_name?: string | null;
};

export type TaskAssignmentTeamOption = {
  id: number;
  name: string;
  department_id?: number | null;
};

export type TaskAssignmentOptions = {
  users: TaskAssignmentUserOption[];
  teams: TaskAssignmentTeamOption[];
};

type TaskListResponse = {
  results: Task[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
  page_size: number;
};

function buildTaskListParams(page: number, pageSize: number, filters?: SavedViewFilters) {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });

  if (typeof filters?.search === "string" && filters.search.trim()) {
    params.set("query", filters.search.trim());
  }
  if (Array.isArray(filters?.all_conditions) && filters.all_conditions.length) {
    params.set("filters_all", JSON.stringify(filters.all_conditions));
  }
  if (Array.isArray(filters?.any_conditions) && filters.any_conditions.length) {
    params.set("filters_any", JSON.stringify(filters.any_conditions));
  }

  return params;
}

async function fetchTasks(page: number, pageSize: number, filters?: SavedViewFilters) {
  const res = await apiFetch(`/tasks?${buildTaskListParams(page, pageSize, filters).toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load tasks.");
  }
  return body as TaskListResponse;
}

async function createTask(payload: TaskPayload) {
  const res = await apiFetch("/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to create task.");
  }
  return body as Task;
}

async function updateTask(taskId: number, payload: TaskPayload) {
  const res = await apiFetch(`/tasks/${taskId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to update task.");
  }
  return body as Task;
}

async function deleteTask(taskId: number) {
  const res = await apiFetch(`/tasks/${taskId}`, {
    method: "DELETE",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to delete task.");
  }
}

export async function fetchTask(taskId: number) {
  const res = await apiFetch(`/tasks/${taskId}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load task.");
  }
  return body as Task;
}

export async function fetchTaskAssignmentOptions() {
  const res = await apiFetch("/tasks/options");
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (body && typeof body.detail === "string" && body.detail) ||
        "Failed to load task assignment options.",
    );
  }
  return body as TaskAssignmentOptions;
}

export async function fetchRecordTasks(moduleKey: string, entityId: string | number) {
  const params = new URLSearchParams({
    page: "1",
    page_size: "10",
    filters_all: JSON.stringify([
      { field: "source_module_key", operator: "is", value: moduleKey },
      { field: "source_entity_id", operator: "is", value: String(entityId) },
    ]),
  });
  const res = await apiFetch(`/tasks?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load record tasks.");
  }
  return body as TaskListResponse;
}

export function useTasks(filters?: SavedViewFilters) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const query = useQuery({
    queryKey: ["tasks", page, pageSize, filters],
    queryFn: () => fetchTasks(page, pageSize, filters),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: createTask,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["user-notifications"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ taskId, payload }: { taskId: number; payload: TaskPayload }) =>
      updateTask(taskId, payload),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["task", variables.taskId] });
      await queryClient.invalidateQueries({ queryKey: ["user-notifications"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTask,
    onSuccess: async (_, taskId) => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      await queryClient.invalidateQueries({ queryKey: ["user-notifications"] });
      await queryClient.invalidateQueries({ queryKey: ["recycle-bin"] });
    },
  });

  return {
    tasks: query.data?.results ?? [],
    page: query.data?.page ?? page,
    pageSize: query.data?.page_size ?? pageSize,
    totalPages: query.data?.total_pages ?? 0,
    totalCount: query.data?.total_count ?? 0,
    rangeStart: query.data?.range_start ?? 0,
    rangeEnd: query.data?.range_end ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error.message : null,
    goToPage: setPage,
    onPageSizeChange: (nextPageSize: number) => {
      setPageSize(nextPageSize);
      setPage(1);
    },
    refresh: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await query.refetch();
    },
    createTask: createMutation.mutateAsync,
    updateTask: (taskId: number, payload: TaskPayload) =>
      updateMutation.mutateAsync({ taskId, payload }),
    deleteTask: deleteMutation.mutateAsync,
    isSaving: createMutation.isPending || updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
