"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

type LeadsHeaderProps = {
  eyebrow?: ReactNode;
};

export default function LeadsHeader({ eyebrow }: LeadsHeaderProps) {
  return (
    <PageHeader
      title="Leads"
      description="Capture and qualify early sales leads before they become contacts or deals."
      eyebrow={eyebrow}
      actions={
        <Button asChild>
          <Link href="/dashboard/sales/leads/new" aria-label="Create lead">
            <Plus />
            <span className="hidden sm:inline">Create lead</span>
          </Link>
        </Button>
      }
    />
  );
}
