"use client";

import { formatSnakeCaseLabel } from "@/lib/module-display";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, KeyRound, Package, Plus, RefreshCw, ShoppingCart, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { IntegrationSectionError } from "@/components/integrations/IntegrationSectionError";
import { StatusValue } from "@/components/ui/StatusValue";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
} from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

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

const emptyApiKeyDraft: ApiKeyDraft = {
  name: "",
  allowCatalogRead: true,
  allowOrdersWrite: false,
  allowedOrigins: "",
};

const orderStatusOptions = [
  { value: "submitted", label: "Submitted" },
  { value: "under_review", label: "Under Review" },
  { value: "confirmed", label: "Confirmed" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "rejected", label: "Rejected" },
];

function money(value: string | number | null | undefined, currency: string) {
  const amount = Number(value);
  return `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function parseCsv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function formatStatus(value: string) {
  return value.replace(/_/g, " ");
}

async function readJson(res: Response) {
  return res.json().catch(() => null);
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

export function IntegrationWebsiteWorkspace() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [apiKeyDraft, setApiKeyDraft] = useState<ApiKeyDraft>(emptyApiKeyDraft);
  const [latestApiKey, setLatestApiKey] = useState<string | null>(null);
  const [apiKeyEditorOpen, setApiKeyEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const websiteQuery = useQuery({
    queryKey: ["integrations", "website"],
    queryFn: fetchWebsiteIntegrations,
  });

  const apiKeys = websiteQuery.data?.apiKeys ?? [];
  const publishedCatalog = websiteQuery.data?.publishedCatalog ?? [];
  const publishedCatalogTotal = websiteQuery.data?.publishedCatalogTotal ?? 0;
  const websiteOrders = websiteQuery.data?.websiteOrders ?? [];
  const loading = websiteQuery.isLoading || websiteQuery.isFetching;
  const apiKeyDirty = JSON.stringify(apiKeyDraft) !== JSON.stringify(emptyApiKeyDraft);
  useUnsavedChangesGuard(apiKeyEditorOpen && (apiKeyDirty || Boolean(latestApiKey)), saving);

  function openApiKeyEditor() {
    setApiKeyDraft(emptyApiKeyDraft);
    setLatestApiKey(null);
    setApiKeyEditorOpen(true);
  }

  async function closeApiKeyEditor() {
    if (latestApiKey) {
      const confirmed = await confirm({
        title: "Close API key details?",
        description: "This secret is shown only once. Confirm that it has been copied into the connected website before closing.",
        confirmLabel: "Close details",
      });
      if (!confirmed) return;
    } else if (apiKeyDirty) {
      const confirmed = await confirm({
        title: "Discard API key draft?",
        description: "The unsaved key name, scopes, and allowed origins will be cleared.",
        confirmLabel: "Discard draft",
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    setApiKeyDraft(emptyApiKeyDraft);
    setLatestApiKey(null);
    setApiKeyEditorOpen(false);
  }

  function handleApiKeyEditorOpenChange(open: boolean) {
    if (open) {
      setApiKeyEditorOpen(true);
      return;
    }
    void closeApiKeyEditor();
  }

  async function copyApiKey() {
    if (!latestApiKey) return;
    try {
      await navigator.clipboard.writeText(latestApiKey);
      toast.success("API key copied.");
    } catch {
      toast.error("Failed to copy API key.");
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
      setSaving(true);
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
      setSaving(false);
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
      setSaving(true);
      const res = await apiFetch(`/integrations/api-keys/${key.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("revoke-api-key-failed");
      await queryClient.invalidateQueries({ queryKey: ["integrations", "website"] });
      toast.success("Website API key revoked.");
    } catch {
      toast.error("The API key could not be revoked. Try again.");
    } finally {
      setSaving(false);
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
      setSaving(true);
      const res = await apiFetch(`/integrations/api-keys/${key.id}/rotate`, { method: "POST" });
      const body = await readJson(res);
      if (!res.ok) throw new Error("rotate-api-key-failed");
      setLatestApiKey(typeof body?.api_key === "string" ? body.api_key : null);
      await queryClient.invalidateQueries({ queryKey: ["integrations", "website"] });
      toast.success("Website API key rotated.");
    } catch {
      toast.error("The API key could not be rotated. Try again.");
    } finally {
      setSaving(false);
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
      setSaving(true);
      const res = await apiFetch(`/integrations/orders/${order.id}/create-pos-invoice`, { method: "POST" });
      const body = await readJson(res);
      if (!res.ok) throw new Error("create-pos-invoice-failed");
      await queryClient.invalidateQueries({ queryKey: ["integrations", "website"] });
      toast.success(body?.already_existing ? "POS invoice already exists." : "POS invoice created from website order.");
    } catch {
      toast.error("The POS invoice could not be created. Try again.");
    } finally {
      setSaving(false);
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
      setSaving(true);
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
      setSaving(false);
    }
  }

  return (
    <section id="website-apis" aria-labelledby="website-apis-heading" className="flex scroll-mt-5 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="website-apis-heading" className="text-lg font-semibold text-copy-primary">Website APIs</h2>
          <p className="text-sm text-copy-muted">Manage API keys, public catalog items, and incoming website orders for WordPress or custom sites.</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void websiteQuery.refetch()}>
          <RefreshCw size={14} />
          Refresh
        </Button>
      </div>
      {websiteQuery.isError ? (
        <IntegrationSectionError
          message="Website integration data could not be loaded. Existing API keys, catalog settings, and orders are unchanged."
          retry={() => void websiteQuery.refetch()}
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-copy-primary">API Keys</h3>
          <p className="mt-1 text-sm text-copy-muted">Create scoped credentials for catalog reads and website order writeback.</p>
        </div>
        <Button type="button" size="sm" onClick={openApiKeyEditor}><Plus />New API key</Button>
      </div>

      <Sheet open={apiKeyEditorOpen} onOpenChange={handleApiKeyEditorOpenChange}>
        <SheetPortal>
          <SheetOverlay className="fixed inset-0 z-40 bg-overlay" />
          <SheetContent side="right" className="z-50 flex h-full w-full max-w-[34rem] flex-col border-l border-line-default bg-surface-raised outline-none">
            <div className="flex min-h-0 flex-1 flex-col">
              <SheetHeader className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
                <div>
                  <SheetTitle className="text-lg font-semibold text-copy-primary">Create API key</SheetTitle>
                  <SheetDescription className="mt-1 text-sm text-copy-muted">Create scoped website credentials. The secret is shown only once.</SheetDescription>
                </div>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Close API key editor" onClick={() => void closeApiKeyEditor()}><X /></Button>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="api-key-name">Key Name <RequiredMark /></FieldLabel>
                    <Input id="api-key-name" value={apiKeyDraft.name} onChange={(event) => setApiKeyDraft((current) => ({ ...current, name: event.target.value }))} placeholder="WordPress production" />
                  </Field>
                  <div className="grid gap-2">
                    <label className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-2 text-sm text-copy-secondary">
                      Catalog read
                      <Checkbox aria-label="Allow catalog read access" checked={apiKeyDraft.allowCatalogRead} onCheckedChange={(checked) => setApiKeyDraft((current) => ({ ...current, allowCatalogRead: checked === true }))} />
                    </label>
                    <label className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-2 text-sm text-copy-secondary">
                      Order writeback
                      <Checkbox aria-label="Allow order writeback access" checked={apiKeyDraft.allowOrdersWrite} onCheckedChange={(checked) => setApiKeyDraft((current) => ({ ...current, allowOrdersWrite: checked === true }))} />
                    </label>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="api-key-origins">Allowed Origins</FieldLabel>
                    <Textarea id="api-key-origins" value={apiKeyDraft.allowedOrigins} onChange={(event) => setApiKeyDraft((current) => ({ ...current, allowedOrigins: event.target.value }))} placeholder="https://example.com, https://www.example.com" className="min-h-20" />
                    <p className="text-p-xs text-copy-muted">Comma-separated browser origins. Leave empty only for server-to-server clients that do not send an Origin header.</p>
                  </Field>
                </FieldGroup>

                {latestApiKey ? (
                  <div role="status" className="mt-5 rounded-[var(--radius-control)] border border-state-success/40 bg-state-success-muted p-3">
                    <div className="mb-2 text-xs font-medium text-copy-muted">Copy this key now</div>
                    <div className="break-all font-mono text-xs text-copy-primary">{latestApiKey}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => void copyApiKey()}><Copy size={14} />Copy</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setLatestApiKey(null); setApiKeyEditorOpen(false); }}>Dismiss</Button>
                    </div>
                  </div>
                ) : null}
              </div>
              <SheetFooter className="flex justify-end gap-2 border-t border-line-subtle bg-surface px-5 py-4">
                <Button type="button" variant="outline" disabled={saving} onClick={() => void closeApiKeyEditor()}>Cancel</Button>
                <Button type="button" disabled={saving || Boolean(latestApiKey)} onClick={createApiKey}><KeyRound size={14} />{saving ? "Creating..." : "Create API Key"}</Button>
              </SheetFooter>
            </div>
          </SheetContent>
        </SheetPortal>
      </Sheet>

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
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-copy-muted">Loading website API keys...</TableCell>
                </TableRow>
              ) : apiKeys.length ? (
                apiKeys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium text-copy-primary">{key.name}</TableCell>
                    <TableCell className="font-mono text-xs text-copy-muted">{key.key_prefix}...</TableCell>
                    <TableCell className="text-copy-secondary">{key.scopes.join(", ")}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-copy-muted">{key.allowed_origins.length ? key.allowed_origins.join(", ") : "Any origin"}</TableCell>
                    <TableCell>
                      <StatusValue status={{ tone: key.status === "active" ? "success" : "critical", label: formatSnakeCaseLabel(key.status) }} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-copy-muted">{key.last_used_at ? formatDateTime(key.last_used_at) : "-"}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" disabled={saving || key.status !== "active"} onClick={() => rotateApiKey(key)}>
                          <RefreshCw size={14} />
                          Rotate
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={saving || key.status !== "active"} onClick={() => revokeApiKey(key)}>
                          <Trash2 size={14} />
                          Revoke
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-copy-muted">No website API keys yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
      </ModuleTableShell>

      <div>
        <h3 className="text-base font-semibold text-copy-primary">Published Catalog</h3>
        <p className="mt-1 text-sm text-copy-muted">Only active public products and services with slugs are exposed to integration API consumers.</p>
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
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-copy-muted">Loading published catalog...</TableCell>
              </TableRow>
            ) : publishedCatalog.length ? (
              publishedCatalog.map((item) => (
                <TableRow key={`${item.item_type}-${item.id}`}>
                  <TableCell>
                    <div className="font-medium text-copy-primary">{item.name}</div>
                    <div className="text-xs text-copy-muted">/{item.slug}{item.sku ? ` · ${item.sku}` : ""}</div>
                  </TableCell>
                  <TableCell className="text-copy-secondary">
                    {item.catalog_product_id ? `Product #${item.catalog_product_id}` : item.catalog_service_id ? `Service #${item.catalog_service_id}` : item.item_type}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-copy-secondary">{money(item.public_unit_price, item.currency)}</TableCell>
                  <TableCell className="text-copy-muted">
                    {item.item_type === "product" ? `${formatStatus(item.stock_status)}${item.stock_quantity != null ? ` · ${item.stock_quantity}` : ""}` : "Service"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-copy-muted">{formatDateTime(item.updated_at)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-copy-muted">No published catalog items are exposed yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ModuleTableShell>
      <div className="text-xs text-copy-muted">{publishedCatalogTotal} published item{publishedCatalogTotal === 1 ? "" : "s"} available through the public catalog API.</div>

      <div className="grid gap-5 md:grid-cols-2">
        {[
          {
            title: "Products",
            description: "Manage product records, public slugs, stock, pricing, and media in the Products module.",
            href: "/dashboard/catalog/products",
          },
          {
            title: "Services",
            description: "Manage service records, public slugs, pricing, availability, and media in the Services module.",
            href: "/dashboard/catalog/services",
          },
        ].map((item) => (
          <Card key={item.href} className="px-5 py-5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-default bg-surface-muted">
                <Package size={17} className="text-copy-secondary" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-copy-primary">{item.title}</h3>
                <p className="mt-1 text-sm text-copy-muted">{item.description}</p>
                <Button type="button" variant="outline" size="sm" className="mt-4" asChild>
                  <Link href={item.href}>Open {item.title}</Link>
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div>
        <h3 className="text-base font-semibold text-copy-primary">Website and Client Orders</h3>
        <p className="mt-1 text-sm text-copy-muted">Incoming website orders stay separate from internal POS invoices until reviewed or converted.</p>
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
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-copy-muted">Loading website orders...</TableCell>
              </TableRow>
            ) : websiteOrders.length ? (
              websiteOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium text-copy-primary">
                      <ShoppingCart size={14} className="text-copy-muted" />
                      {order.external_reference}
                    </div>
                    <div className="mt-1 text-xs text-copy-muted">{order.source_platform || "external site"}</div>
                    <div className="mt-2 max-w-[180px]">
                      <Select value={order.status} onValueChange={(value) => void updateOrderStatus(order, value)} disabled={saving}>
                        <SelectTrigger size="sm" className="bg-surface-muted text-xs" aria-label={`Status for order ${order.external_reference}`}>
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
                    <div className="text-copy-secondary">{order.customer_name || "-"}</div>
                    <div className="text-xs text-copy-muted">{order.customer_email || "-"}</div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[320px] truncate text-copy-secondary">
                      {order.line_items.map((line) => `${line.name} x ${line.quantity}`).join(", ")}
                    </div>
                    <div className="text-xs text-copy-muted">
                      {order.line_items.length} line{order.line_items.length === 1 ? "" : "s"}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-copy-secondary">{money(order.subtotal_amount, order.currency)}</TableCell>
                  <TableCell>
                    {order.pos_invoice_id ? (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/dashboard/finance/pos/${order.pos_invoice_id}/print`}>
                          <ExternalLink size={14} />
                          POS #{order.pos_invoice_id}
                        </Link>
                      </Button>
                    ) : (
                      <span className="text-sm text-copy-muted">Not created</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-copy-muted">{formatDateTime(order.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={saving || Boolean(order.pos_invoice_id)}
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
                <TableCell colSpan={7} className="py-10 text-center text-copy-muted">No website orders captured yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ModuleTableShell>
    </section>
  );
}
