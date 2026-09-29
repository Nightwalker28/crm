"use client";

import { Mail, MessageCircle, Phone } from "lucide-react";
import { toast } from "sonner";

import RecordEmailAction, { type RecordEmailContext } from "@/components/mail/RecordEmailAction";
import { Button } from "@/components/ui/button";
import { useWhatsAppCapabilities } from "@/hooks/useWhatsAppCapabilities";
import { WHATSAPP_NUMBER_MESSAGES, whatsAppChatTarget, whatsAppChatUrl } from "@/lib/whatsapp";

/**
 * The record header's channel row: the actions that *perform* a conversation.
 *
 * Its counterpart is the `Timeline` composer, which *records* one. They look similar and
 * they are not the same thing — one opens WhatsApp, one writes the row saying you did
 * (4.7).
 *
 * Two rules shape what is rendered here, and both are 4.7's:
 *
 * - **The message is filed against every record whose address it uses.** Lead, contact
 *   and account own their `primary_email` / phone, so they mount this with their own
 *   address. A deal has no address of its own: it offers `RecordEmailAction` with its
 *   participants as candidates instead, and the send files each chosen participant beside
 *   the deal. What must not come back is a record using someone else's address and filing
 *   the conversation against itself alone.
 * - **A channel with no address is not drawn**, rather than drawn disabled. A contact with
 *   no phone is the common case, and the header's most frequent state was two inert
 *   buttons beside one live one.
 *
 * WhatsApp here is external click-to-chat (`lib/whatsapp.ts`): it opens the chat and
 * records nothing, and it is offered only while the workspace allows that mode.
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

export default function CommunicationActions({
  email,
  phone,
  emailOptOut = false,
  emailContext,
  showWhatsApp = true,
}: Props) {
  const { canOpenExternally } = useWhatsAppCapabilities();
  const canEmail = Boolean(email) && !emailOptOut;
  const canCall = Boolean(phone);
  const canWhatsApp = showWhatsApp && canOpenExternally && Boolean(phone);

  function handleWhatsAppClick() {
    const target = whatsAppChatTarget(phone);
    if (!target.ok) {
      toast.error(WHATSAPP_NUMBER_MESSAGES[target.reason]);
      return;
    }
    window.open(whatsAppChatUrl(target.digits), "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEmail && emailContext ? (
        <RecordEmailAction {...emailContext} email={email} emailOptOut={emailOptOut} />
      ) : canEmail ? (
        <Button asChild variant="outline">
          <a href={`mailto:${email}`}>
            <Mail />
            Email
          </a>
        </Button>
      ) : null}

      {canWhatsApp ? (
        <Button type="button" variant="outline" onClick={handleWhatsAppClick}>
          <MessageCircle />
          WhatsApp
        </Button>
      ) : null}

      {canCall ? (
        <Button asChild variant="outline">
          <a href={`tel:${phone}`}>
            <Phone />
            Call
          </a>
        </Button>
      ) : null}
    </div>
  );
}
