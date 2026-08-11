"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import { IntegrationSectionError } from "@/components/integrations/IntegrationSectionError";
import { Button } from "@/components/ui/button";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Pill } from "@/components/ui/Pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

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

function deliveryStatusPill(status: string) {
  if (status === "delivered") {
    return { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40" };
  }
  if (status === "failed") {
    return { bg: "bg-state-danger-muted", text: "text-state-danger", border: "border-state-danger/40" };
  }
  return { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/40" };
}

async function fetchCrmEvents(filters: EventFilters) {
  const params = new URLSearchParams({ page: "1", page_size: "10" });
  if (filters.event_type !== "all") params.set("event_type", filters.event_type);
  if (filters.delivery_status !== "all") params.set("delivery_status", filters.delivery_status);
  const res = await apiFetch(`/admin/crm-events?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("event-history-unavailable");
  return Array.isArray(body?.results) ? body.results as CrmEvent[] : [];
}

export function IntegrationEventHistory() {
  const [filters, setFilters] = useState<EventFilters>({ event_type: "all", delivery_status: "all" });
  const filtersKey = `${filters.event_type}:${filters.delivery_status}`;
  const eventsQuery = useQuery({
    queryKey: ["integrations", "crm-events", filtersKey],
    queryFn: () => fetchCrmEvents(filters),
  });

  const events = eventsQuery.data ?? [];
  const loading = eventsQuery.isLoading || eventsQuery.isFetching;

  return (
    <section aria-labelledby="integration-event-history-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="integration-event-history-heading" className="text-lg font-semibold text-copy-primary">Sync and Health Logs</h2>
          <p className="mt-1 text-sm text-copy-muted">Recent CRM events, webhook delivery attempts, and integration health signals for this tenant.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filters.event_type} onValueChange={(value) => setFilters((current) => ({ ...current, event_type: value }))}>
            <SelectTrigger className="w-[180px]" aria-label="Filter by event type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {eventTypeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.delivery_status} onValueChange={(value) => setFilters((current) => ({ ...current, delivery_status: value }))}>
            <SelectTrigger className="w-[170px]" aria-label="Filter by delivery status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {deliveryStatusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void eventsQuery.refetch()}>
            <RefreshCw size={14} />
            Refresh
          </Button>
        </div>
      </div>
      {eventsQuery.isError ? (
        <IntegrationSectionError
          message="Event and delivery history could not be loaded. Try again when the connection is available."
          retry={() => void eventsQuery.refetch()}
        />
      ) : null}

      <ModuleTableShell>
        <Table className="min-w-[980px]">
          <TableHeader>
            <TableHeaderRow>
              <TableHead>Event</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Deliveries</TableHead>
              <TableHead>Delivery guidance</TableHead>
              <TableHead>Created</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-copy-muted">Loading event history...</TableCell>
              </TableRow>
            ) : events.length ? (
              events.map((event) => {
                const failedDelivery = event.deliveries.some((delivery) => delivery.status === "failed");
                return (
                  <TableRow key={event.id}>
                    <TableCell>
                      <div className="font-medium text-copy-primary">{humanizeEventType(event.event_type)}</div>
                      <div className="mt-1 max-w-[260px] truncate text-xs text-copy-muted">{eventTitle(event)}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-copy-secondary">{event.entity_type}</div>
                      <div className="text-xs tabular-nums text-copy-muted">{event.entity_id}</div>
                    </TableCell>
                    <TableCell>
                      {event.deliveries.length ? (
                        <div className="flex flex-wrap gap-2">
                          {event.deliveries.map((delivery) => {
                            const tone = deliveryStatusPill(delivery.status);
                            return (
                              <Pill key={delivery.id} bg={tone.bg} text={tone.text} border={tone.border} className="max-w-[180px]">
                                {delivery.provider}
                                {delivery.channel_name ? ` - ${delivery.channel_name}` : ""}
                                {` - ${delivery.status}`}
                              </Pill>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="text-sm text-copy-muted">No channel delivery</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[280px] text-sm text-copy-secondary">
                      {failedDelivery ? "Delivery failed. Check the notification channel configuration and try a test message." : "-"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-copy-muted">{formatDateTime(event.created_at)}</TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-copy-muted">No CRM events found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ModuleTableShell>
    </section>
  );
}
