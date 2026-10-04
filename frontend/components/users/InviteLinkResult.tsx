"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { InviteEmailResult } from "@/hooks/admin/useUserManagement";

/**
 * After an invite: whether the email went out, and the setup link either way, so the admin
 * can still hand it over when no sender is set up (13 F0.7 B4).
 */
export function InviteLinkResult({
  id,
  email,
  setupLink,
  inviteEmail,
}: {
  id: string;
  email: string;
  setupLink: string;
  inviteEmail: InviteEmailResult | null;
}) {
  async function copySetupLink() {
    try {
      await navigator.clipboard.writeText(setupLink);
      toast.success("Setup link copied.");
    } catch {
      toast.error("The setup link could not be copied. Copy it manually instead.");
    }
  }

  return (
    <div className="space-y-4">
      {inviteEmail?.sent ? (
        <div role="status" className="rounded-[var(--radius-control)] border border-state-success/40 bg-state-success-muted px-4 py-3 text-sm text-copy-primary">
          Invite emailed to {email}. The link below is the same one, if they need it another way.
        </div>
      ) : (
        <div role="alert" className="rounded-[var(--radius-control)] border border-state-warning/40 bg-state-warning-muted px-4 py-3 text-sm text-copy-primary">
          The invite email was not sent{inviteEmail?.error ? `: ${inviteEmail.error}` : "."} Share the setup link below through a trusted channel.
        </div>
      )}

      <Field>
        <FieldLabel htmlFor={id}>Setup link</FieldLabel>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id={id} value={setupLink} readOnly />
          <Button type="button" variant="outline" onClick={() => void copySetupLink()}>
            <Copy />
            Copy
          </Button>
        </div>
      </Field>
    </div>
  );
}
