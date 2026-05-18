"use client";

import { useEffect, useState } from "react";
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
    return { bg: "bg-emerald-950/60", text: "text-emerald-200", border: "border-emerald-800/70" };
  }
  if (status === "failed") {
    return { bg: "bg-red-950/60", text: "text-red-200", border: "border-red-800/70" };
  }
  return { bg: "bg-amber-950/60", text: "text-amber-200", border: "border-amber-800/70" };
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

function responseError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body && typeof (body as { detail?: unknown }).detail === "string") {
    return (body as { detail: string }).detail;
  }
  return fallback;
}

async function fetchWebsiteIntegrations() {
  const [keysRes, ordersRes] = await Promise.all([
    apiFetch("/integrations/api-keys"),
    apiFetch("/integrations/orders?limit=10&offset=0"),
  ]);
  const [keysBody, ordersBody] = await Promise.all([readJson(keysRes), readJson(ordersRes)]);
  if (!keysRes.ok) throw new Error(responseError(keysBody, `Failed with ${keysRes.status}`));
  if (!ordersRes.ok) throw new Error(responseError(ordersBody, `Failed with ${ordersRes.status}`));
  return {
    apiKeys: Array.isArray(keysBody) ? keysBody as IntegrationApiKey[] : [],
    websiteOrders: Array.isArray(ordersBody) ? ordersBody as WebsiteOrder[] : [],
  };
}

async function fetchNotificationChannels() {
  const res = await apiFetch("/admin/notification-channels");
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return Array.isArray(body?.results) ? body.results as NotificationChannel[] : [];
}

