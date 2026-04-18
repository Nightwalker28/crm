"use client";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 -mx-6 border-b border-neutral-800/80 bg-[#0a0a0a]/90 px-6 py-4 backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex min-h-14 items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight text-neutral-100">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-neutral-400">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>
    </div>
  );
}
