"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

type ActivityItem = {
  id: number;
  actor_user_id?: number | null;
  module_key: string;
  entity_type: string;
  entity_id: string;
  action: string;
  description?: string | null;
  created_at: string;
};

type ActivityResponse = {
  results: ActivityItem[];
};

type Props = {
  moduleKey: "sales_contacts" | "sales_organizations" | "sales_opportunities";
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
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load record activity.");
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-100">{title}</h2>
          <p className="mt-1 text-sm text-neutral-500">{description}</p>
        </div>
        <ClipboardList className="mt-1 h-4 w-4 text-neutral-500" />
      </div>

      {query.isLoading ? (
        <div className="mt-4 text-sm text-neutral-500">Loading activity…</div>
      ) : query.error ? (
        <div className="mt-4 rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {query.error instanceof Error ? query.error.message : "Failed to load activity timeline."}
        </div>
      ) : query.data?.results.length ? (
        <div className="mt-4 space-y-3">
          {query.data.results.map((item) => (
            <div key={item.id} className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-neutral-300">
                  {getActionLabel(item.action)}
                </span>
                <span className="text-xs text-neutral-500">{formatDateTime(item.created_at)}</span>
              </div>
              <div className="mt-2 text-sm text-neutral-200">
                {item.description || `${item.entity_type} ${item.entity_id}`}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-neutral-800 bg-neutral-950/40 px-4 py-6 text-sm text-neutral-500">
          No recorded activity for this record yet.
        </div>
      )}
    </Card>
  );
}
