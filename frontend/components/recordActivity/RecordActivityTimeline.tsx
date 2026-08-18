"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";

import {
  PanelEmpty,
  PanelError,
  PanelHeader,
  PanelLoading,
} from "@/components/ui/PanelStates";
import { Card } from "@/components/ui/Card";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import type { ActivityItem, RecordModuleKey } from "@/types/record-activity";

type ActivityResponse = {
  results: ActivityItem[];
};

type Props = {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  title?: string;
  description?: string;
};

async function fetchRecordActivity(moduleKey: Props["moduleKey"], entityId: string | number): Promise<ActivityResponse> {
  const params = new URLSearchParams({
    module_key: moduleKey,
    entity_id: String(entityId),
    page: "1",
    page_size: "10",
  });
  const res = await apiFetch(`/activity/record?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error("Record activity could not be loaded.");
  }
  return body as ActivityResponse;
}

function getActionLabel(action: string) {
  return action.replace(/_/g, " ");
}

export default function RecordActivityTimeline({
  moduleKey,
  entityId,
  title = "Activity Timeline",
  description = "Chronological changes recorded for this record.",
}: Props) {
  const query = useQuery({
    queryKey: ["record-activity", moduleKey, String(entityId)],
    queryFn: () => fetchRecordActivity(moduleKey, entityId),
    staleTime: 30000,
  });

  return (
    <Card className="px-5 py-5">
      <PanelHeader title={title} description={description} icon={ClipboardList} />

      {query.isLoading ? (
        <div className="mt-4"><PanelLoading label="Loading activity…" /></div>
      ) : query.error ? (
        <div className="mt-4"><PanelError message="Record activity could not be loaded." onRetry={() => void query.refetch()} /></div>
      ) : query.data?.results.length ? (
        <ol className="mt-4 space-y-3" aria-label={`${title} entries`}>
          {query.data.results.map((item) => (
            <li key={item.id} className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-line-default bg-surface-raised px-2 py-1 text-[11px] font-medium text-copy-secondary">
                  {getActionLabel(item.action)}
                </span>
                <span className="text-xs text-copy-muted">{formatDateTime(item.created_at)}</span>
              </div>
              <div className="mt-2 text-p-sm text-copy-secondary">
                {item.description || `${item.entity_type} ${item.entity_id}`}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-4"><PanelEmpty icon={ClipboardList} title="No recorded activity yet" description="Record changes and collaboration events will appear here." /></div>
      )}
    </Card>
  );
}
