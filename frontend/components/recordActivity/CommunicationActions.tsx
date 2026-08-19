"use client";

import { Mail, MessageCircle, Phone } from "lucide-react";
import { toast } from "sonner";

import RecordEmailAction, { type RecordEmailContext } from "@/components/mail/RecordEmailAction";
import { Button } from "@/components/ui/button";

/**
 * The record header's channel row: the actions that *perform* a conversation.
 *
 * Its counterpart is the `Timeline` composer, which *records* one. They look similar and
 * they are not the same thing — one opens WhatsApp, one writes the row saying you did
 * (4.7).
 *
 * Two rules shape what is rendered here, and both are 4.7's:
 *
 * - **A channel appears only if this record owns the address.** Only lead, contact and
 *   account carry `primary_email` / phone columns, so only they mount this. A deal and a
 *   quote used to pass the linked *contact's* address into their own header and file the
 *   result against themselves, which split one conversation across two records.
 * - **A channel with no address is not drawn**, rather than drawn disabled. A contact with
 *   no phone is the common case, and the header's most frequent state was two inert
 *   buttons beside one live one.
 */

type Props = {
  email?: string | null;
  phone?: string | null;
  emailOptOut?: boolean;
  /**
   * Pass the record this action belongs to and the Email button becomes a
   * contextual composer whose message is filed against that record. Without it
   * the button keeps its `mailto:` behavior, which stays the correct fallback
   * for tenants with no connected mailbox.
   */
  emailContext?: RecordEmailContext;
  /**
   * Records with a *tracked* click-to-chat endpoint pass `false` and offer WhatsApp as the
   * composer's mode instead — offering both means the same action logs itself half the
   * time and the operator cannot tell which button did which (4.7). Contacts are the only
   * such record today.
   */
  showWhatsApp?: boolean;
};

function phoneDigits(phone: string) {
  return phone.replace(/\D/g, "");
}

export default function CommunicationActions({
  email,
  phone,
  emailOptOut = false,
  emailContext,
  showWhatsApp = true,
}: Props) {
  const canEmail = Boolean(email) && !emailOptOut;
  const canCall = Boolean(phone);
  const canWhatsApp = showWhatsApp && Boolean(phone);

  function handleWhatsAppClick() {
    if (!phone) return;
    const digits = phoneDigits(phone);
    if (!digits) {
      toast.error("Add a valid phone number before opening WhatsApp.");
      return;
    }
    window.open(`https://wa.me/${digits}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEmail && emailContext ? (
        <RecordEmailAction {...emailContext} email={email} emailOptOut={emailOptOut} />
      ) : canEmail ? (
        <Button asChild size="sm" variant="outline">
          <a href={`mailto:${email}`}>
            <Mail />
            Email
          </a>
        </Button>
      ) : null}

      {canWhatsApp ? (
        <Button type="button" size="sm" variant="outline" onClick={handleWhatsAppClick}>
          <MessageCircle />
          WhatsApp
        </Button>
      ) : null}

      {canCall ? (
        <Button asChild size="sm" variant="outline">
          <a href={`tel:${phone}`}>
            <Phone />
            Call
          </a>
        </Button>
      ) : null}
    </div>
  );
}
