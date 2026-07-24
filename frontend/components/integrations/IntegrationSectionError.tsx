import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export function IntegrationSectionError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
      <span>{message}</span>
      <Button type="button" variant="outline" size="sm" onClick={retry}>
        <RefreshCw aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
