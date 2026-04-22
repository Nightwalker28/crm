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
import { fetchTaskCalendarEvent, useCalendarActions } from "@/hooks/useCalendar";
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
    deleteTask,
    isSaving,
    isDeleting,
  } = useTasks(draftConfig.filters);
  const {
    createEventFromTask,
    deleteTaskCalendarEvent,
    isCreatingFromTask,
    isRemovingTaskCalendarEvent,
  } = useCalendarActions();
  const taskDetailQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => fetchTask(taskId as number),
    enabled: Boolean(taskId),
    staleTime: 30_000,
  });
  const activeTask = taskId ? (taskDetailQuery.data ?? selectedTask) : selectedTask;
  const linkedCalendarEventQuery = useQuery({
    queryKey: ["task-calendar-event", activeTask?.id],
    queryFn: () => fetchTaskCalendarEvent(activeTask!.id),
    enabled: Boolean(activeTask?.id),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!taskId || !taskDetailQuery.error) return;
    toast.error(taskDetailQuery.error instanceof Error ? taskDetailQuery.error.message : "Failed to load task.");
    router.replace("/dashboard/tasks");
  }, [taskDetailQuery.error, taskId, router]);

  const isDialogOpen = taskId ? Boolean(activeTask) : dialogOpen;
  const dialogKey = `${isDialogOpen ? "open" : "closed"}-${activeTask?.id ?? "new"}-${activeTask?.updated_at ?? "none"}`;

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
    if (activeTask) {
      await updateTask(activeTask.id, payload);
      toast.success("Task updated.");
      return;
    }
    await createTask(payload);
    toast.success("Task created.");
  }

  async function handleDelete() {
    if (!activeTask) return;
    await deleteTask(activeTask.id);
    toast.success("Task moved to the recycle bin.");
  }

  async function handleAddToCalendar() {
    if (!activeTask) return;
    const result = await createEventFromTask(activeTask.id);
    toast.success(result.reused_existing ? "Opened existing calendar event for this task." : "Task added to calendar.");
    closeDialog();
    router.push(`/dashboard/calendar?eventId=${result.event.id}`);
  }

  async function handleRemoveFromCalendar() {
    if (!activeTask) return;
    await deleteTaskCalendarEvent(activeTask.id);
    toast.success("Task event removed from calendar.");
  }

  function handleOpenCalendarEvent() {
    const eventId = linkedCalendarEventQuery.data?.event?.id;
    if (!eventId) return;
    closeDialog();
    router.push(`/dashboard/calendar?eventId=${eventId}`);
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
            Default task views hide completed work. Use Manage View if you want a completed-task queue beside active work.
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
        key={dialogKey}
        open={isDialogOpen}
        task={activeTask}
        isSubmitting={isSaving}
        isDeleting={isDeleting}
        isAddingToCalendar={isCreatingFromTask}
        isRemovingFromCalendar={isRemovingTaskCalendarEvent}
        linkedCalendarEvent={linkedCalendarEventQuery.data?.event ?? null}
        onClose={closeDialog}
        onSubmit={handleSubmit}
        onDelete={activeTask ? handleDelete : undefined}
        onAddToCalendar={activeTask ? handleAddToCalendar : undefined}
        onRemoveFromCalendar={activeTask ? handleRemoveFromCalendar : undefined}
        onOpenCalendarEvent={linkedCalendarEventQuery.data?.event ? handleOpenCalendarEvent : undefined}
      />
    </div>
  );
}
