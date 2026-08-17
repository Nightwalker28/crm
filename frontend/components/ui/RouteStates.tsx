"use client";

import Link from "next/link";
import { FileQuestion, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Whole-route states. Each one replaces the page, so by default its title *is* the page's
 * `h1`.
 *
 * Inside a `PageShell` the shell has already emitted the `h1` (design.md §8 — exactly one
 * per page), so the shell passes `titleAs="p"` and the state keeps the same visual weight
 * without adding a second heading. That is the only reason this prop exists; do not reach
 * for it to demote a heading for looks.
 */
type RouteStateTitleProps = { titleAs?: "h1" | "p" };

/** The props Next.js passes to every `error.tsx` boundary. One definition, not one per file. */
export type RouteErrorBoundaryProps = { error: Error & { digest?: string }; reset: () => void };

export function RouteLoadingState({ label = "page" }: { label?: string }) {
  return <div className="space-y-6" aria-label={`Loading ${label}`} aria-busy="true"><div><Skeleton className="h-7 w-40" /><Skeleton className="mt-3 h-4 w-full max-w-xl" /></div><Skeleton className="h-16 w-full rounded-[var(--radius-card)]" /><Skeleton className="h-[420px] w-full rounded-[var(--radius-card)]" /></div>;
}

export function RouteErrorState({ title, description = "The page could not be loaded. You can try again or return to the previous page.", reset, backHref = "/dashboard", backLabel = "Return to dashboard", titleAs: Title = "h1" }: { title: string; description?: string; reset: () => void; backHref?: string; backLabel?: string } & RouteStateTitleProps) {
  return <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted p-6"><Title className="text-lg font-semibold text-copy-primary">{title}</Title><p className="mt-2 text-p-sm text-copy-secondary">{description}</p><div className="mt-4 flex flex-wrap gap-2"><Button type="button" onClick={reset}><RotateCcw />Try again</Button><Button asChild variant="outline"><Link href={backHref}>{backLabel}</Link></Button></div></div>;
}

export function RouteNotFoundState({ recordLabel = "Record", backHref = "/dashboard", backLabel = "Return to dashboard", titleAs: Title = "h1" }: { recordLabel?: string; backHref?: string; backLabel?: string } & RouteStateTitleProps) {
  return <div className="mx-auto flex min-h-[360px] max-w-xl flex-col items-center justify-center px-6 py-12 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-full border border-line-default bg-surface-muted text-copy-muted"><FileQuestion aria-hidden="true" /></div><Title className="mt-4 text-xl font-semibold text-copy-primary">{recordLabel} not found</Title><p className="mt-2 text-p-sm text-copy-secondary">It may have been deleted or you may not have access.</p><Button asChild className="mt-6" variant="outline"><Link href={backHref}>{backLabel}</Link></Button></div>;
}

export type { RouteStateTitleProps };
