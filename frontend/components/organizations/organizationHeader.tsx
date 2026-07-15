"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";

export default function OrganizationsHeader({ eyebrow }: { eyebrow?: React.ReactNode }) {
  return <PageHeader title="Accounts" description="Manage customer and partner companies, ownership, and commercial context." eyebrow={eyebrow} actions={<Button asChild><Link href="/dashboard/sales/organizations/new" aria-label="Create account"><Plus /><span className="hidden sm:inline">Create account</span></Link></Button>} />;
}
