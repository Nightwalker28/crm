"use client";

import { useMemo, useState } from "react";
import {
  CalendarDays,
  CheckSquare,
  History,
  Mail,
  MessageCircle,
  PhoneCall,
  StickyNote,
  type LucideIcon,
} from "lucide-react";

import {
  RecordPanelEmpty,
  RecordPanelError,
  RecordPanelHeader,
  RecordPanelLoading,
} from "@/components/recordActivity/RecordPanelStates";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { useRecordActivity } from "@/hooks/useRecordActivity";
import { formatDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type {
  RecordActivityEnvelope,
  RecordActivityType,
  RecordModuleKey,
} from "@/types/record-activity";

/**
 * Relationship activity for one record.
 *
 * Each source keeps its own card body so an email or a WhatsApp message stays
 * readable rather than collapsing into a generic row. Immutable audit history
 * lives in its own region and is never mixed in here.
 */

type Props = {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  title?: string;
  description?: string;
};

type Filter = "all" | RecordActivityType;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "email", label: "Email" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "follow_up", label: "Follow-ups" },
  { id: "meeting", label: "Meetings" },
  { id: "task", label: "Tasks" },
  { id: "note", label: "Notes" },
];

const TYPE_ICONS: Record<RecordActivityType, LucideIcon> = {
  email: Mail,
  follow_up: PhoneCall,
  meeting: CalendarDays,
  note: StickyNote,
  task: CheckSquare,
  whatsapp: MessageCircle,
};

const TYPE_LABELS: Record<RecordActivityType, string> = {
  email: "Email",
  follow_up: "Follow-up",
  meeting: "Meeting",
  note: "Note",
  task: "Task",
  whatsapp: "WhatsApp",
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  call: "Call",
};

