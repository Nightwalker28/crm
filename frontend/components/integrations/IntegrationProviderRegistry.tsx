import Link from "next/link";
import { PlugZap, RefreshCw } from "lucide-react";

import { IntegrationSectionError } from "@/components/integrations/IntegrationSectionError";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { formatDateTime } from "@/lib/datetime";

export type IntegrationRegistryHealth = {
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

function statusTone(status: string) {
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

function ProviderAction({
  item,
  connectingProvider,
  onConnectDocumentProvider,
}: {
  item: IntegrationRegistryHealth;
  connectingProvider: string | null;
  onConnectDocumentProvider: (providerKey: string) => void;
}) {
  const { provider, connection } = item;
  if (provider.key === "google_drive" || provider.key === "microsoft_onedrive") {
    const isConnecting = connectingProvider === provider.key;
    return (
      <Button type="button" variant="outline" size="sm" className="mt-4" disabled={Boolean(connectingProvider)} onClick={() => onConnectDocumentProvider(provider.key)}>
        {isConnecting ? "Connecting..." : connection.status === "connected" ? "Reconnect" : connection.reconnect_action || "Connect"}
      </Button>
    );
  }
  if (!connection.reconnect_url && !provider.metadata_json.config_href) return null;
  return (
    <Button variant="outline" size="sm" className="mt-4" asChild>
      <Link href={connection.reconnect_url || provider.metadata_json.config_href || "#"}>
        {connection.status === "connected" ? "Configure" : connection.reconnect_action || "Reconnect"}
      </Link>
    </Button>
  );
}

export function IntegrationProviderRegistry({
  items,
  isLoading,
  isFetching,
  isError,
  connectingProvider,
  onRetry,
  onConnectDocumentProvider,
}: {
  items: IntegrationRegistryHealth[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  connectingProvider: string | null;
  onRetry: () => void;
  onConnectDocumentProvider: (providerKey: string) => void;
}) {
  return (
    <section id="provider-registry" className="flex scroll-mt-5 flex-col gap-4" aria-labelledby="provider-registry-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="provider-registry-heading" className="text-lg font-semibold text-copy-primary">Provider Registry</h2>
          <p className="text-sm text-copy-muted">Connection state from mail, calendar, documents, website APIs, and webhook providers for this tenant.</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={isFetching} onClick={onRetry}>
          <RefreshCw />
          Refresh
        </Button>
      </div>
      {isError ? <IntegrationSectionError message="Provider health is temporarily unavailable. Your existing connections have not been changed." retry={onRetry} /> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading ? (
          <Card className="px-5 py-5 text-sm text-copy-muted md:col-span-2 xl:col-span-3">Loading provider health...</Card>
        ) : items.length ? (
          items.map((item) => {
            const { provider, connection } = item;
            const tone = statusTone(connection.status);
            return (
              <Card key={provider.key} className="px-5 py-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-default bg-surface-muted">
                      <PlugZap className="text-copy-secondary" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs uppercase text-copy-muted">{provider.category}</div>
                      <h3 className="mt-1 text-base font-semibold text-copy-primary">{provider.name}</h3>
                    </div>
                  </div>
                  <Pill bg={tone.bg} text={tone.text} border={tone.border}>{formatStatus(connection.status)}</Pill>
                </div>
                <p className="mt-3 text-sm leading-5 text-copy-muted">{provider.description}</p>
                <div className="mt-4 grid gap-2 text-xs text-copy-muted">
                  <div><span>Account: </span><span className="text-copy-secondary">{connection.account_label || (connection.connection_count ? "Connected account" : "Not connected")}</span></div>
                  <div className="grid grid-cols-2 gap-2">
                    <Metric label="Connections" value={connection.connection_count} />
                    <Metric label="Queued" value={connection.queued_jobs} />
                    <Metric label="Failed" value={connection.failed_jobs} danger={connection.failed_jobs > 0} />
                    <Metric label="Credentials" value={formatStatus(connection.credential_state)} />
                  </div>
                  <div>Health: {formatStatus(connection.health_status)}</div>
                  <div>{connection.last_sync_at ? `Last activity ${formatDateTime(connection.last_sync_at)}` : "No activity recorded"}</div>
                  <div>{connection.last_successful_sync_at ? `Last successful run ${formatDateTime(connection.last_successful_sync_at)}` : "No successful run recorded"}</div>
                  {connection.scopes.length ? <div className="truncate">Scopes: {connection.scopes.join(", ")}</div> : null}
                  {connection.last_failure_reason || connection.last_error ? (
                    <div role="alert" className="rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-3 py-2 leading-5 text-copy-primary">
                      This connection needs attention. Review its configuration or reconnect, then try again.
                    </div>
                  ) : null}
                  {connection.help_text ? <div className="leading-5 text-copy-secondary">{connection.help_text}</div> : null}
                </div>
                <ProviderAction item={item} connectingProvider={connectingProvider} onConnectDocumentProvider={onConnectDocumentProvider} />
              </Card>
            );
          })
        ) : (
          <Card className="px-5 py-5 text-sm text-copy-muted md:col-span-2 xl:col-span-3">No integration providers registered.</Card>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-2">
      <div className="text-copy-muted">{label}</div>
      <div className={`mt-1 truncate text-sm font-medium ${danger ? "text-state-danger" : "text-copy-primary"}`}>{value}</div>
    </div>
  );
}
