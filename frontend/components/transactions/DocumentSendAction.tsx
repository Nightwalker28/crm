"use client";

import { useRef, useState } from "react";
import { Send } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import RecordEmailComposer, { type RecipientCandidate } from "@/components/mail/RecordEmailComposer";
import { Button } from "@/components/ui/button";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useMailContext } from "@/hooks/useMail";
import { ApiError, apiFetch } from "@/lib/api";
import type { PrintableModuleKey } from "@/lib/documentPdf";
import type { RecordModuleKey } from "@/types/record-activity";

type SendContext = {
  label: string;
  account_email: string | null;
  recipients: Array<{ contact_id: number; name: string; email: string; role: string | null; is_primary: boolean; opted_out: boolean }>;
  email_template_id: number | null;
  subject: string;
  pdf_filename: string;
  can_send: boolean;
  draft_reason: string | null;
};

async function fetchSendContext(moduleKey: PrintableModuleKey, recordId: number): Promise<SendContext> {
  const res = await apiFetch(`/records/${moduleKey}/${recordId}/send-context`);
  if (!res.ok) throw new ApiError(res.status, "The send details could not be loaded.");
  return res.json();
}

/**
 * *Send* on a commercial document (13d §3.4): the record composer, from the user's own mailbox,
 * with the document's people as recipients, its type's template, and its PDF attached. Without a
 * connected mailbox there is nothing to send from, so the button says so; *Download PDF* stays.
 */
export function DocumentSendAction({ moduleKey, recordId, label = "Send" }: { moduleKey: PrintableModuleKey; recordId: number; label?: string }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const mail = useMailContext();
  const { modules } = useAccessibleModules();
  const context = useQuery({ queryKey: ["document-send-context", moduleKey, recordId], queryFn: () => fetchSendContext(moduleKey, recordId), staleTime: 30_000 });
  const canSendMail = Boolean(modules.find((module) => module.name === "mail")?.actions?.can_edit);
  const hasMailbox = (mail.data?.connections ?? []).some((connection) => connection.can_send);
  if (!canSendMail || !context.data) return null;
  const blocked = !hasMailbox ? "Connect your mailbox under Mail to send from Lynk." : context.data.can_send ? null : context.data.draft_reason;
  const candidates: RecipientCandidate[] = context.data.recipients.map((person) => ({
    contactId: person.contact_id,
    name: person.name,
    email: person.email,
    roleLabel: person.role,
    isPrimary: person.is_primary,
    optedOut: person.opted_out,
  }));
  const usable = candidates.filter((candidate) => candidate.email && !candidate.optedOut);
  const prefill = usable.find((candidate) => candidate.isPrimary)?.email ?? usable[0]?.email ?? context.data.account_email;
  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        disabled={Boolean(blocked)}
        title={blocked ?? undefined}
        onClick={() => {
          setSession((value) => value + 1);
          setOpen(true);
        }}
      >
        <Send />
        {label}
      </Button>
      {open ? (
        <RecordEmailComposer
          key={session}
          open={open}
          onOpenChange={setOpen}
          moduleKey={moduleKey as RecordModuleKey}
          entityId={recordId}
          recordLabel={context.data.label}
          defaultRecipient={prefill}
          recipientCandidates={candidates.length ? candidates : undefined}
          returnFocusRef={triggerRef}
          defaultSubject={context.data.subject}
          defaultTemplateId={context.data.email_template_id}
          documentPdf={{ filename: context.data.pdf_filename }}
        />
      ) : null}
    </>
  );
}
