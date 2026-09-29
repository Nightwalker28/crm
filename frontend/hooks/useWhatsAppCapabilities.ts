"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export type WhatsAppDeliveryMode = "external_link" | "meta_cloud_api";
export type WhatsAppDefaultMode = WhatsAppDeliveryMode | "ask_each_time";

export type WhatsAppModeCapability = {
  mode: WhatsAppDeliveryMode;
  enabled: boolean;
  available: boolean;
  unavailable_reason: "disabled_by_policy" | "not_configured" | null;
  sends_from_crm: boolean;
  tracks_delivery: boolean;
  receives_inbound: boolean;
};

export type WhatsAppCapabilities = {
  default_mode: WhatsAppDefaultMode;
  effective_mode: WhatsAppDefaultMode | null;
  modes: WhatsAppModeCapability[];
};

/**
 * The behaviour every workspace had before modes existed: external click-to-chat only.
 * It is what the server resolves for a workspace with no stored policy, so it is also
 * what the action does while the answer loads or if it cannot be fetched — the WhatsApp
 * button never flickers in, and a failed request never takes it away.
 */
export const EXTERNAL_ONLY_CAPABILITIES: WhatsAppCapabilities = {
  default_mode: "external_link",
  effective_mode: "external_link",
  modes: [
    {
      mode: "external_link",
      enabled: true,
      available: true,
      unavailable_reason: null,
      sends_from_crm: false,
      tracks_delivery: false,
      receives_inbound: false,
    },
  ],
};

async function fetchWhatsAppCapabilities(): Promise<WhatsAppCapabilities> {
  const res = await apiFetch("/whatsapp/capabilities");
  if (!res.ok) throw new Error(`WhatsApp capabilities failed with ${res.status}`);
  return (await res.json()) as WhatsAppCapabilities;
}

/**
 * Which WhatsApp modes this workspace can use (06 Phase 1).
 *
 * Only `external_link` exists today, so `canOpenExternally` is the one answer surfaces
 * read. A later phase adds the Meta mode and the chooser on top of the same response.
 */
export function useWhatsAppCapabilities() {
  const query = useQuery({
    queryKey: ["whatsapp-capabilities"],
    queryFn: fetchWhatsAppCapabilities,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const capabilities = query.data ?? EXTERNAL_ONLY_CAPABILITIES;
  const external = capabilities.modes.find((mode) => mode.mode === "external_link");
  return {
    capabilities,
    canOpenExternally: Boolean(external?.available),
  };
}
