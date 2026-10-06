"use client";

import { formatSnakeCaseLabel } from "@/lib/module-display";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Package, Plus, RefreshCw, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { StatusValue } from "@/components/ui/StatusValue";
import { PanelError } from "@/components/ui/PanelStates";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RecordTable } from "@/components/ui/RecordTable";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { EditorPanel } from "@/components/ui/EditorPanel";
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
  item_type: "product" | "service";
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
  const [keysRes, catalogRes] = await Promise.all([
    apiFetch("/integrations/api-keys"),
    apiFetch("/integrations/catalog/published?limit=10&offset=0"),
  ]);
  const [keysBody, catalogBody] = await Promise.all([readJson(keysRes), readJson(catalogRes)]);
  if (!keysRes.ok || !catalogRes.ok) throw new Error("website-integrations-unavailable");
  return {
    apiKeys: Array.isArray(keysBody) ? keysBody as IntegrationApiKey[] : [],
    publishedCatalog: Array.isArray(catalogBody?.results) ? catalogBody.results as WebsiteCatalogItem[] : [],
    publishedCatalogTotal: typeof catalogBody?.total_count === "number" ? catalogBody.total_count : 0,
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
      toast.error("The key could not be copied. Select it and copy it by hand.");
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

  return (
    <section id="website-apis" aria-labelledby="website-apis-heading" className="flex scroll-mt-5 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="website-apis-heading" className="text-lg font-semibold text-copy-primary">Website APIs</h2>
          <p className="text-sm text-copy-muted">Manage API keys and the public catalog for WordPress or custom sites; their orders arrive as sales orders.</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void websiteQuery.refetch()}>
          <RefreshCw size={14} />
          Refresh
        </Button>
      </div>
      {websiteQuery.isError ? (
        <PanelError
          message="Website integration data could not be loaded. Existing API keys and catalog settings are unchanged."
          onRetry={() => void websiteQuery.refetch()}
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-copy-primary">API keys</h3>
          <p className="mt-1 text-sm text-copy-muted">Create scoped credentials for catalog reads and website order writeback.</p>
        </div>
        <Button type="button" size="sm" onClick={openApiKeyEditor}><Plus />New API key</Button>
      </div>

      <EditorPanel
        open={apiKeyEditorOpen}
        onOpenChange={handleApiKeyEditorOpenChange}
        title="Create API key"
        description="Create scoped website credentials. The secret is shown only once."
        closeLabel="Close API key editor"
        onSubmit={() => void createApiKey()}
        footer={(
          <>
            <Button type="button" variant="outline" disabled={saving} onClick={() => void closeApiKeyEditor()}>Cancel</Button>
            <Button type="submit" disabled={saving || Boolean(latestApiKey)}><KeyRound size={14} />{saving ? "Creating\u2026" : "Create API key"}</Button>
          </>
        )}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="api-key-name">Key name <RequiredMark /></FieldLabel>
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
            <FieldLabel htmlFor="api-key-origins">Allowed origins</FieldLabel>
            <Textarea id="api-key-origins" value={apiKeyDraft.allowedOrigins} onChange={(event) => setApiKeyDraft((current) => ({ ...current, allowedOrigins: event.target.value }))} placeholder="https://example.com, https://www.example.com" className="min-h-20" />
            <p className="text-p-xs text-copy-muted">Comma-separated browser origins. Leave empty only for server-to-server clients that do not send an Origin header.</p>
          </Field>
        </FieldGroup>

        {latestApiKey ? (
          <div role="status" className="mt-4 rounded-[var(--radius-control)] border border-state-success/40 bg-state-success-muted p-3">
            <div className="mb-2 text-xs font-medium text-copy-muted">Copy this key now</div>
            <div className="break-all font-mono text-xs text-copy-primary">{latestApiKey}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void copyApiKey()}><Copy size={14} />Copy</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setLatestApiKey(null); setApiKeyEditorOpen(false); }}>Dismiss</Button>
            </div>
          </div>
        ) : null}
      </EditorPanel>

      <RecordTable
        label="Website API keys"
        rows={apiKeys}
        rowKey={(key) => key.id}
        isLoading={loading}
        emptyState={{
          title: "No website API keys yet",
          description: "Create a key to let your website read the catalog or write orders back.",
        }}
        columns={[
          { key: "name", label: "Name", render: (key) => <span className="font-medium text-copy-primary">{key.name}</span> },
          { key: "prefix", label: "Prefix", size: "sm", render: (key) => <span className="font-mono text-xs text-copy-muted">{key.key_prefix}...</span> },
          { key: "scopes", label: "Scopes", size: "lg", render: (key) => <span className="text-copy-secondary">{key.scopes.join(", ")}</span> },
          {
            key: "origins",
            label: "Origins",
            size: "lg",
            render: (key) => (
              <span className="block max-w-[220px] truncate text-copy-muted">
                {key.allowed_origins.length ? key.allowed_origins.join(", ") : "Any origin"}
              </span>
            ),
          },
          {
            key: "status",
            label: "Status",
            render: (key) => (
              <StatusValue status={{ tone: key.status === "active" ? "success" : "critical", label: formatSnakeCaseLabel(key.status) }} />
            ),
          },
          {
            key: "last_used",
            label: "Last used",
            render: (key) => <span className="whitespace-nowrap text-copy-muted">{key.last_used_at ? formatDateTime(key.last_used_at) : "-"}</span>,
          },
        ]}
        rowActions={(key) => (
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
        )}
      />

      <div>
        <h3 className="text-base font-semibold text-copy-primary">Published catalog</h3>
        <p className="mt-1 text-sm text-copy-muted">Only active public products and services with slugs are exposed to integration API consumers.</p>
      </div>

      <RecordTable
        label="Published catalog"
        rows={publishedCatalog}
        rowKey={(item) => `${item.item_type}-${item.id}`}
        isLoading={loading}
        emptyState={{
          title: "No published catalog items are exposed yet",
          description: "A product or service needs an active public status and a slug before it reaches the API.",
        }}
        columns={[
          {
            key: "item",
            label: "Item",
            size: "lg",
            render: (item) => (
              <>
                <div className="font-medium text-copy-primary">{item.name}</div>
                <div className="text-xs text-copy-muted">/{item.slug}{item.sku ? ` · ${item.sku}` : ""}</div>
              </>
            ),
          },
          {
            key: "mapping",
            label: "Mapping",
            render: (item) => (
              <span className="text-copy-secondary">
                {item.catalog_product_id ? `Product #${item.catalog_product_id}` : item.catalog_service_id ? `Service #${item.catalog_service_id}` : item.item_type}
              </span>
            ),
          },
          {
            key: "price",
            label: "Price",
            render: (item) => <span className="whitespace-nowrap text-copy-secondary">{money(item.public_unit_price, item.currency)}</span>,
          },
          {
            key: "stock",
            label: "Stock",
            render: (item) => (
              <span className="text-copy-muted">
                {item.item_type === "product" ? `${formatStatus(item.stock_status)}${item.stock_quantity != null ? ` · ${item.stock_quantity}` : ""}` : "Service"}
              </span>
            ),
          },
          {
            key: "updated",
            label: "Updated",
            render: (item) => <span className="whitespace-nowrap text-copy-muted">{formatDateTime(item.updated_at)}</span>,
          },
        ]}
      />
      <div className="text-xs text-copy-muted">{publishedCatalogTotal} published item{publishedCatalogTotal === 1 ? "" : "s"} available through the public catalog API.</div>

      <div className="grid gap-6 md:grid-cols-2">
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
          <Card key={item.href} className="p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-default bg-surface-muted">
                <Package size={17} className="text-copy-secondary" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-copy-primary">{item.title}</h3>
                <p className="mt-1 text-sm text-copy-muted">{item.description}</p>
                <Button type="button" variant="outline" size="sm" className="mt-4" asChild>
                  <Link href={item.href}>Open {item.title.toLocaleLowerCase()}</Link>
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-default bg-surface-muted">
            <ShoppingCart size={17} className="text-copy-secondary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-copy-primary">Website orders</h3>
            <p className="mt-1 text-sm text-copy-muted">
              An order your website sends becomes a sales order: confirmed, holding stock, and delivered and invoiced from the order page.
              Client-portal orders arrive the same way, as drafts to confirm. Filter Orders by Source to see them.
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-4" asChild>
              <Link href="/dashboard/sales/orders">Open orders</Link>
            </Button>
          </div>
        </div>
      </Card>
    </section>
  );
}
