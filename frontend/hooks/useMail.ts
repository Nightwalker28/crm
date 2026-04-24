"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export type MailConnection = {
  provider: "google" | "microsoft";
  status: "connected" | "disconnected" | "error";
  account_email?: string | null;
  provider_mailbox_id?: string | null;
  provider_mailbox_name?: string | null;
  can_send: boolean;
  can_sync: boolean;
  last_synced_at?: string | null;
  last_error?: string | null;
};

export type MailContext = {
  connections: MailConnection[];
  sync_available: boolean;
  sync_note: string;
};

export type MailMessage = {
  id: number;
  provider?: "google" | "microsoft" | null;
  provider_message_id?: string | null;
  provider_thread_id?: string | null;
  direction: "inbound" | "outbound" | "internal";
  folder: string;
  from_email?: string | null;
  from_name?: string | null;
  to_recipients?: Record<string, unknown>[] | null;
  cc_recipients?: Record<string, unknown>[] | null;
  bcc_recipients?: Record<string, unknown>[] | null;
  subject?: string | null;
  snippet?: string | null;
  body_text?: string | null;
  received_at?: string | null;
  sent_at?: string | null;
  source_module_key?: string | null;
  source_entity_id?: string | null;
  source_label?: string | null;
  created_at: string;
  updated_at: string;
};

export type MailMessageList = {
  results: MailMessage[];
};

export type MailProviderConnectResponse = {
  provider: "google" | "microsoft";
  auth_url: string;
};

export type MailSyncResponse = {
  provider: "google" | "microsoft";
  synced_message_count: number;
  status: "connected" | "disconnected" | "error";
  last_synced_at?: string | null;
  last_error?: string | null;
};

export type MailSendPayload = {
  provider: "google" | "microsoft";
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body_text?: string;
  source_module_key?: string | null;
  source_entity_id?: string | null;
  source_label?: string | null;
};

async function readJsonSafely(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchMailContext(): Promise<MailContext> {
  const res = await apiFetch("/mail/context");
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load mail context.");
  }
  return body as MailContext;
}

export async function fetchMailMessages({
  folder,
  search,
  limit = 50,
}: {
  folder?: string;
  search?: string;
  limit?: number;
}): Promise<MailMessageList> {
  const params = new URLSearchParams();
  if (folder) params.set("folder", folder);
  if (search?.trim()) params.set("search", search.trim());
  params.set("limit", String(limit));
  const res = await apiFetch(`/mail/messages?${params.toString()}`);
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load mail messages.");
  }
  return body as MailMessageList;
}

export async function connectMailProvider(provider: "google" | "microsoft"): Promise<MailProviderConnectResponse> {
  const res = await apiFetch(`/mail/connect/${provider}`, { method: "POST" });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || `Failed to connect ${provider} mail.`);
  }
  return body as MailProviderConnectResponse;
}

export async function syncMailProvider(provider: "google" | "microsoft"): Promise<MailSyncResponse> {
  const res = await apiFetch(`/mail/sync/${provider}`, { method: "POST" });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || `Failed to sync ${provider} mail.`);
  }
  return body as MailSyncResponse;
}

export async function sendMailMessage(payload: MailSendPayload): Promise<MailMessage> {
  const res = await apiFetch("/mail/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to send mail.");
  }
  return body as MailMessage;
}

export function useMailContext() {
  return useQuery({
    queryKey: ["mail-context"],
    queryFn: fetchMailContext,
    staleTime: 60_000,
  });
}

export function useMailMessages(folder?: string, search?: string) {
  return useQuery({
    queryKey: ["mail-messages", folder ?? "all", search ?? ""],
    queryFn: () => fetchMailMessages({ folder, search }),
    staleTime: 30_000,
  });
}

export function useMailActions() {
  const queryClient = useQueryClient();
  const connectMutation = useMutation({
    mutationFn: connectMailProvider,
  });
  const syncMutation = useMutation({
    mutationFn: syncMailProvider,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mail-context"] });
      await queryClient.invalidateQueries({ queryKey: ["mail-messages"] });
    },
  });
  const sendMutation = useMutation({
    mutationFn: sendMailMessage,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mail-messages"] });
    },
  });

  return {
    connectMail: connectMutation.mutateAsync,
    syncMail: syncMutation.mutateAsync,
    sendMail: sendMutation.mutateAsync,
    isConnectingMail: connectMutation.isPending,
    isSyncingMail: syncMutation.isPending,
    isSendingMail: sendMutation.isPending,
  };
}