async function fetchCrmEvents(filters: EventFilters) {
  const params = new URLSearchParams({ page: "1", page_size: "10" });
  if (filters.event_type !== "all") params.set("event_type", filters.event_type);
  if (filters.delivery_status !== "all") params.set("delivery_status", filters.delivery_status);
  const res = await apiFetch(`/admin/crm-events?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return Array.isArray(body?.results) ? body.results as CrmEvent[] : [];
}

export default function IntegrationsPage() {
  const queryClient = useQueryClient();
  const [apiKeyDraft, setApiKeyDraft] = useState<ApiKeyDraft>(emptyApiKeyDraft);
  const [latestApiKey, setLatestApiKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<ChannelDraft>(emptyDraft);
  const [eventFilters, setEventFilters] = useState<EventFilters>({ event_type: "all", delivery_status: "all" });
  const [saving, setSaving] = useState(false);
  const [websiteSaving, setWebsiteSaving] = useState(false);

  const websiteQuery = useQuery({
    queryKey: ["integrations", "website"],
    queryFn: fetchWebsiteIntegrations,
  });
  const channelsQuery = useQuery({
    queryKey: ["integrations", "notification-channels"],
    queryFn: fetchNotificationChannels,
  });
  const eventsQuery = useQuery({
    queryKey: ["integrations", "crm-events", eventFilters],
    queryFn: () => fetchCrmEvents(eventFilters),
  });

  const apiKeys = websiteQuery.data?.apiKeys ?? [];
  const websiteOrders = websiteQuery.data?.websiteOrders ?? [];
  const channels = channelsQuery.data ?? [];
  const events = eventsQuery.data ?? [];
  const websiteLoading = websiteQuery.isLoading || websiteQuery.isFetching;
  const loading = channelsQuery.isLoading || channelsQuery.isFetching;
  const eventsLoading = eventsQuery.isLoading || eventsQuery.isFetching;

  useEffect(() => {
    if (websiteQuery.error) {
      toast.error(websiteQuery.error instanceof Error ? websiteQuery.error.message : "Failed to load website integration data.");
    }
  }, [websiteQuery.error]);

  useEffect(() => {
    if (channelsQuery.error) {
      toast.error(channelsQuery.error instanceof Error ? channelsQuery.error.message : "Failed to load integrations.");
    }
  }, [channelsQuery.error]);

  useEffect(() => {
    if (eventsQuery.error) {
      toast.error(eventsQuery.error instanceof Error ? eventsQuery.error.message : "Failed to load event history.");
    }
  }, [eventsQuery.error]);

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
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      setDraft(emptyDraft);
      await queryClient.invalidateQueries({ queryKey: ["integrations", "notification-channels"] });
      toast.success("Notification channel added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add channel.");
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
      if (!res.ok) throw new Error(responseError(body, `Failed with ${res.status}`));
      setLatestApiKey(typeof body?.api_key === "string" ? body.api_key : null);
      setApiKeyDraft(emptyApiKeyDraft);
      await queryClient.invalidateQueries({ queryKey: ["integrations", "website"] });
      toast.success("Website API key created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create API key.");
    } finally {
      setWebsiteSaving(false);
    }
  }

  async function revokeApiKey(key: IntegrationApiKey) {
    try {
      setWebsiteSaving(true);
      const res = await apiFetch(`/integrations/api-keys/${key.id}`, { method: "DELETE" });
      const body = await readJson(res);
      if (!res.ok) throw new Error(responseError(body, `Failed with ${res.status}`));
      await queryClient.invalidateQueries({ queryKey: ["integrations", "website"] });
      toast.success("Website API key revoked.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to revoke API key.");
    } finally {
      setWebsiteSaving(false);
    }
  }

  async function createPosInvoice(order: WebsiteOrder) {
    try {
      setWebsiteSaving(true);
      const res = await apiFetch(`/integrations/orders/${order.id}/create-pos-invoice`, { method: "POST" });
      const body = await readJson(res);
      if (!res.ok) throw new Error(responseError(body, `Failed with ${res.status}`));
      await queryClient.invalidateQueries({ queryKey: ["integrations", "website"] });
      toast.success(body?.already_existing ? "POS invoice already exists." : "POS invoice created from website order.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create POS invoice.");
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
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      await queryClient.invalidateQueries({ queryKey: ["integrations", "notification-channels"] });
      toast.success("Notification channel updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update channel.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteChannel(channel: NotificationChannel) {
    try {
      setSaving(true);
      const res = await apiFetch(`/admin/notification-channels/${channel.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Failed with ${res.status}`);
      }
      await queryClient.invalidateQueries({ queryKey: ["integrations", "notification-channels"] });
      toast.success("Notification channel deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete channel.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest(channel: NotificationChannel) {
    try {
      setSaving(true);
      const res = await apiFetch(`/admin/notification-channels/${channel.id}/test`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      toast.success(body?.message ?? "Test message sent.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send test message.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 text-neutral-200">
      <PageHeader
        title="Integrations"
        description="Manage website API keys, public catalog data, website order writebacks, and external alert webhooks."
      />

      <section className="flex flex-col gap-4">
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
                <FieldLabel>Key Name <RequiredMark /></FieldLabel>
                <Input value={apiKeyDraft.name} onChange={(event) => setApiKeyDraft((current) => ({ ...current, name: event.target.value }))} placeholder="WordPress production" />
              </Field>
              <div className="grid gap-2">
                <label className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
                  Catalog read
                  <input
                    type="checkbox"
                    checked={apiKeyDraft.allowCatalogRead}
                    onChange={(event) => setApiKeyDraft((current) => ({ ...current, allowCatalogRead: event.target.checked }))}
                    className="h-4 w-4 accent-neutral-100"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
                  Order writeback
                  <input
                    type="checkbox"
                    checked={apiKeyDraft.allowOrdersWrite}
                    onChange={(event) => setApiKeyDraft((current) => ({ ...current, allowOrdersWrite: event.target.checked }))}
                    className="h-4 w-4 accent-neutral-100"
                  />
                </label>
              </div>
              <Field>
                <FieldLabel>Allowed Origins</FieldLabel>
                <Textarea
                  value={apiKeyDraft.allowedOrigins}
                  onChange={(event) => setApiKeyDraft((current) => ({ ...current, allowedOrigins: event.target.value }))}
                  placeholder="https://example.com, https://www.example.com"
                  className="min-h-20"
                />
              </Field>
              <Button type="button" disabled={websiteSaving} onClick={createApiKey}>
                <KeyRound size={14} />
                Create API Key
              </Button>
            </FieldGroup>

            {latestApiKey ? (
              <div className="mt-4 rounded-md border border-neutral-800 bg-neutral-950 p-3">
                <div className="mb-2 text-xs uppercase text-neutral-500">New key</div>
                <div className="break-all font-mono text-xs text-neutral-200">{latestApiKey}</div>
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void copyText(latestApiKey, "API key")}>
                  <Copy size={14} />
                  Copy
                </Button>
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
                          bg={key.status === "active" ? "bg-emerald-950/60" : "bg-red-950/60"}
                          text={key.status === "active" ? "text-emerald-200" : "text-red-200"}
                          border={key.status === "active" ? "border-emerald-800/70" : "border-red-800/70"}
                        >
                          {key.status}
                        </Pill>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-neutral-400">{key.last_used_at ? formatDateTime(key.last_used_at) : "-"}</TableCell>
                      <TableCell>
                        <div className="flex justify-end">
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
                      <div className="mt-1 text-xs text-neutral-500">{order.source_platform || "external site"} · {order.status}</div>
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

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
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
              <FieldLabel>Provider</FieldLabel>
              <Select value={draft.provider} onValueChange={(value) => setDraft((current) => ({ ...current, provider: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="teams">Microsoft Teams</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Channel Name</FieldLabel>
              <Input value={draft.channel_name} onChange={(event) => setDraft((current) => ({ ...current, channel_name: event.target.value }))} placeholder="#sales-alerts" />
            </Field>
            <Field>
              <FieldLabel>Webhook URL</FieldLabel>
              <Input
                value={draft.webhook_url}
                onChange={(event) => setDraft((current) => ({ ...current, webhook_url: event.target.value }))}
                placeholder="https://hooks.slack.com/services/..."
              />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
              Active
              <input
                type="checkbox"
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
              {loading ? (
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
                        bg={channel.is_active ? "bg-emerald-950/60" : "bg-red-950/60"}
                        text={channel.is_active ? "text-emerald-200" : "text-red-200"}
                        border={channel.is_active ? "border-emerald-800/70" : "border-red-800/70"}
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
            <h2 className="text-lg font-semibold text-neutral-100">Event Delivery History</h2>
            <p className="mt-1 text-sm text-neutral-500">Recent CRM events and webhook delivery attempts for this tenant.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={eventFilters.event_type} onValueChange={(value) => setEventFilters((current) => ({ ...current, event_type: value }))}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {eventTypeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={eventFilters.delivery_status} onValueChange={(value) => setEventFilters((current) => ({ ...current, delivery_status: value }))}>
              <SelectTrigger className="w-[170px]">
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

        <ModuleTableShell>
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableHeaderRow>
                <TableHead>Event</TableHead>
                <TableHead>Record</TableHead>
                <TableHead>Deliveries</TableHead>
                <TableHead>Last Error</TableHead>
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
                      <TableCell className="max-w-[280px] truncate text-sm text-red-200/80">
                        {failedDelivery?.error_message || "-"}
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
