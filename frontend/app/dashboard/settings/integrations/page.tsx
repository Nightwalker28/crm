"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { IntegrationEventHistory } from "@/components/integrations/IntegrationEventHistory";
import { IntegrationProviderRegistry, type IntegrationRegistryHealth } from "@/components/integrations/IntegrationProviderRegistry";
import { IntegrationWebhookWorkspace } from "@/components/integrations/IntegrationWebhookWorkspace";
import { IntegrationWebsiteWorkspace } from "@/components/integrations/IntegrationWebsiteWorkspace";
import { PageHeader } from "@/components/ui/PageHeader";
import { connectGoogleDriveStorage, connectMicrosoftOneDriveStorage } from "@/hooks/useDocuments";
import { apiFetch } from "@/lib/api";

async function fetchRegistryHealth() {
  const res = await apiFetch("/admin/integrations-registry/health");
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("integration-health-unavailable");
  return Array.isArray(body?.results) ? body.results as IntegrationRegistryHealth[] : [];
}

export default function IntegrationsPage() {
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const registryQuery = useQuery({
    queryKey: ["integrations", "registry-health"],
    queryFn: fetchRegistryHealth,
  });
  const registryHealth = registryQuery.data ?? [];

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

  return (
    <div className="flex flex-col gap-5 text-copy-secondary">
      <PageHeader
        title="Integrations"
        description="Review provider health, manage website API access, and configure external alert webhooks."
      />

      <IntegrationProviderRegistry
        items={registryHealth}
        isLoading={registryQuery.isLoading}
        isFetching={registryQuery.isFetching}
        isError={registryQuery.isError}
        connectingProvider={connectingProvider}
        onRetry={() => void registryQuery.refetch()}
        onConnectDocumentProvider={(providerKey) => void connectDocumentProvider(providerKey)}
      />

      <IntegrationWebsiteWorkspace />

      <IntegrationWebhookWorkspace />

      <IntegrationEventHistory />
    </div>
  );
}
