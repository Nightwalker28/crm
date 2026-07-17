"use client";

import Link from "next/link";
import { FileQuestion, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function RouteLoadingState({ label = "page" }: { label?: string }) {
  return <div className="space-y-6" aria-label={`Loading ${label}`} aria-busy="true"><div><Skeleton className="h-7 w-40" /><Skeleton className="mt-3 h-4 w-full max-w-xl" /></div><Skeleton className="h-16 w-full rounded-[var(--radius-card)]" /><Skeleton className="h-[420px] w-full rounded-[var(--radius-card)]" /></div>;
}

export function RouteErrorState({ title, description = "The page could not be loaded. You can try again or return to the previous page.", reset, backHref = "/dashboard", backLabel = "Return to dashboard" }: { title: string; description?: string; reset: () => void; backHref?: string; backLabel?: string }) {
  return <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted p-6"><h1 className="text-lg font-semibold text-copy-primary">{title}</h1><p className="mt-2 text-sm leading-6 text-copy-secondary">{description}</p><div className="mt-4 flex flex-wrap gap-2"><Button type="button" onClick={reset}><RotateCcw />Try again</Button><Button asChild variant="outline"><Link href={backHref}>{backLabel}</Link></Button></div></div>;
}

export function RouteNotFoundState({ recordLabel = "Record", backHref = "/dashboard", backLabel = "Return to dashboard" }: { recordLabel?: string; backHref?: string; backLabel?: string }) {
  return <div className="mx-auto flex min-h-[360px] max-w-xl flex-col items-center justify-center px-6 py-12 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-full border border-line-default bg-surface-muted text-copy-muted"><FileQuestion aria-hidden="true" /></div><h1 className="mt-4 text-xl font-semibold text-copy-primary">{recordLabel} not found</h1><p className="mt-2 text-sm leading-6 text-copy-secondary">It may have been deleted or you may not have access.</p><Button asChild className="mt-6" variant="outline"><Link href={backHref}>{backLabel}</Link></Button></div>;
}
