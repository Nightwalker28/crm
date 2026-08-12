"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { MailMessage, MailProvider } from "@/hooks/useMail";
import { recordActivityQueryKeyPrefix } from "@/hooks/useRecordActivity";
import type { RecordModuleKey } from "@/types/record-activity";

/**
 * Contextual send from a CRM record
 * (`POST /mail/records/{module_key}/{entity_id}/send`).
 *
 * The record is part of the address, not the body: this hook cannot send mail
 * that is not attached to a record. Provider selection, credentials, linkage,
 * and delivery all stay behind that endpoint — nothing here knows what Gmail,
 * Graph, or SMTP are.
 */

/** The backend's failure taxonomy. Each one has a different recovery. */
export type RecordMailErrorCode =
  | "validation"
  | "mailbox_disconnected"
  | "provider_rejected"
  | "provider_unavailable"
  | "send_in_flight"
  | "permission_denied"
  | "unknown";

export class RecordMailError extends Error {
  constructor(
    readonly code: RecordMailErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly reconnectRequired: boolean,
  ) {
    super(message);
    this.name = "RecordMailError";
  }
}

export type RecordMailTemplate = {
  id: number;
  name: string;
  body: string;
  variables: string[];
};

export type RecordMailAttachment = {
  document_id: number;
  filename: string;
  content_type?: string | null;
  size_bytes?: number | null;
};

export type RecordMailSendPayload = {
  provider: MailProvider;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body_text?: string;
  template_id?: number | null;
  attachment_document_ids?: number[];
  /** Stable across retries of one compose attempt, so a retry never duplicates. */
  idempotency_key?: string;
};

const CODES: RecordMailErrorCode[] = [
  "validation",
  "mailbox_disconnected",
  "provider_rejected",
  "provider_unavailable",
  "send_in_flight",
];

const FALLBACK_MESSAGES: Record<RecordMailErrorCode, string> = {
  validation: "Check the message details and try again.",
  mailbox_disconnected: "Reconnect your mailbox before sending.",
  provider_rejected: "Your mail provider refused this message.",
  provider_unavailable: "Your mail provider is temporarily unavailable. The message was not sent.",
  send_in_flight: "This email is already being sent. Check your sent mail before trying again.",
  permission_denied: "You do not have permission to send email from this record.",
  unknown: "We could not send this email.",
};

async function readJsonSafely(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function toRecordMailError(status: number, body: unknown): RecordMailError {
  const detail = (body as { detail?: unknown } | null)?.detail;

  // The send path answers with a structured detail so the composer can offer
  // the right recovery. Anything else (a 403 from the permission layer, an
  // unexpected shape) degrades to a safe, non-retryable message.
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const shaped = detail as Record<string, unknown>;
    const rawCode = typeof shaped.code === "string" ? shaped.code : "";
    const code = (CODES as string[]).includes(rawCode)
      ? (rawCode as RecordMailErrorCode)
      : "unknown";
    return new RecordMailError(
      code,
      typeof shaped.message === "string" && shaped.message.trim()
        ? shaped.message
        : FALLBACK_MESSAGES[code],
      shaped.retryable === true,
      shaped.reconnect_required === true,
    );
  }

  if (status === 401 || status === 403) {
    return new RecordMailError("permission_denied", FALLBACK_MESSAGES.permission_denied, false, false);
  }
  if (status >= 500) {
    return new RecordMailError("provider_unavailable", FALLBACK_MESSAGES.provider_unavailable, true, false);
  }
  return new RecordMailError("unknown", FALLBACK_MESSAGES.unknown, false, false);
}

async function fetchEmailTemplates(): Promise<RecordMailTemplate[]> {
  const res = await apiFetch("/message-templates?channel=email");
  const body = await readJsonSafely(res);
  if (!res.ok) {
    // Templates are optional in the composer; the caller renders without them.
    throw new Error("Email templates could not be loaded.");
  }
  return (body?.results ?? []) as RecordMailTemplate[];
}

/**
 * Email templates the composer can insert.
 *
 * `retry: false` because the common failure is "this user cannot view
 * templates", which will not change by asking again.
 */
export function useEmailTemplates(enabled = true) {
  return useQuery({
    queryKey: ["message-templates", "email"],
    queryFn: fetchEmailTemplates,
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useRecordMailSend({
  moduleKey,
  entityId,
}: {
  moduleKey: RecordModuleKey;
  entityId: string | number;
}) {
  const queryClient = useQueryClient();
  const entityKey = String(entityId);

  return useMutation<MailMessage, RecordMailError, RecordMailSendPayload>({
    mutationFn: async (payload) => {
      const res = await apiFetch(
        `/mail/records/${encodeURIComponent(moduleKey)}/${encodeURIComponent(entityKey)}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await readJsonSafely(res);
      if (!res.ok) throw toRecordMailError(res.status, body);
      return body as MailMessage;
    },
    onSuccess: async () => {
      // The sent message reaches the record through the mail association the
      // send already wrote, so refreshing the activity feed is all that is
      // needed — there is no separate link to create here.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [recordActivityQueryKeyPrefix, moduleKey, entityKey],
        }),
        queryClient.invalidateQueries({ queryKey: ["mail-messages"] }),
      ]);
    },
  });
}
