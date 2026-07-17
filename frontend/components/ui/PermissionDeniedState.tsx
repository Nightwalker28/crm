import Link from "next/link";
import { ShieldX } from "lucide-react";

import { Button } from "@/components/ui/button";

export function PermissionDeniedState() {
  return (
    <div role="alert" className="mx-auto flex min-h-[360px] max-w-xl flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-state-danger/40 bg-state-danger-muted text-state-danger">
        <ShieldX aria-hidden="true" />
      </div>
      <h1 className="mt-4 text-xl font-semibold text-copy-primary">You do not have permission to view this page</h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-copy-secondary">Ask an administrator for the required module or action access.</p>
      <Button asChild className="mt-6" variant="outline"><Link href="/dashboard">Return to dashboard</Link></Button>
    </div>
  );
}
