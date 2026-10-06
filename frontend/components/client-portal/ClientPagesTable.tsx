"use client";

import Link from "next/link";
import { Copy, ExternalLink, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import { RecordTable } from "@/components/ui/RecordTable";
import { StatusValue } from "@/components/ui/StatusValue";
import type { ClientPage, ClientPortalSortState } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";
import { formatSnakeCaseLabel } from "@/lib/module-display";
import type { StatusTone } from "@/lib/statusStyles";

/**
 * The client pages table (rebuild.md 5.5).
 *
 * It was two hundred lines of column definitions inside `client-portal/page.tsx`, which is
 * the one thing §7.1 names as a review failure — a page-local table. The programme's own
 * rule is stricter: a sub-phase that ends with a shared shape still living in a page file
 * has not ended. Nothing about these columns is page state, so they are a component.
 *
 * `shellVariant="nested"` because it sits inside a `Card` that already draws the panel
 * edge. The inline version did not pass it and drew a second border one pixel inside the
 * first.
 */
/** Moved verbatim from `client-portal/page.tsx`; the extraction must not restate a rule. */
function statusTone(status: string): StatusTone {
  if (status === "active" || status === "published" || status === "accepted") {
    return "success";
  }
  if (status === "inactive" || status === "expired" || status === "revoked") {
    return "critical";
  }
  return "attention";
}

function actionLabel(action: string) {
  return action === "request_changes" ? "Requested changes" : action === "accept" ? "Accepted" : action;
}

export function ClientPagesTable({
  pages,
  customerLabel,
  sort,
  onSortChange,
  isLoading,
  isRefreshing,
  hasError,
  onRetry,
  onCopyLink,
  onPublish,
  isPublishing,
}: {
  pages: ClientPage[];
  customerLabel: (page: ClientPage) => string;
  sort: ClientPortalSortState;
  onSortChange: (column: string) => void;
  isLoading: boolean;
  isRefreshing: boolean;
  hasError: boolean;
  onRetry: () => void;
  onCopyLink: (link: string) => void;
  onPublish: (pageId: number) => void;
  isPublishing: boolean;
}) {
  return (
    <RecordTable
      label="Client pages"
      shellVariant="nested"
      columns={[
        {
          key: "title",
          label: "Page",
          size: "lg",
          sortable: true,
          render: (page) => (
            <div className="min-w-0">
              <div className="font-medium text-copy-primary">{page.title}</div>
              <div className="text-xs text-copy-muted">{page.summary || "No summary"}</div>
            </div>
          ),
        },
        { key: "customer", label: "Customer", render: (page) => <span className="text-copy-secondary">{customerLabel(page)}</span> },
        {
          key: "pricing",
          label: "Pricing",
          render: (page) => (
            <span className="text-copy-secondary">
              {page.pricing_items[0] ? (
                <Money amount={page.pricing_items[0].public_unit_price} currency={page.pricing_items[0].currency} />
              ) : (
                "No items"
              )}
            </span>
          ),
        },
        {
          key: "activity",
          label: "Activity",
          size: "lg",
          render: (page) =>
            page.latest_action ? (
              <div className="min-w-0">
                <div className="text-copy-primary">{actionLabel(page.latest_action.action)}</div>
                <div className="text-xs text-copy-muted">
                  {page.latest_action.actor_email || page.latest_action.actor_name || "Client response"} ·{" "}
                  {page.action_count} total
                </div>
              </div>
            ) : (
              <span className="text-copy-muted">No responses</span>
            ),
        },
        {
          key: "status",
          label: "Status",
          size: "sm",
          sortable: true,
          render: (page) => <StatusValue status={{ tone: statusTone(page.status), label: formatSnakeCaseLabel(page.status) }} />,
        },
        {
          key: "updated_at",
          label: "Updated",
          sortable: true,
          render: (page) => <span className="text-copy-muted">{formatDateTime(page.updated_at)}</span>,
        },
      ]}
      rows={pages}
      rowKey={(page) => page.id}
      sort={sort ? { column: sort.key, direction: sort.direction } : null}
      onSortChange={(next) => onSortChange(next.column)}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError}
      onRetry={onRetry}
      emptyState={{
        icon: Link2,
        title: "No client pages yet",
        description: "Create a private customer page, then publish a scoped link when it is ready.",
        action: (
          <Button asChild>
            <Link href="/dashboard/client-portal/pages/new">Create client page</Link>
          </Button>
        ),
      }}
      rowActions={(page) => (
        <div className="flex justify-end gap-2">
          {page.public_link ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onCopyLink(page.public_link as string)}>
              <Copy />
              Copy
            </Button>
          ) : null}
          {page.public_link ? (
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={page.public_link} target="_blank" rel="noreferrer">
                <ExternalLink />
                Open
              </a>
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={() => onPublish(page.id)} disabled={isPublishing}>
            <Link2 />
            Publish
          </Button>
        </div>
      )}
    />
  );
}
