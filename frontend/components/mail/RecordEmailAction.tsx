"use client";

import { useRef, useState } from "react";
import { Mail } from "lucide-react";

import RecordEmailComposer, {
  isUsableCandidate,
  type RecipientCandidate,
} from "@/components/mail/RecordEmailComposer";
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
  /**
   * A deal's participants. Given instead of `email`: the action appears when at least one can
   * be emailed, one such participant is prefilled, and several leave To empty so the choice is
   * the user's — the primary contact is never picked silently.
   */
  recipientCandidates?: RecipientCandidate[];
};

export default function RecordEmailAction({
  moduleKey,
  entityId,
  recordLabel,
  email,
  emailOptOut = false,
  recipientCandidates,
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

  // Nothing, rather than a disabled button (4.7). `email_opt_out` is a field and `Details`
  // draws it as `Opted out`, which is a better place to learn a compliance fact than a
  // control that cannot be pressed. `CommunicationActions` gates this too; the guard is
  // repeated because this component has its own call path.
  const usableCandidates = (recipientCandidates ?? []).filter(isUsableCandidate);
  const prefill = recipientCandidates
    ? usableCandidates.length === 1
      ? usableCandidates[0].email
      : null
    : email;
  if (recipientCandidates ? usableCandidates.length === 0 : !email || emailOptOut) return null;

  if (!canCompose) {
    return (
      <Button asChild size="sm" variant="outline">
        <a href={`mailto:${prefill ?? ""}`}>
          <Mail />
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
        <Mail />
        Email
      </Button>
      <RecordEmailComposer
        key={composeSession}
        open={open}
        onOpenChange={setOpen}
        moduleKey={moduleKey}
        entityId={entityId}
        recordLabel={recordLabel}
        defaultRecipient={prefill}
        recipientCandidates={recipientCandidates}
        returnFocusRef={triggerRef}
      />
    </>
  );
}
