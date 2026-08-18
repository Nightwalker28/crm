"use client";

import { useRef, useState } from "react";
import { Mail } from "lucide-react";

import RecordEmailComposer from "@/components/mail/RecordEmailComposer";
import { Button } from "@/components/ui/button";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useMailContext } from "@/hooks/useMail";
import type { RecordModuleKey } from "@/types/record-activity";

/**
 * The record-level Email action.
 *
 * It chooses between the in-app composer and the `mailto:` fallback so calling
 * pages never have to reason about mailboxes. Tenants with no connected
 * provider keep exactly the behavior they have today; connecting a mailbox is
 * what turns the same button into a contextual send.
 *
 * Hiding the composer is a convenience, not authorization — the send endpoint
 * enforces mail permission, record permission, and tenant scope on its own.
 */

export type RecordEmailContext = {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  recordLabel: string;
};

type Props = RecordEmailContext & {
  email?: string | null;
  emailOptOut?: boolean;
};

export default function RecordEmailAction({
  moduleKey,
  entityId,
  recordLabel,
  email,
  emailOptOut = false,
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Remounts the composer per compose session, so each draft starts empty and
  // with its own idempotency key instead of inheriting the previous attempt's.
  const [composeSession, setComposeSession] = useState(0);
  const contextQuery = useMailContext();
  const { modules } = useAccessibleModules();

  const canSendMail = Boolean(modules.find((module) => module.name === "mail")?.actions?.can_edit);
  const hasSendingMailbox = (contextQuery.data?.connections ?? []).some(
    (connection) => connection.can_send,
  );
  const canCompose = canSendMail && hasSendingMailbox;

  if (!email || emailOptOut) {
    return (
      <Button type="button" size="sm" variant="outline" disabled>
        <Mail className="h-4 w-4" />
        {emailOptOut ? "Email Opt Out" : "Email"}
      </Button>
    );
  }

  if (!canCompose) {
    return (
      <Button asChild size="sm" variant="outline">
        <a href={`mailto:${email}`}>
          <Mail className="h-4 w-4" />
          Email
        </a>
      </Button>
    );
  }

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          setComposeSession((session) => session + 1);
          setOpen(true);
        }}
      >
        <Mail className="h-4 w-4" />
        Email
      </Button>
      <RecordEmailComposer
        key={composeSession}
        open={open}
        onOpenChange={setOpen}
        moduleKey={moduleKey}
        entityId={entityId}
        recordLabel={recordLabel}
        defaultRecipient={email}
        returnFocusRef={triggerRef}
      />
    </>
  );
}