function metaString(item: RecordActivityEnvelope, key: string): string | null {
  const value = item.meta[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function metaList(item: RecordActivityEnvelope, key: string): string[] {
  const value = item.meta[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2 text-p-xs text-copy-muted">
      <span className="text-copy-label">{label}</span>
      <span className="min-w-0 break-words text-copy-secondary">{value}</span>
    </div>
  );
}

/** Domain-specific body per activity type. */
function ActivityBody({ item }: { item: RecordActivityEnvelope }) {
  switch (item.type) {
    case "email": {
      const from = metaString(item, "from_email");
      const to = metaList(item, "to_recipients");
      return (
        <div className="mt-2 grid gap-1">
          {from ? <DetailLine label="From" value={from} /> : null}
          {to.length ? <DetailLine label="To" value={to.join(", ")} /> : null}
          {item.summary ? <p className="mt-1 text-p-sm text-copy-secondary">{item.summary}</p> : null}
          {/* A send that never left is history too, but it must not read as a
              delivered email. */}
          {item.status === "failed" ? (
            <p className="mt-1 text-p-xs text-state-danger">This email was not delivered.</p>
          ) : null}
          {item.status === "sending" ? (
            <p className="mt-1 text-p-xs text-copy-muted">This email is still being sent.</p>
          ) : null}
        </div>
      );
    }
    case "whatsapp": {
      const phone = metaString(item, "phone_number");
      return (
        <div className="mt-2 grid gap-1">
          {phone ? <DetailLine label="To" value={phone} /> : null}
          {item.summary ? (
            <blockquote className="mt-1 border-l-2 border-line-default pl-3 text-p-sm text-copy-secondary">
              {item.summary}
            </blockquote>
          ) : null}
          <p className="mt-1 text-p-xs text-copy-muted">
            Opened in WhatsApp from Lynk. Delivery is not tracked in this mode.
          </p>
        </div>
      );
    }
    case "meeting": {
      const start = metaString(item, "start_at");
      const end = metaString(item, "end_at");
      const location = metaString(item, "location");
      const participants = metaList(item, "participants");
      return (
        <div className="mt-2 grid gap-1">
          {start ? (
            <DetailLine
              label="When"
              value={end ? `${formatDateTime(start)} – ${formatDateTime(end)}` : formatDateTime(start)}
            />
          ) : null}
          {location ? <DetailLine label="Where" value={location} /> : null}
          {participants.length ? <DetailLine label="With" value={participants.join(", ")} /> : null}
          {item.summary ? <p className="mt-1 text-p-sm text-copy-secondary">{item.summary}</p> : null}
        </div>
      );
    }
    case "task": {
      const due = metaString(item, "due_at");
      const assignees = metaList(item, "assignees");
      const priority = metaString(item, "priority");
      return (
        <div className="mt-2 grid gap-1">
          {due ? <DetailLine label="Due" value={formatDateTime(due)} /> : null}
          {assignees.length ? <DetailLine label="Assigned" value={assignees.join(", ")} /> : null}
          {priority ? <DetailLine label="Priority" value={priority} /> : null}
          {item.summary ? <p className="mt-1 text-p-sm text-copy-secondary">{item.summary}</p> : null}
        </div>
      );
    }
    case "follow_up": {
      const channel = metaString(item, "channel");
      return (
        <div className="mt-2 grid gap-1">
          {channel ? <DetailLine label="Channel" value={CHANNEL_LABELS[channel] ?? channel} /> : null}
          {item.summary ? <p className="mt-1 text-p-sm text-copy-secondary">{item.summary}</p> : null}
          {item.meta.follow_up_task_id ? (
            <p className="mt-1 text-p-xs text-copy-muted">A reminder task was created.</p>
          ) : null}
        </div>
      );
    }
    case "note":
    default:
      return item.summary ? (
        <p className="mt-2 text-p-sm text-copy-secondary">{item.summary}</p>
      ) : null;
  }
}

function ActivityCard({ item }: { item: RecordActivityEnvelope }) {
  const Icon = TYPE_ICONS[item.type] ?? History;
  return (
    <li className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-4">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-default bg-surface-raised"
          aria-hidden="true"
        >
          <Icon className="h-3.5 w-3.5 text-copy-muted" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill>{TYPE_LABELS[item.type] ?? item.type}</Pill>
            {item.direction ? <span className="text-p-xs text-copy-muted">{item.direction}</span> : null}
            {item.status ? <span className="text-p-xs text-copy-muted">{item.status.replace(/_/g, " ")}</span> : null}
            <span className="text-p-xs text-copy-muted">{formatDateTime(item.occurred_at)}</span>
          </div>
          <p className="mt-2 min-w-0 break-words text-sm font-medium text-copy-primary">{item.title}</p>
          {item.actor?.name ? (
            <p className="mt-0.5 text-p-xs text-copy-muted">{item.actor.name}</p>
          ) : null}
          <ActivityBody item={item} />
        </div>
      </div>
    </li>
  );
}

export default function RecordActivityFeed({
  moduleKey,
  entityId,
  title = "Activity",
  description = "Emails, messages, meetings, tasks, notes, and follow-ups for this record.",
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const types = filter === "all" ? null : [filter];
  const query = useRecordActivity({ moduleKey, entityId, types });

  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const omittedTypes = query.data?.pages[0]?.omitted_types ?? [];
  const hasLoadedHistory = items.length > 0;

  return (
    <Card className="px-5 py-5">
      <RecordPanelHeader title={title} description={description} icon={History} />

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter activity by type">
        {FILTERS.map((option) => {
          const active = filter === option.id;
          return (
            <Button
              key={option.id}
              type="button"
              size="sm"
              variant={active ? "default" : "outline"}
              aria-pressed={active}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </Button>
          );
        })}
      </div>

      {omittedTypes.length ? (
        <p className="mt-3 text-p-xs text-copy-muted" role="status">
          Some sources are hidden because you do not have access to them:{" "}
          {omittedTypes.map((type) => TYPE_LABELS[type] ?? type).join(", ")}.
        </p>
      ) : null}

      {query.isLoading ? (
        <div className="mt-4">
          <RecordPanelLoading label="Loading activity…" />
        </div>
      ) : query.error && !hasLoadedHistory ? (
        <div className="mt-4">
          <RecordPanelError message="Activity could not be loaded." onRetry={() => void query.refetch()} />
        </div>
      ) : hasLoadedHistory ? (
        <>
          <ol className="mt-4 grid gap-3" aria-label={`${title} entries`}>
            {items.map((item) => (
              <ActivityCard key={item.id} item={item} />
            ))}
          </ol>

          {/* A failed "load more" keeps the history already on screen. */}
          {query.error ? (
            <p className="mt-3 text-p-xs text-state-danger" role="alert">
              More activity could not be loaded.
            </p>
          ) : null}

          {query.hasNextPage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </>
      ) : (
        <div className={cn("mt-4")}>
          <RecordPanelEmpty
            icon={History}
            title={filter === "all" ? "No activity yet" : "No activity of this type"}
            description={
              filter === "all"
                ? "Log a follow-up, add a note, or create a task and it will appear here."
                : "Try a different filter to see the rest of this record's history."
            }
          />
        </div>
      )}
    </Card>
  );
}
