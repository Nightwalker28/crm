"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { QuickCreateSurface } from "@/components/ui/QuickCreateSurface";
import { RequiredMark } from "@/components/ui/RequiredMark";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDocuments } from "@/hooks/useDocuments";
import { useMailContext } from "@/hooks/useMail";
import type { MailConnection, MailProvider } from "@/hooks/useMail";
import {
  useEmailTemplates,
  useRecordMailSend,
  RecordMailError,
} from "@/hooks/useRecordMail";
import type { RecordModuleKey } from "@/types/record-activity";

/**
 * Contextual email composer for one CRM record.
 *
 * Bounded on purpose: this is the "reply to this relationship" surface, not a
 * second mail client. It knows about mailboxes, recipients, a subject, a plain
 * body, CRM documents, and templates — and nothing about Gmail, Microsoft
 * Graph, or SMTP. Every provider decision belongs to the mail domain behind
 * `POST /mail/records/{module_key}/{entity_id}/send`.
 */

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moduleKey: RecordModuleKey;
  entityId: string | number;
  recordLabel: string;
  /** Prefilled recipient — the record's own address. */
  defaultRecipient?: string | null;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
};

const EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const MAX_ATTACHMENTS = 5;

function providerLabel(provider: MailProvider) {
  if (provider === "google") return "Gmail";
  if (provider === "microsoft") return "Microsoft";
  return "IMAP/SMTP";
}

function connectionLabel(connection: MailConnection) {
  return connection.account_email
    ? `${providerLabel(connection.provider)} — ${connection.account_email}`
    : providerLabel(connection.provider);
}

