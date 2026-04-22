"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare, Plus } from "lucide-react";
import { toast } from "sonner";

import TaskDialog from "@/components/tasks/TaskDialog";
import TasksTable from "@/components/tasks/TasksTable";
import Pagination from "@/components/ui/Pagination";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { PageHeader } from "@/components/ui/PageHeader";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import SearchBar from "@/components/ui/SearchBar";
import { Button } from "@/components/ui/button";
import { fetchTask, useTasks, type Task, type TaskPayload } from "@/hooks/useTasks";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS } from "@/lib/moduleViewConfigs";

export default function TasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskIdParam = searchParams.get("taskId");
  const taskId = taskIdParam && /^\d+$/.test(taskIdParam) ? Number(taskIdParam) : null;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const definition = useMemo(() => buildModuleViewDefinition("tasks"), []);
  const {
    views,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
  } = useSavedViews("tasks", MODULE_VIEW_DEFAULTS.tasks);
  const visibleColumns =
    draftConfig.visible_columns?.length
      ? draftConfig.visible_columns
      : MODULE_VIEW_DEFAULTS.tasks.visible_columns;
  const {
    tasks,
    page,
    pageSize,
    totalPages,
    totalCount,
    rangeStart,
    rangeEnd,
    isLoading,
    isFetching,
    error,
    goToPage,
    onPageSizeChange,
    refresh,
    createTask,
    updateTask,
    isSaving,
  } = useTasks(draftConfig.filters);
  const taskDetailQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => fetchTask(taskId as number),
    enabled: Boolean(taskId),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!taskId) return;
    if (taskDetailQuery.data) {
      setSelectedTask(taskDetailQuery.data);
      setDialogOpen(true);
    }
  }, [taskDetailQuery.data, taskId]);

  useEffect(() => {
    if (!taskId || !taskDetailQuery.error) return;
    toast.error(taskDetailQuery.error instanceof Error ? taskDetailQuery.error.message : "Failed to load task.");
    router.replace("/dashboard/tasks");
  }, [taskDetailQuery.error, taskId, router]);

  function openCreateDialog() {
    setSelectedTask(null);
    setDialogOpen(true);
    router.replace("/dashboard/tasks");
  }

  function openEditDialog(task: Task) {
    setSelectedTask(task);
    setDialogOpen(true);
    router.replace(`/dashboard/tasks?taskId=${task.id}`);
  }

  function closeDialog() {
    setDialogOpen(false);
    setSelectedTask(null);
    router.replace("/dashboard/tasks");
  }

  async function handleSubmit(payload: TaskPayload) {
    if (selectedTask) {
      await updateTask(selectedTask.id, payload);
      toast.success("Task updated.");
      return;
    }
    await createTask(payload);
    toast.success("Task created.");
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tasks"
        description="Coordinate team work, assign follow-ups, and turn notifications into actionable next steps."
        actions={
          <>
            <SavedViewSelector
              moduleKey="tasks"
              views={views}
              selectedViewId={selectedViewId}
              onSelect={setSelectedViewId}
            />
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Add Task</span>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_auto]">
        <SearchBar
          value={typeof draftConfig.filters?.search === "string" ? draftConfig.filters.search : ""}
          onChange={(value) =>
            setDraftConfig((current) => ({
              ...current,
              filters: {
                ...current.filters,
                search: value,
              },
            }))
          }
          placeholder="Search tasks"
        />

        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 px-4 py-3 text-sm text-neutral-400">
          <div className="flex items-center gap-2 text-neutral-200">
            <CheckSquare className="h-4 w-4 text-neutral-500" />
            Task notifications route into the shared notification center and browser alerts.
          </div>
        </div>
      </div>

      <InlineSavedViewFilters
        filterFields={definition?.filterFields ?? []}
        filters={draftConfig.filters}
        onChange={(nextFilters) =>
          setDraftConfig((current) => ({
            ...current,
            filters: nextFilters,
          }))
        }
      />

      {error ? (
        <div className="flex justify-between rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
          <span>{error}</span>
          <button onClick={() => void refresh()} className="underline underline-offset-2">
            Retry
          </button>
        </div>
      ) : null}

      <TasksTable
        tasks={tasks}
        isLoading={isLoading}
        isRefreshing={isFetching && !isLoading}
        visibleColumns={visibleColumns}
        onEdit={openEditDialog}
      />

      <Pagination
        page={page}
        totalPages={totalPages}
        totalCount={totalCount}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        pageSize={pageSize}
        isRefreshing={isFetching && !isLoading}
        onPageChange={goToPage}
        onPageSizeChange={onPageSizeChange}
      />

      <TaskDialog
        open={dialogOpen}
        task={selectedTask}
        isSubmitting={isSaving}
        onClose={closeDialog}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
