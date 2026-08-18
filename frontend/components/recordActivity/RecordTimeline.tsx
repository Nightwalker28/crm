"use client";

import { useMemo, useState, type ComponentProps } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckSquare,
  History,
  Mail,
  MessageCircle,
  MessagesSquare,
  PhoneCall,
  StickyNote,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import RecordTimelineComposer from "@/components/recordActivity/RecordTimelineComposer";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/ui/PanelStates";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { useConfirm } from "@/hooks/useConfirm";
import { useRecordActivity } from "@/hooks/useRecordActivity";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import type {
  RecordActivityEnvelope,
  RecordActivityType,
  RecordModuleKey,
} from "@/types/record-activity";

/**
 * The `Timeline` tab — one composer over one feed.
 *
 * This was `RecordActivityFeed`, and the rebuild is structural rather than cosmetic.
 * `CrmRecordActivitySection` used to render Activity, Notes, Documents and Tasks as a
 * *second* tab strip inside the page's own — the nested-tabs defect at
 * `opportunities/[opportunityId]` and `finance/pos/[invoiceId]`. The archetype owns the
 * only strip now, so those panels are the archetype's tabs and the notes list is gone:
 * the feed already emits `type="note"`, and rendering the same rows twice was the
 * duplication this sub-phase was called on to remove.
 *
 * Entries are `divide-y` lines, not cards. R8 names this list directly — a repeated item
 * that is not interactive is not a box — and it was one of the five files split between
 * two different box recipes for one role.
 *
 * Immutable audit history is still a separate store and still not mixed in here; it lives
 * in the spine's `History` sheet (§4.7).
 */

type Props = {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  /** Enables the composer's note mode, and deleting a note from its own entry. */
  canEdit?: boolean;
  composer?: Omit<ComponentProps<typeof RecordTimelineComposer>, "moduleKey" | "entityId" | "canAddNote">;
};

type Filter = "all" | RecordActivityType;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "note", label: "Notes" },
  { id: "case_reply", label: "Replies" },
  { id: "email", label: "Email" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "follow_up", label: "Follow-ups" },
  { id: "meeting", label: "Meetings" },
  { id: "task", label: "Tasks" },
];

const TYPE_ICONS: Record<RecordActivityType, LucideIcon> = {
  case_reply: MessagesSquare,
  email: Mail,
  follow_up: PhoneCall,
  meeting: CalendarDays,
  note: StickyNote,
  task: CheckSquare,
  whatsapp: MessageCircle,
};

const TYPE_LABELS: Record<RecordActivityType, string> = {
  case_reply: "Reply",
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

/** Domain-specific body per activity type — an email must not read like a note. */
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
    case "case_reply":
    case "note":
    default:
      return item.summary ? (
        <p className="mt-2 whitespace-pre-wrap text-p-sm text-copy-secondary">{item.summary}</p>
      ) : null;
  }
}

