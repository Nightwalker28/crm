"use client";

import { Copy, Mail, MessageCircle, Phone, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type Props = {
  email?: string | null;
  phone?: string | null;
  emailOptOut?: boolean;
  showWhatsApp?: boolean;
  whatsAppDisabled?: boolean;
  whatsAppBusy?: boolean;
  onWhatsAppClick?: () => Promise<void> | void;
  followUpTargetId?: string;
};

function phoneDigits(phone: string) {
  return phone.replace(/\D/g, "");
}

async function copyValue(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied.`);
  } catch {
    toast.error(`Failed to copy ${label.toLowerCase()}.`);
  }
}

function scrollToFollowUp(targetId?: string) {
  if (!targetId) return;
  document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function CommunicationActions({
  email,
  phone,
  emailOptOut = false,
  showWhatsApp = true,
  whatsAppDisabled = false,
  whatsAppBusy = false,
  onWhatsAppClick,
  followUpTargetId,
}: Props) {
  const canEmail = Boolean(email) && !emailOptOut;
  const canCall = Boolean(phone);
  const canWhatsApp = showWhatsApp && Boolean(phone) && !whatsAppDisabled;

  function handleWhatsAppClick() {
    if (!phone || !canWhatsApp) return;
    if (onWhatsAppClick) {
      void onWhatsAppClick();
      return;
    }
    const digits = phoneDigits(phone);
    if (!digits) {
      toast.error("Add a valid phone number before opening WhatsApp.");
      return;
    }
    window.open(`https://wa.me/${digits}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEmail ? (
        <Button asChild size="sm" variant="outline">
          <a href={`mailto:${email}`}>
            <Mail className="h-4 w-4" />
            Email
          </a>
        </Button>
      ) : (
        <Button type="button" size="sm" variant="outline" disabled>
          <Mail className="h-4 w-4" />
          {emailOptOut ? "Email Opt Out" : "Email"}
        </Button>
      )}

      {showWhatsApp ? (
        <Button type="button" size="sm" variant="outline" onClick={handleWhatsAppClick} disabled={!canWhatsApp || whatsAppBusy}>
          <MessageCircle className="h-4 w-4" />
          {whatsAppBusy ? "Opening..." : "WhatsApp"}
        </Button>
      ) : null}

      {canCall ? (
        <Button asChild size="sm" variant="outline">
          <a href={`tel:${phone}`}>
            <Phone className="h-4 w-4" />
            Call
          </a>
        </Button>
      ) : (
        <Button type="button" size="sm" variant="outline" disabled>
          <Phone className="h-4 w-4" />
          Call
        </Button>
      )}

      <Button type="button" size="sm" variant="ghost" onClick={() => email && void copyValue(email, "Email")} disabled={!email}>
        <Copy className="h-4 w-4" />
        Copy Email
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => phone && void copyValue(phone, "Phone")} disabled={!phone}>
        <Copy className="h-4 w-4" />
        Copy Phone
      </Button>
      {followUpTargetId ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => scrollToFollowUp(followUpTargetId)}>
          <RotateCcw className="h-4 w-4" />
          Log Follow-up
        </Button>
      ) : null}
    </div>
  );
}
