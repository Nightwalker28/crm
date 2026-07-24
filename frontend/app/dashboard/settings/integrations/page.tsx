"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, KeyRound, Package, PlugZap, RefreshCw, Send, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { connectGoogleDriveStorage, connectMicrosoftOneDriveStorage } from "@/hooks/useDocuments";
import { useConfirm } from "@/hooks/useConfirm";

type NotificationChannel = {
  id: number;
  provider: string;
  channel_name: string | null;
  webhook_url_masked: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type ChannelDraft = {
  provider: string;
  channel_name: string;
  webhook_url: string;
  is_active: boolean;
};

type CrmEventDelivery = {
  id: number;
  channel_id: number;
  provider: string;
  status: string;
  channel_name: string | null;
  error_message: string | null;
  delivered_at: string | null;
  created_at: string;
};

type CrmEvent = {
  id: number;
  actor_user_id: number | null;
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

type IntegrationRegistryHealth = {
  provider: {
    id: number;
    key: string;
    name: string;
    category: string;
    description: string | null;
    enabled: boolean;
    metadata_json: {
      config_href?: string;
      source?: string;
    };
  };
  connection: {
    id: number | null;
    provider_key: string;
    status: string;
    provider_display_name: string | null;
    account_label: string | null;
    last_sync_at: string | null;
    last_successful_sync_at: string | null;
    source: string;
    connection_count: number;
    credential_state: string;
    health_status: string;
    scopes: string[];
    last_error: string | null;
    last_failure_reason: string | null;
    reconnect_url: string | null;
    reconnect_action: string | null;
    queued_jobs: number;
    failed_jobs: number;
    help_text: string | null;
  };
};

type IntegrationApiKey = {
  id: number;
  name: string;
  key_prefix: string;
  scopes: string[];
  allowed_origins: string[];
  status: string;
  last_used_at: string | null;
  created_at: string;
  api_key?: string | null;
};

type WebsiteCatalogItem = {
  id: number;
  item_type: "product" | "service" | "bundle";
  catalog_product_id: number | null;
  catalog_service_id: number | null;
  slug: string;
  sku: string | null;
  name: string;
  currency: string;
  public_unit_price: string | number;
  stock_status: string;
  stock_quantity: string | number | null;
  updated_at: string;
};

type WebsiteOrderLine = {
  id: number;
  catalog_item_id: number | null;
  catalog_product_id: number | null;
  catalog_service_id: number | null;
  item_type: "product" | "service";
  name: string;
  quantity: string | number;
  currency: string;
  line_total: string | number;
  stock_quantity_before: string | number | null;
  stock_quantity_after: string | number | null;
};

type WebsiteOrder = {
  id: number;
  pos_invoice_id: number | null;
  external_reference: string;
  source_platform: string | null;
  status: string;
  customer_name: string | null;
  customer_email: string | null;
  currency: string;
  subtotal_amount: string | number;
  created_at: string;
  line_items: WebsiteOrderLine[];
};

type ApiKeyDraft = {
  name: string;
  allowCatalogRead: boolean;
  allowOrdersWrite: boolean;
  allowedOrigins: string;
};

const emptyDraft: ChannelDraft = {
  provider: "slack",
  channel_name: "",
  webhook_url: "",
  is_active: true,
};

const emptyApiKeyDraft: ApiKeyDraft = {
  name: "",
  allowCatalogRead: true,
  allowOrdersWrite: false,
  allowedOrigins: "",
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

const orderStatusOptions = [
  { value: "submitted", label: "Submitted" },
  { value: "under_review", label: "Under Review" },
  { value: "confirmed", label: "Confirmed" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "rejected", label: "Rejected" },
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

function connectionStatusPill(status: string) {
  if (status === "connected") {
    return { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40" };
  }
  if (status === "error" || status === "reconnect_required") {
    return { bg: "bg-state-danger-muted", text: "text-state-danger", border: "border-state-danger/40" };
  }
  if (status === "pending") {
    return { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/40" };
  }
  return { bg: "bg-surface-muted", text: "text-copy-muted", border: "border-line-default" };
}

function formatStatus(value: string) {
  return value.replace(/_/g, " ");
}

function money(value: string | number | null | undefined, currency: string) {
  const amount = Number(value);
  return `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function parseCsv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

async function readJson(res: Response) {
  return res.json().catch(() => null);
}

function SectionError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
      <span>{message}</span>
      <Button type="button" variant="outline" size="sm" onClick={retry}>
        <RefreshCw size={14} aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}

async function fetchWebsiteIntegrations() {
  const [keysRes, catalogRes, ordersRes] = await Promise.all([
    apiFetch("/integrations/api-keys"),
    apiFetch("/integrations/catalog/published?limit=10&offset=0"),
    apiFetch("/integrations/orders?limit=10&offset=0"),
  ]);
  const [keysBody, catalogBody, ordersBody] = await Promise.all([readJson(keysRes), readJson(catalogRes), readJson(ordersRes)]);
  if (!keysRes.ok || !catalogRes.ok || !ordersRes.ok) throw new Error("website-integrations-unavailable");
  return {
    apiKeys: Array.isArray(keysBody) ? keysBody as IntegrationApiKey[] : [],
    publishedCatalog: Array.isArray(catalogBody?.results) ? catalogBody.results as WebsiteCatalogItem[] : [],
    publishedCatalogTotal: typeof catalogBody?.total_count === "number" ? catalogBody.total_count : 0,
    websiteOrders: Array.isArray(ordersBody) ? ordersBody as WebsiteOrder[] : [],
  };
}

async function fetchNotificationChannels() {
  const res = await apiFetch("/admin/notification-channels");
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("notification-channels-unavailable");
  return Array.isArray(body?.results) ? body.results as NotificationChannel[] : [];
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

async function fetchRegistryHealth() {
  const res = await apiFetch("/admin/integrations-registry/health");
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("integration-health-unavailable");
  return Array.isArray(body?.results) ? body.results as IntegrationRegistryHealth[] : [];
}

export default function IntegrationsPage() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [apiKeyDraft, setApiKeyDraft] = useState<ApiKeyDraft>(emptyApiKeyDraft);
  const [latestApiKey, setLatestApiKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<ChannelDraft>(emptyDraft);
  const [eventFilters, setEventFilters] = useState<EventFilters>({ event_type: "all", delivery_status: "all" });
  const [saving, setSaving] = useState(false);
  const [websiteSaving, setWebsiteSaving] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const eventFiltersKey = `${eventFilters.event_type}:${eventFilters.delivery_status}`;

  const websiteQuery = useQuery({
    queryKey: ["integrations", "website"],
    queryFn: fetchWebsiteIntegrations,
  });
  const registryQuery = useQuery({
    queryKey: ["integrations", "registry-health"],
    queryFn: fetchRegistryHealth,
  });
  const channelsQuery = useQuery({
    queryKey: ["integrations", "notification-channels"],
    queryFn: fetchNotificationChannels,
  });
  const eventsQuery = useQuery({
    queryKey: ["integrations", "crm-events", eventFiltersKey],
    queryFn: () => fetchCrmEvents(eventFilters),
  });

  const apiKeys = websiteQuery.data?.apiKeys ?? [];
  const publishedCatalog = websiteQuery.data?.publishedCatalog ?? [];
  const publishedCatalogTotal = websiteQuery.data?.publishedCatalogTotal ?? 0;
  const websiteOrders = websiteQuery.data?.websiteOrders ?? [];
  const channels = channelsQuery.data ?? [];
  const events = eventsQuery.data ?? [];
  const registryHealth = registryQuery.data ?? [];
  const websiteLoading = websiteQuery.isLoading || websiteQuery.isFetching;
  const loading = channelsQuery.isLoading || channelsQuery.isFetching;
  const eventsLoading = eventsQuery.isLoading || eventsQuery.isFetching;

  async function createChannel() {
    try {
      setSaving(true);
      const res = await apiFetch("/admin/notification-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: draft.provider,
          channel_name: draft.channel_name.trim() || null,
          webhook_url: draft.webhook_url.trim(),
          is_active: draft.is_active,
        }),
      });
      if (!res.ok) throw new Error("create-channel-failed");
      setDraft(emptyDraft);
      await queryClient.invalidateQueries({ queryKey: ["integrations", "notification-channels"] });
      toast.success("Notification channel added.");
    } catch {
      toast.error("The notification channel could not be added. Check the URL and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function copyText(value: string | null | undefined, label: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied.`);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}.`);
    }
  }

  async function createApiKey() {
    const scopes = [
      apiKeyDraft.allowCatalogRead ? "catalog:read" : null,
      apiKeyDraft.allowOrdersWrite ? "orders:write" : null,
    ].filter(Boolean);
    if (!apiKeyDraft.name.trim() || scopes.length === 0) {
      toast.error("Name the API key and select at least one scope.");
      return;
    }
    try {
      setWebsiteSaving(true);
      const res = await apiFetch("/integrations/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: apiKeyDraft.name.trim(),
          scopes,
          allowed_origins: parseCsv(apiKeyDraft.allowedOrigins),
        }),
      });
      const body = await readJson(res);
      if (!res.ok) throw new Error("create-api-key-failed");
      setLatestApiKey(typeof body?.api_key === "string" ? body.api_key : null);
      setApiKeyDraft(emptyApiKeyDraft);
      await queryClient.invalidateQueries({ queryKey: ["integrations", "website"] });
      toast.success("Website API key created.");
    } catch {
      toast.error("The API key could not be created. Review the settings and try again.");
    } finally {
      setWebsiteSaving(false);
    }
  }

  async function revokeApiKey(key: IntegrationApiKey) {
    const confirmed = await confirm({
      title: `Revoke ${key.name}?`,
      description: "Requests using this key will stop working immediately. This action cannot be undone.",
      confirmLabel: "Revoke key",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      setWebsiteSaving(true);
      const res = await apiFetch(`/integrations/api-keys/${key.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("revoke-api-key-failed");
      await queryClient.invalidateQueries({ queryKey: ["integrations", "website"] });
      toast.success("Website API key revoked.");
    } catch {
      toast.error("The API key could not be revoked. Try again.");
    } finally {
      setWebsiteSaving(false);
    }
  }

  async function rotateApiKey(key: IntegrationApiKey) {
    const confirmed = await confirm({
      title: `Rotate ${key.name}?`,
      description: "The current key will stop working immediately. Update the connected website with the new key after rotating.",
      confirmLabel: "Rotate key",
    });
    if (!confirmed) return;
    try {
      setWebsiteSaving(true);
      const res = await apiFetch(`/integrations/api-keys/${key.id}/rotate`, { method: "POST" });
      const body = await readJson(res);
      if (!res.ok) throw new Error("rotate-api-key-failed");
      setLatestApiKey(typeof body?.api_key === "string" ? body.api_key : null);
      await queryClient.invalidateQueries({ queryKey: ["integrations", "website"] });
      toast.success("Website API key rotated.");
    } catch {
      toast.error("The API key could not be rotated. Try again.");
    } finally {
      setWebsiteSaving(false);
    }
  }

  async function createPosInvoice(order: WebsiteOrder) {
    const confirmed = await confirm({
      title: `Create a POS invoice for ${order.external_reference}?`,
      description: "This creates a finance record from the reviewed website order.",
      confirmLabel: "Create invoice",
    });
    if (!confirmed) return;
    try {
      setWebsiteSaving(true);
      const res = await apiFetch(`/integrations/orders/${order.id}/create-pos-invoice`, { method: "POST" });
      const body = await readJson(res);
      if (!res.ok) throw new Error("create-pos-invoice-failed");
      await queryClient.invalidateQueries({ queryKey: ["integrations", "website"] });
      toast.success(body?.already_existing ? "POS invoice already exists." : "POS invoice created from website order.");
    } catch {
      toast.error("The POS invoice could not be created. Try again.");
    } finally {
      setWebsiteSaving(false);
    }
  }

  async function updateOrderStatus(order: WebsiteOrder, nextStatus: string) {
    if (order.status === nextStatus) return;
    if (nextStatus === "cancelled" || nextStatus === "rejected") {
      const confirmed = await confirm({
        title: `${nextStatus === "cancelled" ? "Cancel" : "Reject"} ${order.external_reference}?`,
        description: "This changes the status visible to staff reviewing this website order.",
        confirmLabel: nextStatus === "cancelled" ? "Cancel order" : "Reject order",
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    try {
      setWebsiteSaving(true);
      const res = await apiFetch(`/integrations/orders/${order.id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error("update-order-status-failed");
      await queryClient.invalidateQueries({ queryKey: ["integrations", "website"] });
      toast.success("Order status updated.");
    } catch {
      toast.error("The order status could not be updated. Try again.");
    } finally {
      setWebsiteSaving(false);
    }
  }

  async function updateChannel(channel: NotificationChannel, payload: Partial<NotificationChannel>) {
    try {
      setSaving(true);
      const res = await apiFetch(`/admin/notification-channels/${channel.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("update-channel-failed");
      await queryClient.invalidateQueries({ queryKey: ["integrations", "notification-channels"] });
      toast.success("Notification channel updated.");
    } catch {
      toast.error("The notification channel could not be updated. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteChannel(channel: NotificationChannel) {
    const confirmed = await confirm({
      title: `Delete ${channel.channel_name || channel.provider} webhook?`,
      description: "CRM event notifications will no longer be delivered through this channel.",
      confirmLabel: "Delete webhook",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      setSaving(true);
      const res = await apiFetch(`/admin/notification-channels/${channel.id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("delete-channel-failed");
      }
      await queryClient.invalidateQueries({ queryKey: ["integrations", "notification-channels"] });
      toast.success("Notification channel deleted.");
    } catch {
      toast.error("The notification channel could not be deleted. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest(channel: NotificationChannel) {
    try {
      setSaving(true);
      const res = await apiFetch(`/admin/notification-channels/${channel.id}/test`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error("test-channel-failed");
      toast.success(body?.message ?? "Test message sent.");
    } catch {
      toast.error("The test message could not be sent. Check the webhook configuration and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function connectDocumentProvider(providerKey: string) {
    try {
      setConnectingProvider(providerKey);
      const result =
        providerKey === "google_drive"
          ? await connectGoogleDriveStorage("/dashboard/settings/integrations")
          : await connectMicrosoftOneDriveStorage("/dashboard/settings/integrations");
      window.location.href = result.auth_url;
    } catch {
      toast.error("The storage connection could not be started. Try again.");
      setConnectingProvider(null);
    }
  }

  function renderRegistryAction(provider: IntegrationRegistryHealth["provider"], connection: IntegrationRegistryHealth["connection"]) {
    if (provider.key === "google_drive" || provider.key === "microsoft_onedrive") {
      const isConnecting = connectingProvider === provider.key;
      return (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          disabled={Boolean(connectingProvider)}
          onClick={() => void connectDocumentProvider(provider.key)}
        >
          {isConnecting ? "Connecting..." : connection.status === "connected" ? "Reconnect" : connection.reconnect_action || "Connect"}
        </Button>
      );
    }
    if (connection.reconnect_url || provider.metadata_json.config_href) {
      return (
        <Button type="button" variant="outline" size="sm" className="mt-4" asChild>
          <Link href={connection.reconnect_url || provider.metadata_json.config_href || "#"}>
            {connection.status === "connected" ? "Configure" : connection.reconnect_action || "Reconnect"}
          </Link>
        </Button>
      );
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-5 text-neutral-200">
      <PageHeader
        title="Integrations"
        description="Review provider health, manage website API access, and configure external alert webhooks."
      />

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-neutral-100">Provider Registry</h2>
            <p className="text-sm text-neutral-500">Connection state from mail, calendar, documents, website APIs, and webhook providers for this tenant.</p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={registryQuery.isFetching} onClick={() => void registryQuery.refetch()}>
            <RefreshCw size={14} />
            Refresh
          </Button>
        </div>
        {registryQuery.isError ? (
          <SectionError
            message="Provider health is temporarily unavailable. Your existing connections have not been changed."
            retry={() => void registryQuery.refetch()}
          />
        ) : null}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {registryQuery.isLoading ? (
            <Card className="px-5 py-5 text-sm text-neutral-500 md:col-span-2 xl:col-span-3">Loading provider health...</Card>
          ) : registryHealth.length ? (
            registryHealth.map(({ provider, connection }) => {
              const tone = connectionStatusPill(connection.status);
              return (
                <Card key={provider.key} className="px-5 py-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950">
                        <PlugZap size={17} className="text-neutral-300" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs uppercase text-neutral-500">{provider.category}</div>
                        <h3 className="mt-1 text-base font-semibold text-neutral-100">{provider.name}</h3>
                      </div>
                    </div>
                    <Pill bg={tone.bg} text={tone.text} border={tone.border}>{formatStatus(connection.status)}</Pill>
                  </div>
                  <p className="mt-3 text-sm leading-5 text-neutral-500">{provider.description}</p>
                  <div className="mt-4 grid gap-2 text-xs text-neutral-500">
                    <div>
                      <span className="text-neutral-600">Account: </span>
                      <span className="text-neutral-300">{connection.account_label || (connection.connection_count ? "Connected account" : "Not connected")}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2">
                        <div className="text-neutral-600">Connections</div>
                        <div className="mt-1 text-sm font-medium text-neutral-200">{connection.connection_count}</div>
                      </div>
                      <div className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2">
                        <div className="text-neutral-600">Queued</div>
                        <div className="mt-1 text-sm font-medium text-neutral-200">{connection.queued_jobs}</div>
                      </div>
                      <div className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2">
                        <div className="text-neutral-600">Failed</div>
                        <div className={`mt-1 text-sm font-medium ${connection.failed_jobs ? "text-red-200" : "text-neutral-200"}`}>{connection.failed_jobs}</div>
                      </div>
                      <div className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2">
                        <div className="text-neutral-600">Credentials</div>
                        <div className="mt-1 truncate text-sm font-medium text-neutral-200">{formatStatus(connection.credential_state)}</div>
                      </div>
                    </div>
                    <div>Health: {formatStatus(connection.health_status)}</div>
                    <div>{connection.last_sync_at ? `Last activity ${formatDateTime(connection.last_sync_at)}` : "No activity recorded"}</div>
                    <div>{connection.last_successful_sync_at ? `Last successful run ${formatDateTime(connection.last_successful_sync_at)}` : "No successful run recorded"}</div>
                    {connection.scopes.length ? <div className="truncate">Scopes: {connection.scopes.join(", ")}</div> : null}
                    {connection.last_failure_reason || connection.last_error ? (
                      <div role="alert" className="rounded-md border border-state-danger/40 bg-state-danger-muted px-3 py-2 leading-5 text-copy-primary">
                        This connection needs attention. Review its configuration or reconnect, then try again.
                      </div>
                    ) : null}
                    {connection.help_text ? <div className="leading-5 text-neutral-400">{connection.help_text}</div> : null}
                  </div>
                  {renderRegistryAction(provider, connection)}
                </Card>
              );
            })
          ) : (
            <Card className="px-5 py-5 text-sm text-neutral-500 md:col-span-2 xl:col-span-3">No integration providers registered.</Card>
          )}
        </div>
      </section>

      <section id="website-apis" className="flex scroll-mt-5 flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-neutral-100">Website APIs</h2>
            <p className="text-sm text-neutral-500">Manage API keys, public catalog items, and incoming website orders for WordPress or custom sites.</p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={websiteLoading} onClick={() => void websiteQuery.refetch()}>
            <RefreshCw size={14} />
            Refresh
          </Button>
        </div>
        {websiteQuery.isError ? (
          <SectionError
            message="Website integration data could not be loaded. Existing API keys, catalog settings, and orders are unchanged."
            retry={() => void websiteQuery.refetch()}
          />
        ) : null}

        <div>
          <h3 className="text-base font-semibold text-neutral-100">API Keys</h3>
          <p className="mt-1 text-sm text-neutral-500">Create scoped credentials for catalog reads and website order writeback.</p>
        </div>

        <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          <Card className="px-5 py-5">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950">
                <KeyRound size={17} className="text-neutral-300" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-neutral-100">New API Key</h3>
                <p className="mt-1 text-sm text-neutral-500">Keys are shown once. Store them in the website or plugin settings.</p>
              </div>
            </div>
            <FieldGroup className="grid gap-4">
              <Field>
                <FieldLabel htmlFor="api-key-name">Key Name <RequiredMark /></FieldLabel>
                <Input id="api-key-name" value={apiKeyDraft.name} onChange={(event) => setApiKeyDraft((current) => ({ ...current, name: event.target.value }))} placeholder="WordPress production" />
              </Field>
              <div className="grid gap-2">
                <label className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
                  Catalog read
                  <input
                    type="checkbox"
                    aria-label="Allow catalog read access"
                    checked={apiKeyDraft.allowCatalogRead}
                    onChange={(event) => setApiKeyDraft((current) => ({ ...current, allowCatalogRead: event.target.checked }))}
                    className="h-4 w-4 accent-neutral-100"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
                  Order writeback
                  <input
                    type="checkbox"
                    aria-label="Allow order writeback access"
                    checked={apiKeyDraft.allowOrdersWrite}
                    onChange={(event) => setApiKeyDraft((current) => ({ ...current, allowOrdersWrite: event.target.checked }))}
                    className="h-4 w-4 accent-neutral-100"
                  />
                </label>
              </div>
              <Field>
                <FieldLabel htmlFor="api-key-origins">Allowed Origins</FieldLabel>
                <Textarea
                  id="api-key-origins"
                  value={apiKeyDraft.allowedOrigins}
                  onChange={(event) => setApiKeyDraft((current) => ({ ...current, allowedOrigins: event.target.value }))}
                  placeholder="https://example.com, https://www.example.com"
                  className="min-h-20"
                />
                <p className="text-xs leading-5 text-copy-muted">Comma-separated browser origins. Leave empty only for server-to-server clients that do not send an Origin header.</p>
              </Field>
              <Button type="button" disabled={websiteSaving} onClick={createApiKey}>
                <KeyRound size={14} />
                Create API Key
              </Button>
            </FieldGroup>

            {latestApiKey ? (
              <div role="status" className="mt-4 rounded-md border border-state-success/40 bg-state-success-muted p-3">
                <div className="mb-2 text-xs font-medium uppercase text-copy-muted">Copy this key now</div>
                <div className="break-all font-mono text-xs text-neutral-200">{latestApiKey}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void copyText(latestApiKey, "API key")}>
                    <Copy size={14} />
                    Copy
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLatestApiKey(null)}>Dismiss</Button>
                </div>
              </div>
            ) : null}
          </Card>

          <ModuleTableShell>
            <Table className="min-w-[940px]">
              <TableHeader>
                <TableHeaderRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>Origins</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableHeaderRow>
              </TableHeader>
              <TableBody>
                {websiteLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-neutral-500">Loading website API keys...</TableCell>
                  </TableRow>
                ) : apiKeys.length ? (
                  apiKeys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium text-neutral-100">{key.name}</TableCell>
                      <TableCell className="font-mono text-xs text-neutral-500">{key.key_prefix}...</TableCell>
                      <TableCell className="text-neutral-300">{key.scopes.join(", ")}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-neutral-400">{key.allowed_origins.length ? key.allowed_origins.join(", ") : "Any origin"}</TableCell>
                      <TableCell>
                        <Pill
                          bg={key.status === "active" ? "bg-state-success-muted" : "bg-state-danger-muted"}
                          text={key.status === "active" ? "text-state-success" : "text-state-danger"}
                          border={key.status === "active" ? "border-state-success/40" : "border-state-danger/40"}
                        >
                          {key.status}
                        </Pill>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-neutral-400">{key.last_used_at ? formatDateTime(key.last_used_at) : "-"}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" size="sm" disabled={websiteSaving || key.status !== "active"} onClick={() => rotateApiKey(key)}>
                            <RefreshCw size={14} />
                            Rotate
                          </Button>
                          <Button type="button" variant="outline" size="sm" disabled={websiteSaving || key.status !== "active"} onClick={() => revokeApiKey(key)}>
                            <Trash2 size={14} />
                            Revoke
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-neutral-500">No website API keys yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ModuleTableShell>
        </div>

        <div>
          <h3 className="text-base font-semibold text-neutral-100">Published Catalog</h3>
          <p className="mt-1 text-sm text-neutral-500">Only active public products and services with slugs are exposed to integration API consumers.</p>
        </div>

        <ModuleTableShell>
          <Table className="min-w-[940px]">
            <TableHeader>
              <TableHeaderRow>
                <TableHead>Item</TableHead>
                <TableHead>Mapping</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Updated</TableHead>
              </TableHeaderRow>
            </TableHeader>
            <TableBody>
              {websiteLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-neutral-500">Loading published catalog...</TableCell>
                </TableRow>
              ) : publishedCatalog.length ? (
                publishedCatalog.map((item) => (
                  <TableRow key={`${item.item_type}-${item.id}`}>
                    <TableCell>
                      <div className="font-medium text-neutral-100">{item.name}</div>
                      <div className="text-xs text-neutral-500">/{item.slug}{item.sku ? ` · ${item.sku}` : ""}</div>
                    </TableCell>
                    <TableCell className="text-neutral-300">
                      {item.catalog_product_id ? `Product #${item.catalog_product_id}` : item.catalog_service_id ? `Service #${item.catalog_service_id}` : item.item_type}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-neutral-300">{money(item.public_unit_price, item.currency)}</TableCell>
                    <TableCell className="text-neutral-400">
                      {item.item_type === "product" ? `${formatStatus(item.stock_status)}${item.stock_quantity != null ? ` · ${item.stock_quantity}` : ""}` : "Service"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-neutral-400">{formatDateTime(item.updated_at)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-neutral-500">No published catalog items are exposed yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ModuleTableShell>
        <div className="text-xs text-neutral-500">{publishedCatalogTotal} published item{publishedCatalogTotal === 1 ? "" : "s"} available through the public catalog API.</div>

        <div className="grid gap-5 md:grid-cols-2">
          <Card className="px-5 py-5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950">
                <Package size={17} className="text-neutral-300" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-neutral-100">Products</h3>
                <p className="mt-1 text-sm text-neutral-500">Manage product records, public slugs, stock, pricing, and media in the Products module.</p>
                <Button type="button" variant="outline" size="sm" className="mt-4" asChild>
                  <Link href="/dashboard/catalog/products">Open Products</Link>
                </Button>
              </div>
            </div>
          </Card>
          <Card className="px-5 py-5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950">
                <Package size={17} className="text-neutral-300" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-neutral-100">Services</h3>
                <p className="mt-1 text-sm text-neutral-500">Manage service records, public slugs, pricing, availability, and media in the Services module.</p>
                <Button type="button" variant="outline" size="sm" className="mt-4" asChild>
                  <Link href="/dashboard/catalog/services">Open Services</Link>
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div>
          <h3 className="text-base font-semibold text-neutral-100">Website and Client Orders</h3>
          <p className="mt-1 text-sm text-neutral-500">Incoming website orders stay separate from internal POS invoices until reviewed or converted.</p>
        </div>

        <ModuleTableShell>
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableHeaderRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableHeaderRow>
            </TableHeader>
            <TableBody>
              {websiteLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-neutral-500">Loading website orders...</TableCell>
                </TableRow>
              ) : websiteOrders.length ? (
                websiteOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium text-neutral-100">
                        <ShoppingCart size={14} className="text-neutral-500" />
                        {order.external_reference}
                      </div>
                      <div className="mt-1 text-xs text-neutral-500">{order.source_platform || "external site"}</div>
                      <div className="mt-2 max-w-[180px]">
                        <Select value={order.status} onValueChange={(value) => void updateOrderStatus(order, value)} disabled={websiteSaving}>
                          <SelectTrigger className="h-8 bg-neutral-950 text-xs" aria-label={`Status for order ${order.external_reference}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {orderStatusOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-neutral-300">{order.customer_name || "-"}</div>
                      <div className="text-xs text-neutral-500">{order.customer_email || "-"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[320px] truncate text-neutral-300">
                        {order.line_items.map((line) => `${line.name} x ${line.quantity}`).join(", ")}
                      </div>
                      <div className="text-xs text-neutral-500">
                        {order.line_items.length} line{order.line_items.length === 1 ? "" : "s"}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-neutral-300">{money(order.subtotal_amount, order.currency)}</TableCell>
                    <TableCell>
                      {order.pos_invoice_id ? (
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/dashboard/finance/pos/${order.pos_invoice_id}/print`}>
                            <ExternalLink size={14} />
                            POS #{order.pos_invoice_id}
                          </Link>
                        </Button>
                      ) : (
                        <span className="text-sm text-neutral-500">Not created</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-neutral-400">{formatDateTime(order.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={websiteSaving || Boolean(order.pos_invoice_id)}
                          onClick={() => createPosInvoice(order)}
                        >
                          Create POS Invoice
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-neutral-500">No website orders captured yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ModuleTableShell>
      </section>

      <div id="webhooks" className="grid scroll-mt-5 gap-5 lg:grid-cols-[380px_1fr]">
        <Card className="px-5 py-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950">
              <PlugZap size={17} className="text-neutral-300" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-neutral-100">Add Webhook</h2>
              <p className="mt-1 text-sm text-neutral-500">Paste a Slack incoming webhook URL. OAuth is not used in this phase.</p>
            </div>
          </div>

          <FieldGroup className="mt-5 grid gap-4">
            <Field>
              <FieldLabel htmlFor="webhook-provider">Provider</FieldLabel>
              <Select value={draft.provider} onValueChange={(value) => setDraft((current) => ({ ...current, provider: value }))}>
                <SelectTrigger id="webhook-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="teams">Microsoft Teams</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="webhook-channel-name">Channel Name</FieldLabel>
              <Input id="webhook-channel-name" value={draft.channel_name} onChange={(event) => setDraft((current) => ({ ...current, channel_name: event.target.value }))} placeholder="#sales-alerts" />
            </Field>
            <Field>
              <FieldLabel htmlFor="webhook-url">Webhook URL</FieldLabel>
              <Input
                id="webhook-url"
                type="url"
                value={draft.webhook_url}
                onChange={(event) => setDraft((current) => ({ ...current, webhook_url: event.target.value }))}
                placeholder="https://hooks.slack.com/services/..."
              />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
              Active
              <input
                type="checkbox"
                aria-label="Create webhook as active"
                checked={draft.is_active}
                onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))}
                className="h-4 w-4 accent-neutral-100"
              />
            </label>
            <Button type="button" disabled={saving || !draft.webhook_url.trim()} onClick={createChannel}>
              Add Webhook
            </Button>
          </FieldGroup>
        </Card>

        <ModuleTableShell>
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableHeaderRow>
                <TableHead>Provider</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Webhook</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableHeaderRow>
            </TableHeader>
            <TableBody>
              {channelsQuery.isError ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6">
                    <SectionError message="Notification channels could not be loaded. Existing webhooks are unchanged." retry={() => void channelsQuery.refetch()} />
                  </TableCell>
                </TableRow>
              ) : loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-neutral-500">Loading integrations...</TableCell>
                </TableRow>
              ) : channels.length ? (
                channels.map((channel) => (
                  <TableRow key={channel.id}>
                    <TableCell className="capitalize text-neutral-100">{channel.provider}</TableCell>
                    <TableCell className="text-neutral-400">{channel.channel_name || "-"}</TableCell>
                    <TableCell className="font-mono text-xs text-neutral-500">{channel.webhook_url_masked}</TableCell>
                    <TableCell>
                      <Pill
                        bg={channel.is_active ? "bg-state-success-muted" : "bg-state-danger-muted"}
                        text={channel.is_active ? "text-state-success" : "text-state-danger"}
                        border={channel.is_active ? "border-state-success/40" : "border-state-danger/40"}
                      >
                        {channel.is_active ? "Active" : "Inactive"}
                      </Pill>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => sendTest(channel)}>
                          <Send size={14} />
                          Test
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => updateChannel(channel, { is_active: !channel.is_active })}>
                          {channel.is_active ? "Disable" : "Enable"}
                        </Button>
                        <Button type="button" variant="outline" size="icon-sm" disabled={saving} aria-label={`Delete ${channel.channel_name || channel.provider}`} onClick={() => deleteChannel(channel)}>
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-neutral-500">No notification channels configured.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ModuleTableShell>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-neutral-100">Sync and Health Logs</h2>
            <p className="mt-1 text-sm text-neutral-500">Recent CRM events, webhook delivery attempts, and integration health signals for this tenant.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={eventFilters.event_type} onValueChange={(value) => setEventFilters((current) => ({ ...current, event_type: value }))}>
              <SelectTrigger className="w-[180px]" aria-label="Filter by event type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {eventTypeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={eventFilters.delivery_status} onValueChange={(value) => setEventFilters((current) => ({ ...current, delivery_status: value }))}>
              <SelectTrigger className="w-[170px]" aria-label="Filter by delivery status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {deliveryStatusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" disabled={eventsLoading} onClick={() => void eventsQuery.refetch()}>
              <RefreshCw size={14} />
              Refresh
            </Button>
          </div>
        </div>
        {eventsQuery.isError ? (
          <SectionError
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
              {eventsLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-neutral-500">Loading event history...</TableCell>
                </TableRow>
              ) : events.length ? (
                events.map((event) => {
                  const failedDelivery = event.deliveries.find((delivery) => delivery.status === "failed");
                  return (
                    <TableRow key={event.id}>
                      <TableCell>
                        <div className="font-medium text-neutral-100">{humanizeEventType(event.event_type)}</div>
                        <div className="mt-1 max-w-[260px] truncate text-xs text-neutral-500">{eventTitle(event)}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-neutral-300">{event.entity_type}</div>
                        <div className="font-mono text-xs text-neutral-500">{event.entity_id}</div>
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
                          <span className="text-sm text-neutral-500">No channel delivery</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[280px] text-sm text-copy-secondary">
                        {failedDelivery ? "Delivery failed. Check the notification channel configuration and try a test message." : "-"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-neutral-400">{formatDateTime(event.created_at)}</TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-neutral-500">No CRM events found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ModuleTableShell>
      </section>
    </div>
  );
}
