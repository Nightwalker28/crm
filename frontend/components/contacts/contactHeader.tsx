"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";

export default function ContactsHeader({ eyebrow }: { eyebrow?: React.ReactNode }) {
  return (
    <PageHeader
      title="Contacts"
      description="Manage people, their accounts, ownership, and communication history."
      eyebrow={eyebrow}
      actions={(
        <Button asChild>
          <Link href="/dashboard/sales/contacts/new" aria-label="Create contact"><Plus /><span className="hidden sm:inline">Create contact</span></Link>
        </Button>
      )}
    />
  );
}
