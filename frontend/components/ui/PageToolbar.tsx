import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageToolbar({ children, context, className }: { children?: ReactNode; context?: ReactNode; className?: string }) {
  if (!children && !context) return null;

  return (
    <div className={cn("flex min-h-9 flex-wrap items-center justify-between gap-2", className)}>
      <div className="min-w-0 text-xs font-medium text-copy-muted">{context}</div>
      {children ? <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</div> : null}
    </div>
  );
}
