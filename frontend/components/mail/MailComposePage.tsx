"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import { toast } from "sonner";

import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { Textarea } from "@/components/ui/textarea";
import { useMailActions, useMailContext } from "@/hooks/useMail";
import type { MailProvider } from "@/hooks/useMail";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

const VARIABLE_TOKENS = [
  "{{contact.first_name}}",
  "{{contact.last_name}}",
  "{{contact.full_name}}",
  "{{contact.email}}",
  "{{organization.name}}",
  "{{opportunity.name}}",
];

const EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

function providerLabel(provider: MailProvider) {
  if (provider === "google") return "Gmail";
  if (provider === "microsoft") return "Microsoft";
  return "IMAP/SMTP";
}

export default function MailComposePage() {
  const router = useRouter();
  const contextQuery = useMailContext();
  const { sendMail, isSendingMail } = useMailActions();
  const recipientRef = useRef<HTMLInputElement>(null);
  const [providerOverride, setProviderOverride] = useState<MailProvider | null>(null);
  const [recipientsText, setRecipientsText] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [sendComplete, setSendComplete] = useState(false);

  const sendConnections = useMemo(
    () => (contextQuery.data?.connections ?? []).filter((connection) => connection.can_send),
    [contextQuery.data?.connections],
  );
  const provider = providerOverride && sendConnections.some((connection) => connection.provider === providerOverride)
    ? providerOverride
    : sendConnections[0]?.provider;
  const isDirty = Boolean(recipientsText.trim() || subject.trim() || body.trim());
  useUnsavedChangesGuard(isDirty, sendComplete);

  if (contextQuery.isLoading) return <RouteLoadingState label="mail composer" />;
  if (contextQuery.error) {
    return (
      <RouteErrorState
        title="Unable to prepare mail"
        description="We could not load your available mail connections. Try again or return to Mail."
        reset={() => void contextQuery.refetch()}
        backHref="/dashboard/mail"
        backLabel="Back to Mail"
      />
    );
  }

  async function handleSend() {
    const recipients = recipientsText.split(",").map((value) => value.trim()).filter(Boolean);
    const invalidRecipient = recipients.find((value) => !EMAIL_PATTERN.test(value));
    if (!recipients.length) {
      setRecipientError("Add at least one recipient.");
      recipientRef.current?.focus();
      return;
    }
    if (invalidRecipient) {
      setRecipientError(`Enter a valid email address for ${invalidRecipient}.`);
      recipientRef.current?.focus();
      return;
    }
    if (!provider) {
      toast.error("Connect a mailbox that can send email before composing.");
      return;
    }

    try {
      const message = await sendMail({
        provider,
        to: recipients,
        subject: subject.trim(),
        body_text: body,
      });
      setSendComplete(true);
      toast.success("Mail sent.");
      router.push(`/dashboard/mail?messageId=${message.id}`);
    } catch {
      toast.error("We could not send this email. Check the mailbox connection and try again.");
    }
  }

  if (!sendConnections.length) {
    return (
      <div className="grid gap-6">
        <PageHeader
          title="Compose email"
          description="Write and send an email through a connected mailbox."
          actions={<Button variant="outline" asChild><Link href="/dashboard/mail"><ArrowLeft />Back to Mail</Link></Button>}
        />
        <Card className="p-6">
          <h2 className="text-base font-semibold text-copy-primary">No sending mailbox available</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-copy-secondary">
            Connect or repair a Gmail, Microsoft, or IMAP/SMTP mailbox before composing an email.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild><Link href="/dashboard/mail">Review mail connections</Link></Button>
            <Button variant="outline" asChild><Link href="/dashboard/settings/integrations">Manage integrations</Link></Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Compose email"
        description="Send an email through a connected mailbox and use CRM variables where record context is available."
        actions={<Button variant="outline" asChild><Link href="/dashboard/mail"><ArrowLeft />Back to Mail</Link></Button>}
      />

      <RecordFormLayout
        sidebar={
          <>
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-copy-primary">Sending mailbox</h2>
              <Field className="mt-4">
                <FieldLabel htmlFor="mail-provider">Provider</FieldLabel>
                <select
                  id="mail-provider"
                  value={provider}
                  onChange={(event) => setProviderOverride(event.target.value as MailProvider)}
                  className="h-[38px] rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 text-sm text-copy-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                >
                  {sendConnections.map((connection) => (
                    <option key={connection.provider} value={connection.provider}>
                      {providerLabel(connection.provider)}{connection.account_email ? ` — ${connection.account_email}` : ""}
                    </option>
                  ))}
                </select>
                <FieldDescription>The selected provider sends the message using your connected account.</FieldDescription>
              </Field>
            </Card>
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-copy-primary">CRM variables</h2>
              <p className="mt-2 text-sm leading-6 text-copy-secondary">
                Variables resolve from linked record context or a matching contact recipient when the message is sent.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {VARIABLE_TOKENS.map((token) => (
                  <button
                    key={token}
                    type="button"
                    onClick={() => setBody((current) => `${current}${current ? " " : ""}${token}`)}
                    className="rounded-full border border-line-default bg-surface-muted px-3 py-1 text-xs text-copy-secondary transition-colors hover:border-line-strong hover:text-copy-primary"
                  >
                    {token}
                  </button>
                ))}
              </div>
            </Card>
          </>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-copy-muted">{isDirty ? "Unsaved message" : "Start writing your message"}</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" asChild><Link href="/dashboard/mail">Cancel</Link></Button>
              <Button type="button" onClick={() => void handleSend()} disabled={isSendingMail}>
                <Send />
                {isSendingMail ? "Sending..." : "Send email"}
              </Button>
            </div>
          </div>
        }
      >
        <FormSection title="Message" description="Separate multiple recipients with commas.">
          <FieldGroup>
            <Field data-invalid={Boolean(recipientError)}>
              <FieldLabel htmlFor="mail-recipients">To <RequiredMark /></FieldLabel>
              <Input
                ref={recipientRef}
                id="mail-recipients"
                type="text"
                inputMode="email"
                autoComplete="email"
                value={recipientsText}
                onChange={(event) => {
                  setRecipientsText(event.target.value);
                  if (recipientError) setRecipientError(null);
                }}
                aria-invalid={Boolean(recipientError)}
                placeholder="name@example.com, another@example.com"
              />
              <FieldError>{recipientError}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="mail-subject">Subject</FieldLabel>
              <Input
                id="mail-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={500}
                placeholder="Email subject"
              />
              <FieldDescription>{subject.length}/500 characters</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="mail-body">Message</FieldLabel>
              <Textarea
                id="mail-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={14}
                placeholder="Write your message..."
                className="min-h-72 resize-y"
              />
            </Field>
          </FieldGroup>
        </FormSection>
      </RecordFormLayout>
    </div>
  );
}