function ActivityRow({
  item,
  onDelete,
}: {
  item: RecordActivityEnvelope;
  onDelete?: () => void;
}) {
  const Icon = TYPE_ICONS[item.type] ?? History;
  return (
    <li className="flex min-w-0 items-start gap-3 py-4 first:pt-0 last:pb-0">
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-subtle"
        aria-hidden="true"
      >
        <Icon className="h-3.5 w-3.5 text-copy-muted" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 break-words text-sm text-copy-primary">{item.title}</p>
          <time dateTime={item.occurred_at} className="shrink-0 text-p-xs text-copy-muted">
            {formatDateTime(item.occurred_at)}
          </time>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-p-xs text-copy-muted">
          <span>{TYPE_LABELS[item.type] ?? item.type}</span>
          {item.actor?.name ? <span>· {item.actor.name}</span> : null}
          {item.meta.is_internal === true ? <span>· Internal</span> : null}
        </div>
        <ActivityBody item={item} />
      </div>
      {onDelete ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-copy-muted hover:bg-state-danger-muted hover:text-state-danger"
          onClick={onDelete}
          aria-label={`Delete ${TYPE_LABELS[item.type]?.toLocaleLowerCase() ?? "entry"}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : null}
    </li>
  );
}

export default function RecordTimeline({
  moduleKey,
  entityId,
  canEdit = false,
  composer,
}: Props) {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [filter, setFilter] = useState<Filter>("all");
  const types = filter === "all" ? null : [filter];
  const query = useRecordActivity({ moduleKey, entityId, types });

  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const omittedTypes = query.data?.pages[0]?.omitted_types ?? [];
  const hasLoadedHistory = items.length > 0;

  // `available_types` is what this record type *can* have and the viewer may see, so a
  // lead never offers a Replies filter. Held across filtered fetches: narrowing to Notes
  // must not collapse the strip to "All · Notes" and strand the operator there.
  const [availableTypes, setAvailableTypes] = useState<RecordActivityType[]>([]);
  const reportedTypes = query.data?.pages[0]?.available_types;
  if (reportedTypes && filter === "all" && reportedTypes.join() !== availableTypes.join()) {
    setAvailableTypes(reportedTypes);
  }
  const availableFilters = FILTERS.filter(
    (option) => option.id === "all" || availableTypes.includes(option.id),
  );

  // A note is the one entry the operator authored and can take back. It moved here with
  // the notes list it used to live in — dropping the affordance along with the panel would
  // have made a note permanent, which is not a design decision anyone took.
  async function deleteNote(item: RecordActivityEnvelope) {
    const confirmed = await confirm({
      title: "Delete note?",
      description: "Delete this internal note? This action cannot be undone.",
      confirmLabel: "Delete note",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      const res = await apiFetch(`/record-comments/${item.source.record_id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("not-deleted");
      await queryClient.invalidateQueries({
        queryKey: ["record-activity", moduleKey, String(entityId)],
      });
      toast.success("Note deleted.");
    } catch {
      toast.error("The note could not be deleted. Try again.");
    }
  }

  return (
    <Card className="px-5 py-5">
      <RecordTimelineComposer
        moduleKey={moduleKey}
        entityId={entityId}
        canAddNote={canEdit}
        {...composer}
      />

      {/* Only the sources this record actually has. The backend already reports them, and
          eight fixed filters on a record with two of them is furniture — it also kept the
          strip from fitting the content region beside the spine. */}
      {availableFilters.length > 1 ? (
        <SegmentedControl
          value={filter}
          onValueChange={(next: Filter) => setFilter(next)}
          aria-label="Filter the timeline by type"
          className="mt-5"
        >
          {availableFilters.map((option) => (
            <SegmentedItem key={option.id} value={option.id}>
              {option.label}
            </SegmentedItem>
          ))}
        </SegmentedControl>
      ) : null}

      {omittedTypes.length ? (
        <p className="mt-3 text-p-xs text-copy-muted" role="status">
          Some sources are hidden because you do not have access to them:{" "}
          {omittedTypes.map((type) => TYPE_LABELS[type] ?? type).join(", ")}.
        </p>
      ) : null}

      {query.isLoading ? (
        <div className="mt-4">
          <PanelLoading label="Loading the timeline…" />
        </div>
      ) : query.error && !hasLoadedHistory ? (
        <div className="mt-4">
          <PanelError message="The timeline could not be loaded." onRetry={() => void query.refetch()} />
        </div>
      ) : hasLoadedHistory ? (
        <>
          <ol className="mt-4 divide-y divide-line-subtle" aria-label="Timeline entries">
            {items.map((item) => (
              <ActivityRow
                key={item.id}
                item={item}
                onDelete={
                  canEdit && item.type === "note" ? () => void deleteNote(item) : undefined
                }
              />
            ))}
          </ol>

          {/* A failed "load more" keeps the history already on screen. */}
          {query.error ? (
            <p className="mt-3 text-p-xs text-state-danger" role="alert">
              More of the timeline could not be loaded.
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
        <div className="mt-4">
          <PanelEmpty
            icon={History}
            title={filter === "all" ? "Nothing on the timeline yet" : "Nothing of this type yet"}
            description={
              filter === "all"
                ? "Add a note or log a call above and it will appear here."
                : "Try a different filter to see the rest of this record's history."
            }
          />
        </div>
      )}
    </Card>
  );
}
