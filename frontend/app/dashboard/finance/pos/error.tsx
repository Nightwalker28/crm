"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function InvoicesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted p-6"><h1 className="text-lg font-semibold text-copy-primary">Unable to load invoices</h1><p className="mt-2 text-sm text-copy-secondary">The page could not be loaded. You can try again or return to the dashboard.</p><div className="mt-4 flex flex-wrap gap-2"><Button type="button" onClick={reset}>Try again</Button><Button asChild variant="outline"><Link href="/dashboard">Return to dashboard</Link></Button></div></div>;
}
