"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export type MailConnection = {
  provider: MailProvider;
  status: "connected" | "disconnected" | "error";
  account_email?: string | null;
  provider_mailbox_id?: string | null;
  provider_mailbox_name?: string | null;
  sync_cursor?: string | null;
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
  provider?: MailProvider | null;
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
  provider: MailProvider;
  auth_url: string;
};

export type MailSyncResponse = {
  provider: MailProvider;
  synced_message_count: number;
  status: "connected" | "disconnected" | "error";
  last_synced_at?: string | null;
  last_error?: string | null;
};

export type MailDisconnectResponse = {
  provider: MailProvider;
  status: "connected" | "disconnected" | "error";
};

export type MailSendPayload = {
  provider: MailProvider;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body_text?: string;
  source_module_key?: string | null;
  source_entity_id?: string | null;
  source_label?: string | null;
};

export type MailProvider = "google" | "microsoft" | "imap_smtp";

export type ImapSmtpConnectPayload = {
  account_email: string;
  imap_host: string;
  imap_port: number;
  imap_security: "ssl" | "starttls" | "none";
  imap_username: string;
  smtp_host: string;
  smtp_port: number;
  smtp_security: "ssl" | "starttls" | "none";
  smtp_username?: string | null;
  password: string;
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

export async function connectImapSmtpProvider(payload: ImapSmtpConnectPayload): Promise<MailContext> {
  const res = await apiFetch("/mail/connect/imap-smtp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to connect IMAP/SMTP mail.");
  }
  return body as MailContext;
}

export async function syncMailProvider(provider: MailProvider): Promise<MailSyncResponse> {
  const res = await apiFetch(`/mail/sync/${provider}`, { method: "POST" });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || `Failed to sync ${provider} mail.`);
  }
  return body as MailSyncResponse;
}

export async function disconnectMailProvider(provider: MailProvider): Promise<MailDisconnectResponse> {
  const res = await apiFetch(`/mail/connect/${provider}`, { method: "DELETE" });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || `Failed to disconnect ${provider} mail.`);
  }
  return body as MailDisconnectResponse;
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
  const connectImapSmtpMutation = useMutation({
    mutationFn: connectImapSmtpProvider,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mail-context"] });
    },
  });
  const syncMutation = useMutation({
    mutationFn: syncMailProvider,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mail-context"] });
      await queryClient.invalidateQueries({ queryKey: ["mail-messages"] });
    },
  });
  const disconnectMutation = useMutation({
    mutationFn: disconnectMailProvider,
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
    connectImapSmtp: connectImapSmtpMutation.mutateAsync,
    syncMail: syncMutation.mutateAsync,
    disconnectMail: disconnectMutation.mutateAsync,
    sendMail: sendMutation.mutateAsync,
    isConnectingMail: connectMutation.isPending || connectImapSmtpMutation.isPending,
    isSyncingMail: syncMutation.isPending,
    isDisconnectingMail: disconnectMutation.isPending,
    isSendingMail: sendMutation.isPending,
  };
}