function parseRecipients(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function invalidRecipient(value: string) {
  return parseRecipients(value).find((entry) => !EMAIL_PATTERN.test(entry));
}

function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `compose-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatBytes(bytes?: number | null) {
  if (!bytes || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RecordEmailComposer({
  open,
  onOpenChange,
  moduleKey,
  entityId,
  recordLabel,
  defaultRecipient,
  returnFocusRef,
}: Props) {
  const contextQuery = useMailContext();
  const documentsQuery = useDocuments({ moduleKey, entityId, limit: 25 });
  const templatesQuery = useEmailTemplates(open);
  const sendMutation = useRecordMailSend({ moduleKey, entityId });

  const [providerOverride, setProviderOverride] = useState<MailProvider | null>(null);
  const [to, setTo] = useState(defaultRecipient ?? "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCopyFields, setShowCopyFields] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [attachmentIds, setAttachmentIds] = useState<number[]>([]);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<RecordMailError | null>(null);
  // Held stable across retries so a transient failure can be resent without
  // risking a second delivery of the same message. The caller remounts this
  // component per compose session, so a fresh draft always gets a fresh key.
  const [idempotencyKey] = useState(newIdempotencyKey);

  const connections = contextQuery.data?.connections;
  const sendConnections = useMemo(
    () => (connections ?? []).filter((connection) => connection.can_send),
    [connections],
  );
  const reconnectableConnections = useMemo(
    () => (connections ?? []).filter((connection) => !connection.can_send && connection.reconnect_required),
    [connections],
  );
  const provider =
    providerOverride && sendConnections.some((connection) => connection.provider === providerOverride)
      ? providerOverride
      : sendConnections[0]?.provider;
  const selectedConnection = sendConnections.find((connection) => connection.provider === provider);
  const documents = documentsQuery.data?.results ?? [];
  const templates = templatesQuery.data ?? [];

  const isDirty = Boolean(
    subject.trim()
      || body.trim()
      || cc.trim()
      || bcc.trim()
      || attachmentIds.length
      || to.trim() !== (defaultRecipient ?? "").trim(),
  );

  function toggleAttachment(documentId: number, checked: boolean) {
    setAttachmentIds((current) => {
      if (!checked) return current.filter((id) => id !== documentId);
      if (current.includes(documentId) || current.length >= MAX_ATTACHMENTS) return current;
      return [...current, documentId];
    });
  }

  function insertTemplate(value: string) {
    const template = templates.find((entry) => String(entry.id) === value);
    if (!template) return;
    setTemplateId(template.id);
    // Insert rather than replace: the template is a starting point the user is
    // expected to edit before sending.
    setBody((current) => (current.trim() ? `${current}\n\n${template.body}` : template.body));
  }

  async function handleSend() {
    const recipients = parseRecipients(to);
    const ccRecipients = parseRecipients(cc);
    const bccRecipients = parseRecipients(bcc);

    if (!recipients.length) {
      setRecipientError("Add at least one recipient.");
      return;
    }
    const badRecipient = invalidRecipient(to);
    if (badRecipient) {
      setRecipientError(`Enter a valid email address for ${badRecipient}.`);
      return;
    }
    const badCopy = invalidRecipient(cc) ?? invalidRecipient(bcc);
    if (badCopy) {
      setShowCopyFields(true);
      setCopyError(`Enter a valid email address for ${badCopy}.`);
      return;
    }
    if (!provider) {
      // Reachable if the mailbox is disconnected while the composer is open.
      // Say so rather than letting Send quietly do nothing.
      const noMailbox = new RecordMailError(
        "mailbox_disconnected",
        "No connected mailbox can send this email. Reconnect a mailbox and try again.",
        false,
        true,
      );
      setSendError(noMailbox);
      throw noMailbox;
    }

    setRecipientError(null);
    setCopyError(null);
    setSendError(null);
    try {
      await sendMutation.mutateAsync({
        provider,
        to: recipients,
        cc: ccRecipients,
        bcc: bccRecipients,
        subject: subject.trim(),
        body_text: body,
        template_id: templateId,
        attachment_document_ids: attachmentIds,
        idempotency_key: idempotencyKey,
      });
      toast.success(`Email sent to ${recordLabel}.`);
      onOpenChange(false);
    } catch (error) {
      const mailError =
        error instanceof RecordMailError
          ? error
          : new RecordMailError("unknown", "We could not send this email.", false, false);
      setSendError(mailError);
      // A non-retryable failure keeps its key too: it is the same attempt, and
      // reusing it means a fix-and-resend can never double-deliver.
      throw mailError;
    }
  }

  const errorBanner = sendError ? (
    <div className="grid gap-2">
      <p>{sendError.message}</p>
      {sendError.reconnectRequired ? (
        <Link
          href="/dashboard/mail"
          className="w-fit underline underline-offset-4"
          onClick={() => onOpenChange(false)}
        >
          Reconnect a mailbox
        </Link>
      ) : null}
      {sendError.retryable ? (
        <p className="text-p-xs text-copy-muted">
          Nothing was delivered. Choosing Send again resends this same message — it cannot arrive twice.
        </p>
      ) : null}
      {sendError.code === "send_in_flight" ? (
        <p className="text-p-xs text-copy-muted">
          Close this composer and check your sent mail before composing again.
        </p>
      ) : null}
    </div>
  ) : null;

  const hasSendingMailbox = sendConnections.length > 0;

  return (
    <QuickCreateSurface
      open={open}
      onOpenChange={onOpenChange}
      title={`Email ${recordLabel}`}
      description="Send from a connected mailbox. The message is filed against this record."
      onSubmit={handleSend}
      isDirty={isDirty}
      isPending={sendMutation.isPending}
      isLoading={contextQuery.isLoading}
      returnFocusRef={returnFocusRef}
      showCreateAndOpen={false}
      createLabel="Send email"
      pendingLabel="Sending..."
      error={errorBanner}
      submitErrorMessage="We could not send this email."
      statusMessage={
        selectedConnection
          ? `Sending as ${selectedConnection.account_email ?? providerLabel(selectedConnection.provider)}`
          : undefined
      }
      discardTitle="Discard this email?"
      discardDescription="Your unsent message will be lost."
    >
      {contextQuery.error ? (
        <p role="alert" className="text-p-sm text-state-danger">
          We could not load your mailbox connections. Try again from the Mail page.
        </p>
      ) : !hasSendingMailbox ? (
        <div className="grid gap-3" role="status">
          <p className="text-p-sm text-copy-secondary">
            {reconnectableConnections.length
              ? "Your mailbox needs to be reconnected before you can send email from a record."
              : "No mailbox is connected yet, so email cannot be sent from inside Lynk."}
          </p>
          <p className="text-p-sm text-copy-muted">
            You can still write this email in your own mail app — it just will not be filed against
            this record automatically.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/dashboard/mail" onClick={() => onOpenChange(false)}>
                {reconnectableConnections.length ? "Reconnect a mailbox" : "Connect a mailbox"}
              </Link>
            </Button>
            {defaultRecipient ? (
              <Button asChild size="sm" variant="outline">
                <a href={`mailto:${defaultRecipient}`}>Open in your email app</a>
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="record-mail-provider">From</FieldLabel>
            <Select
              value={provider}
              onValueChange={(value) => setProviderOverride(value as MailProvider)}
            >
              <SelectTrigger id="record-mail-provider" aria-label="Sending mailbox">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sendConnections.map((connection) => (
                  <SelectItem key={connection.provider} value={connection.provider}>
                    {connectionLabel(connection)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {reconnectableConnections.length ? (
              <FieldDescription>
                {reconnectableConnections.map((connection) => providerLabel(connection.provider)).join(", ")}{" "}
                needs reconnecting and is not available to send.
              </FieldDescription>
            ) : null}
          </Field>

          <Field data-invalid={Boolean(recipientError)}>
            <FieldLabel htmlFor="record-mail-to">
              To <RequiredMark />
            </FieldLabel>
            <Input
              id="record-mail-to"
              data-quick-create-initial-focus
              type="text"
              inputMode="email"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                if (recipientError) setRecipientError(null);
              }}
              aria-invalid={Boolean(recipientError)}
              placeholder="name@example.com, another@example.com"
            />
            <FieldDescription>Separate multiple recipients with commas.</FieldDescription>
            <FieldError>{recipientError}</FieldError>
          </Field>

          {showCopyFields ? (
            <Field data-invalid={Boolean(copyError)}>
              <FieldLabel htmlFor="record-mail-cc">Cc</FieldLabel>
              <Input
                id="record-mail-cc"
                type="text"
                inputMode="email"
                value={cc}
                onChange={(event) => {
                  setCc(event.target.value);
                  if (copyError) setCopyError(null);
                }}
                aria-invalid={Boolean(copyError)}
                placeholder="name@example.com"
              />
              <FieldLabel htmlFor="record-mail-bcc" className="mt-3">
                Bcc
              </FieldLabel>
              <Input
                id="record-mail-bcc"
                type="text"
                inputMode="email"
                value={bcc}
                onChange={(event) => {
                  setBcc(event.target.value);
                  if (copyError) setCopyError(null);
                }}
                aria-invalid={Boolean(copyError)}
                placeholder="name@example.com"
              />
              <FieldError>{copyError}</FieldError>
            </Field>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit"
              onClick={() => setShowCopyFields(true)}
            >
              Add Cc and Bcc
            </Button>
          )}

          <Field>
            <FieldLabel htmlFor="record-mail-subject">Subject</FieldLabel>
            <Input
              id="record-mail-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={500}
              placeholder="Email subject"
            />
          </Field>

          {templates.length ? (
            <Field>
              <FieldLabel htmlFor="record-mail-template">Template</FieldLabel>
              <Select value={templateId ? String(templateId) : undefined} onValueChange={insertTemplate}>
                <SelectTrigger id="record-mail-template" aria-label="Insert a template">
                  <SelectValue placeholder="Insert a template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={String(template.id)}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Template text is added to your message. Variables resolve from this record when the
                email is sent.
              </FieldDescription>
            </Field>
          ) : null}

          <Field>
            <FieldLabel htmlFor="record-mail-body">Message</FieldLabel>
            <Textarea
              id="record-mail-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={10}
              placeholder="Write your message..."
              className="min-h-48 resize-y"
            />
          </Field>

          <Field>
            <FieldLabel>Attachments</FieldLabel>
            {documentsQuery.isLoading ? (
              <FieldDescription role="status">Loading this record&apos;s files…</FieldDescription>
            ) : documentsQuery.error ? (
              <FieldDescription role="alert">
                This record&apos;s files could not be loaded. You can still send without attachments.
              </FieldDescription>
            ) : documents.length ? (
              <div className="grid gap-2">
                {documents.map((document) => {
                  const checked = attachmentIds.includes(document.id);
                  const size = formatBytes(document.file_size_bytes);
                  return (
                    <label
                      key={document.id}
                      className="flex items-start gap-3 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-2"
                    >
                      <Checkbox
                        checked={checked}
                        disabled={!checked && attachmentIds.length >= MAX_ATTACHMENTS}
                        onCheckedChange={(value) => toggleAttachment(document.id, value === true)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-p-sm text-copy-primary">
                          {document.display_name || document.title}
                        </span>
                        <span className="block text-p-xs text-copy-muted">
                          {[document.original_filename, size].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </label>
                  );
                })}
                <FieldDescription>
                  Attach up to {MAX_ATTACHMENTS} files already linked to this record.
                </FieldDescription>
              </div>
            ) : (
              <FieldDescription>
                No files are linked to this record yet. Upload one from the Files tab to attach it.
              </FieldDescription>
            )}
          </Field>
        </FieldGroup>
      )}
    </QuickCreateSurface>
  );
}
