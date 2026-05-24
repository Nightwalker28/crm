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

export type MailMessageLinkPayload = {
  source_module_key: string;
  source_entity_id: string;
};

export type MailProvider = "google" | "microsoft" | "imap_smtp";
export type OAuthMailProvider = Exclude<MailProvider, "imap_smtp">;

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

async function fetchMailContext(): Promise<MailContext> {
  const res = await apiFetch("/mail/context");
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load mail context.");
  }
  return body as MailContext;
}

async function fetchMailMessages({
  folder,
  search,
  limit = 50,
  beforeId,
}: {
  folder?: string;
  search?: string;
  limit?: number;
  beforeId?: number;
}): Promise<MailMessageList> {
  const normalizedFolder = normalizeMailFolder(folder);
  const normalizedSearch = (search ?? "").trim();
  const params = new URLSearchParams();
  if (normalizedFolder) params.set("folder", normalizedFolder);
  if (normalizedSearch.length >= 2) params.set("search", normalizedSearch);
  if (beforeId) params.set("before_id", String(beforeId));
  params.set("limit", String(limit));
  const res = await apiFetch(`/mail/messages?${params.toString()}`);
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load mail messages.");
  }
  return body as MailMessageList;
}

function normalizeMailFolder(folder?: string | null) {
  const normalized = (folder ?? "").trim().toLowerCase();
  return normalized || undefined;
}

async function connectMailProvider(provider: OAuthMailProvider): Promise<MailProviderConnectResponse> {
  const res = await apiFetch(`/mail/connect/${provider}`, { method: "POST" });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || `Failed to connect ${provider} mail.`);
  }
  return body as MailProviderConnectResponse;
}

async function connectImapSmtpProvider(payload: ImapSmtpConnectPayload): Promise<MailContext> {
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

async function syncMailProvider(provider: MailProvider): Promise<MailSyncResponse> {
  const res = await apiFetch(`/mail/sync/${provider}`, { method: "POST" });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || `Failed to sync ${provider} mail.`);
  }
  return body as MailSyncResponse;
}

async function disconnectMailProvider(provider: MailProvider): Promise<MailDisconnectResponse> {
  const res = await apiFetch(`/mail/connect/${provider}`, { method: "DELETE" });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || `Failed to disconnect ${provider} mail.`);
  }
  return body as MailDisconnectResponse;
}

async function sendMailMessage(payload: MailSendPayload): Promise<MailMessage> {
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

async function fetchMailMessage(messageId: number | string): Promise<MailMessage> {
  const res = await apiFetch(`/mail/messages/${messageId}`);
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load mail message.");
  }
  return body as MailMessage;
}

async function linkMailMessage({ messageId, payload }: { messageId: number; payload: MailMessageLinkPayload }): Promise<MailMessage> {
  const res = await apiFetch(`/mail/messages/${messageId}/link`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to link mail message.");
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

export function useMailMessages(folder?: string, search?: string, beforeId?: number) {
  const queryClient = useQueryClient();
  const normalizedFolder = normalizeMailFolder(folder);
  const normalizedSearch = (search ?? "").trim();
  return useQuery({
    queryKey: ["mail-messages", normalizedFolder ?? "all", normalizedSearch, beforeId ?? "latest"],
    queryFn: () => fetchMailMessages({ folder: normalizedFolder, search: normalizedSearch, beforeId }),
    enabled: normalizedSearch.length === 0 || normalizedSearch.length >= 2,
    placeholderData: () => {
      if (beforeId || normalizedSearch || normalizedFolder !== "inbox") return undefined;
      const allMessages = queryClient.getQueryData<MailMessageList>(["mail-messages", "all", "", "latest"]);
      if (!allMessages) return undefined;
      return {
        ...allMessages,
        results: allMessages.results.filter((message) => message.folder === "inbox"),
      };
    },
    staleTime: 30_000,
  });
}

export function useMailMessage(messageId?: number | null) {
  return useQuery({
    queryKey: ["mail-message", messageId],
    queryFn: () => fetchMailMessage(messageId as number),
    enabled: Boolean(messageId),
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
  const linkMutation = useMutation({
    mutationFn: linkMailMessage,
    onSuccess: async (message) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mail-messages"] }),
        queryClient.invalidateQueries({ queryKey: ["mail-message", message.id] }),
      ]);
    },
  });

  return {
    connectMail: connectMutation.mutateAsync,
    connectImapSmtp: connectImapSmtpMutation.mutateAsync,
    syncMail: syncMutation.mutateAsync,
    disconnectMail: disconnectMutation.mutateAsync,
    sendMail: sendMutation.mutateAsync,
    linkMail: (messageId: number, payload: MailMessageLinkPayload) => linkMutation.mutateAsync({ messageId, payload }),
    isConnectingMail: connectMutation.isPending || connectImapSmtpMutation.isPending,
    isSyncingMail: syncMutation.isPending,
    isDisconnectingMail: disconnectMutation.isPending,
    isSendingMail: sendMutation.isPending,
    isLinkingMail: linkMutation.isPending,
  };
}
