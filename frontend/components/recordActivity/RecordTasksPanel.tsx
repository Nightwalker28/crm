"use client";

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { FieldDescription } from "@/components/ui/field";
import { fetchRecordTasks } from "@/hooks/useTasks";
import { formatDateTime } from "@/lib/datetime";

type Props = {
  moduleKey: string;
  entityId: string | number;
};

function statusLabel(status: string) {
  return status.replace(/_/g, " ");
}

export default function RecordTasksPanel({ moduleKey, entityId }: Props) {
  const query = useQuery({
    queryKey: ["record-tasks", moduleKey, String(entityId)],
    queryFn: () => fetchRecordTasks(moduleKey, entityId),
    staleTime: 30_000,
  });
  const tasks = query.data?.results ?? [];

  return (
    <Card className="px-5 py-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-100">Tasks & Reminders</h2>
          <FieldDescription className="mt-1">Follow-up tasks linked to this record.</FieldDescription>
        </div>
        <ClipboardList className="h-5 w-5 text-neutral-500" />
      </div>

      {query.isLoading ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-4 py-6 text-sm text-neutral-500">Loading tasks...</div>
      ) : query.error ? (
        <div className="rounded-md border border-red-900/50 bg-red-950/20 px-4 py-4 text-sm text-red-300">
          {query.error instanceof Error ? query.error.message : "Failed to load tasks."}
        </div>
      ) : tasks.length ? (
        <div className="space-y-3">
          {tasks.map((task) => (
            <Link
              key={task.id}
              href={`/dashboard/tasks?taskId=${task.id}`}
              className="block rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4 hover:border-neutral-700"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-neutral-100">{task.title}</div>
                  <div className="mt-1 text-xs capitalize text-neutral-500">
                    {statusLabel(task.status)} / {task.priority}
                  </div>
                </div>
                {task.due_at ? <div className="text-xs text-neutral-400">Due {formatDateTime(task.due_at)}</div> : null}
              </div>
              {task.description ? <div className="mt-2 line-clamp-2 text-sm text-neutral-400">{task.description}</div> : null}
            </Link>
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
