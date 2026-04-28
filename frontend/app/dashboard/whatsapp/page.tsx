"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";


export default function WhatsAppPage() {
  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="WhatsApp"
        description="Use contact profiles to start manual WhatsApp conversations, log activity, and create follow-up tasks."
      />

      <Card className="px-5 py-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-emerald-900/60 bg-emerald-950/40 text-emerald-300">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-neutral-100">Click-to-chat MVP</h2>
            <p className="mt-1 text-sm text-neutral-400">
              WhatsApp sending is manual in this phase. Open a contact profile, choose a template, and start a WhatsApp chat from the contact summary panel.
            </p>
            <div className="mt-4">
              <Button asChild>
                <Link href="/dashboard/sales/contacts">Open Contacts</Link>
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
