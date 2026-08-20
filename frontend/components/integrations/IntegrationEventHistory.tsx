"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radio, RefreshCw } from "lucide-react";

import { ActionBar } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/button";
import { RecordTable, type RecordTableColumn } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
import { ApiError, apiFetch, isForbiddenError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import type { StatusTone } from "@/lib/statusStyles";

type CrmEventDelivery = {
  id: number;
  provider: string;
  status: string;
  channel_name: string | null;
};

type CrmEvent = {
  id: number;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  deliveries: CrmEventDelivery[];
};

type EventFilters = {
  event_type: string;
  delivery_status: string;
};

const eventTypeOptions = [
  { value: "all", label: "All Events" },
  { value: "lead.created", label: "Lead Created" },
  { value: "deal.assigned", label: "Deal Assigned" },
  { value: "invoice.overdue", label: "Invoice Overdue" },
  { value: "task.assigned", label: "Task Assigned" },
  { value: "task.due_today", label: "Task Due Today" },
];

const deliveryStatusOptions = [
  { value: "all", label: "All Deliveries" },
  { value: "delivered", label: "Delivered" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
];

function humanizeEventType(value: string) {
  return value
    .split(".")
    .map((part) => part.replace(/_/g, " "))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function eventTitle(event: CrmEvent) {
  const payload = event.payload ?? {};
  const candidates = [
    payload.lead_name,
    payload.deal_name,
    payload.invoice_number,
    payload.task_title,
    payload.contact_name,
  ];
  const title = candidates.find((value) => typeof value === "string" && value.trim());
  return typeof title === "string" ? title : `${event.entity_type} #${event.entity_id}`;
}

function deliveryStatusTone(status: string): StatusTone {
  if (status === "delivered") return "success";
  if (status === "failed") return "critical";
  return "attention";
}

async function fetchCrmEvents(filters: EventFilters) {
  const params = new URLSearchParams({ page: "1", page_size: "10" });
  if (filters.event_type !== "all") params.set("event_type", filters.event_type);
  if (filters.delivery_status !== "all") params.set("delivery_status", filters.delivery_status);
  const res = await apiFetch(`/admin/crm-events?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, "event-history-unavailable");
  return Array.isArray(body?.results) ? body.results as CrmEvent[] : [];
}

/**
 * R10, and the three states this panel used to draw itself.
 *
 * It carried a hardcoded `min-w-[980px]` — wrong the moment a column is not shown — a
 * loading row that was the words "Loading event history...", an empty row that was the
 * words "No CRM events found.", and an error banner *above* the table that left the table
 * rendering an empty body underneath it. `RecordTable` owns all four §7.4 states, so the
 * panel keeps only its filters.
 */
export function IntegrationEventHistory() {
  const [filters, setFilters] = useState<EventFilters>({ event_type: "all", delivery_status: "all" });
  const filtersKey = `${filters.event_type}:${filters.delivery_status}`;
  const eventsQuery = useQuery({
    queryKey: ["integrations", "crm-events", filtersKey],
    queryFn: () => fetchCrmEvents(filters),
  });

  const events = eventsQuery.data ?? [];
  const loading = eventsQuery.isLoading;
  const hasFilters = filters.event_type !== "all" || filters.delivery_status !== "all";

  const columns: RecordTableColumn<CrmEvent>[] = [
    {
      key: "event",
      label: "Event",
      size: "lg",
      render: (event) => (
        <>
          <div className="font-medium text-copy-primary">{humanizeEventType(event.event_type)}</div>
          <div className="mt-1 truncate text-xs text-copy-muted">{eventTitle(event)}</div>
        </>
      ),
    },
    {
      key: "record",
      label: "Record",
      size: "sm",
      render: (event) => (
        <>
          <div className="text-sm text-copy-secondary">{event.entity_type}</div>
          <div className="text-xs tabular-nums text-copy-muted">{event.entity_id}</div>
        </>
      ),
    },
    {
      key: "deliveries",
      label: "Deliveries",
      size: "lg",
      render: (event) =>
        event.deliveries.length ? (
          <div className="flex flex-wrap gap-2">
            {event.deliveries.map((delivery) => (
              <StatusValue
                key={delivery.id}
                status={{
                  tone: deliveryStatusTone(delivery.status),
                  label: `${delivery.provider}${delivery.channel_name ? ` - ${delivery.channel_name}` : ""} - ${delivery.status}`,
                }}
              />
            ))}
          </div>
        ) : (
          <span className="text-sm text-copy-muted">No channel delivery</span>
        ),
    },
    {
      key: "guidance",
      label: "Delivery guidance",
      size: "lg",
      render: (event) =>
        event.deliveries.some((delivery) => delivery.status === "failed")
          ? "Delivery failed. Check the notification channel configuration and try a test message."
          : "-",
    },
    {
      key: "created",
      label: "Created",
      render: (event) => <span className="whitespace-nowrap text-sm text-copy-muted">{formatDateTime(event.created_at)}</span>,
    },
  ];

  return (
    <section aria-labelledby="integration-event-history-heading" className="flex flex-col gap-3">
      <SectionHeading
        description="Recent CRM events, webhook delivery attempts, and integration health signals for this tenant."
        action={(
          <ActionBar size="sm">
            <Select value={filters.event_type} onValueChange={(value) => setFilters((current) => ({ ...current, event_type: value }))}>
              <SelectTrigger className="w-[180px]" aria-label="Filter by event type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {eventTypeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.delivery_status} onValueChange={(value) => setFilters((current) => ({ ...current, delivery_status: value }))}>
              <SelectTrigger className="w-[170px]" aria-label="Filter by delivery status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {deliveryStatusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" disabled={eventsQuery.isFetching} onClick={() => void eventsQuery.refetch()}>
              <RefreshCw />
              Refresh
            </Button>
          </ActionBar>
        )}
      >
        <span id="integration-event-history-heading">Sync and health logs</span>
      </SectionHeading>

      <RecordTable
        label="CRM events"
        columns={columns}
        rows={events}
        rowKey={(event) => event.id}
        isLoading={loading}
        isRefreshing={eventsQuery.isFetching && !loading}
        isPermissionDenied={isForbiddenError(eventsQuery.error)}
        hasError={eventsQuery.isError && !isForbiddenError(eventsQuery.error)}
        onRetry={() => void eventsQuery.refetch()}
        errorState={{
          title: "Event history could not be loaded",
          description: "Try again when the connection is available.",
        }}
        hasActiveFilters={hasFilters}
        onClearFilters={() => setFilters({ event_type: "all", delivery_status: "all" })}
        emptyState={{
          icon: Radio,
          title: "No CRM events yet",
          description: "Events appear here as records are created, assigned, and delivered to channels.",
        }}
      />
    </section>
  );
}
