"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CheckSquare, Columns3, Plus, Table2 } from "lucide-react";
import { toast } from "sonner";

import TaskDialog from "@/components/tasks/TaskDialog";
import TasksBoard from "@/components/tasks/TasksBoard";
import TasksCalendar from "@/components/tasks/TasksCalendar";
import TasksTable from "@/components/tasks/TasksTable";
import Pagination from "@/components/ui/Pagination";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { PageHeader } from "@/components/ui/PageHeader";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { Button } from "@/components/ui/button";
import { fetchTaskCalendarEvent, useCalendarActions } from "@/hooks/useCalendar";
import { fetchTask, useTasks, type Task, type TaskPayload, type TaskSortState } from "@/hooks/useTasks";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";

export default function TasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskIdParam = searchParams.get("taskId");
  const taskId = taskIdParam && /^\d+$/.test(taskIdParam) ? Number(taskIdParam) : null;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [displayMode, setDisplayMode] = useState<"list" | "board" | "calendar">("list");
  const [sort, setSort] = useState<TaskSortState>(null);
  const { fields: moduleFields } = useModuleFieldConfigs("tasks");
  const definition = useMemo(() => buildModuleViewDefinition("tasks", [], moduleFields), [moduleFields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.tasks;
  const {
    views,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
  } = useSavedViews("tasks", defaultConfig);
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
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
    updateTaskStatus,
    deleteTask,
    isSaving,
    isDeleting,
  } = useTasks(activeFilters, sort);
  const { allConditions, anyConditions } = getConditionGroups(activeFilters);
  const activeFilterCount = allConditions.length + anyConditions.length;
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

  async function handleStatusChange(task: Task, status: Task["status"]) {
    if (task.status === status) return;
    try {
      await updateTaskStatus(task, status);
      toast.success(`Task moved to ${status.replace(/_/g, " ")}.`);
    } catch (statusError) {
      toast.error(statusError instanceof Error ? statusError.message : "Task status could not be updated.");
    }
  }

  function clearFilters() {
    setDraftConfig((current) => ({
      ...current,
      filters: {
        ...current.filters,
        search: "",
        conditions: [],
        all_conditions: [],
        any_conditions: [],
      },
    }));
  }

  function changeDisplayMode(mode: "list" | "board" | "calendar") {
    setDisplayMode(mode);
    if (mode !== "list" && pageSize < 100) onPageSizeChange(100);
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
        eyebrow={totalCount ? `${totalCount} task${totalCount === 1 ? "" : "s"} in this view` : undefined}
        actions={
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add Task</span>
          </Button>
        }
      />

      <ModuleListToolbar
        searchValue={typeof activeFilters?.search === "string" ? activeFilters.search : ""}
        onSearchChange={(search) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search } }))}
        searchPlaceholder="Search tasks"
        filtersOpen={Boolean(activeFilters.filtersOpen)}
        activeFilterCount={activeFilterCount}
        onToggleFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen } }))}
        onClearFilters={clearFilters}
        viewControls={
          <>
            <SavedViewSelector moduleKey="tasks" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} />
            <div className="inline-flex rounded-md border border-line-default p-0.5" aria-label="Task display">
              <Button type="button" variant={displayMode === "list" ? "secondary" : "ghost"} size="sm" aria-pressed={displayMode === "list"} onClick={() => changeDisplayMode("list")}><Table2 />List</Button>
              <Button type="button" variant={displayMode === "board" ? "secondary" : "ghost"} size="sm" aria-pressed={displayMode === "board"} onClick={() => changeDisplayMode("board")}><Columns3 />Board</Button>
              <Button type="button" variant={displayMode === "calendar" ? "secondary" : "ghost"} size="sm" aria-pressed={displayMode === "calendar"} onClick={() => changeDisplayMode("calendar")}><CalendarDays />Calendar</Button>
            </div>
          </>
        }
      />

      <div className="rounded-xl border border-line-default bg-surface px-4 py-3 text-sm text-copy-muted">
        <div className="flex items-center gap-2 text-copy-secondary">
          <CheckSquare className="h-4 w-4" />
          Default task views hide completed work. Use Manage View to include a completed-task queue.
        </div>
      </div>

      <InlineSavedViewFilters
        filterFields={definition?.filterFields ?? []}
        filters={activeFilters}
        onChange={(nextFilters) => setDraftConfig((current) => ({ ...current, filters: nextFilters }))}
        hideHeader
      />

      {error ? (
        <div className="flex justify-between rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
          <span>{error}</span>
          <button onClick={() => void refresh()} className="underline underline-offset-2">Retry</button>
        </div>
      ) : null}

      {displayMode !== "list" ? (
        <div className="rounded-lg border border-line-default bg-surface px-4 py-3 text-sm text-copy-muted">
          Showing loaded records {rangeStart}-{rangeEnd} of {totalCount}. {displayMode === "board" ? "Drag cards between columns or use the status menu for keyboard access." : "Calendar placement follows each task's due date in your local timezone."}
        </div>
      ) : null}

      {displayMode === "list" ? (
        <TasksTable
          tasks={tasks}
          isLoading={isLoading}
          isRefreshing={isFetching && !isLoading}
          visibleColumns={visibleColumns}
          onEdit={openEditDialog}
          sort={sort}
          onSortChange={setSort}
        />
      ) : displayMode === "board" ? (
        <TasksBoard tasks={tasks} isLoading={isLoading} isRefreshing={isFetching && !isLoading} onOpen={openEditDialog} onStatusChange={handleStatusChange} />
      ) : (
        <TasksCalendar tasks={tasks} isLoading={isLoading} isRefreshing={isFetching && !isLoading} onOpen={openEditDialog} />
      )}

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
