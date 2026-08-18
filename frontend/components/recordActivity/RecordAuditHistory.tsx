"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";

import { PanelEmpty, PanelError, PanelLoading } from "@/components/ui/PanelStates";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import type { ActivityItem, RecordModuleKey } from "@/types/record-activity";

type ActivityResponse = {
  results: ActivityItem[];
};

type Props = {
  moduleKey: RecordModuleKey;
  entityId: string | number;
};

/**
 * The record's immutable audit history — every change written to `activity_logs`.
 *
 * This was `RecordActivityTimeline`, and it was renamed for a reason worth keeping: the
 * *feed* is now the `Timeline` tab, so the old name meant the opposite of what it does.
 * Two components called "timeline" showing different stores is exactly the kind of drift
 * `design.md` §1.6 exists to stop.
 *
 * It renders inside the spine's `History` sheet rather than as a tab. §4.7 records why:
 * audit is consulted occasionally, so a permanent tab beside three constantly-used ones is
 * furniture — and the sheet sits next to the `Updated 2h ago` line that prompts the
 * question in the first place.
 *
 * Rows are `divide-y` lines, not boxes. R8: a repeated item that is not interactive is not
 * a box, and this list was one of the five files that ruling names.
 */
export default function RecordAuditHistory({ moduleKey, entityId }: Props) {
  const query = useQuery({
    queryKey: ["record-audit-history", moduleKey, String(entityId)],
    queryFn: async () => {
      const params = new URLSearchParams({
        module_key: moduleKey,
        entity_id: String(entityId),
        page: "1",
        page_size: "25",
      });
      const res = await apiFetch(`/activity/record?${params.toString()}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error("Record history could not be loaded.");
      return body as ActivityResponse;
    },
    staleTime: 30000,
  });

  if (query.isLoading) return <PanelLoading label="Loading history…" />;
  if (query.error) {
    return (
      <PanelError
        message="Record history could not be loaded."
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!query.data?.results.length) {
    return (
      <PanelEmpty
        icon={ClipboardList}
        title="No recorded changes yet"
        description="Edits to this record will be listed here as they happen."
      />
    );
  }

  return (
    <ol className="divide-y divide-line-subtle" aria-label="Record history">
      {query.data.results.map((item) => (
        <li key={item.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-sm text-copy-primary">
              {item.description || `${item.entity_type} ${item.entity_id}`}
            </span>
            <time dateTime={item.created_at} className="text-xs text-copy-muted">
              {formatDateTime(item.created_at)}
            </time>
          </div>
          <div className="mt-1 text-xs text-copy-muted">{item.action.replace(/_/g, " ")}</div>
        </li>
      ))}
    </ol>
  );
}
