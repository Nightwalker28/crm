import Link from "next/link";
import { ShieldX } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { RouteStateTitleProps } from "@/components/ui/RouteStates";

/**
 * The §7.4 permission-denied state, as a whole route.
 *
 * `titleAs` is here for the same reason it is on the other route states: standing alone
 * this replaces the page and owns its `h1`, but inside a `PageShell` the shell has already
 * emitted one and §8 allows exactly one per page.
 */
export function PermissionDeniedState({
  title = "You do not have permission to view this page",
  description = "Ask an administrator for the required module or action access.",
  backHref = "/dashboard",
  backLabel = "Return to dashboard",
  titleAs: Title = "h1",
}: {
  title?: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
} & RouteStateTitleProps) {
  return (
    <div role="alert" className="mx-auto flex min-h-[360px] max-w-xl flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-state-danger/40 bg-state-danger-muted text-state-danger">
        <ShieldX aria-hidden="true" />
      </div>
      <Title className="mt-4 text-xl font-semibold text-copy-primary">{title}</Title>
      <p className="mt-2 max-w-md text-p-sm text-copy-secondary">{description}</p>
      <Button asChild className="mt-6" variant="outline"><Link href={backHref}>{backLabel}</Link></Button>
    </div>
  );
}
