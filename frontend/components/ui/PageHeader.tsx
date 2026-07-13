"use client";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
  className?: string;
  sticky?: boolean;
};

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
  sticky = false,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "-mx-4 border-b border-line-subtle bg-surface/95 px-4 py-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8",
        sticky && "sticky top-0 z-20 backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex min-h-14 flex-col items-start justify-between gap-4 sm:flex-row">
        <div className="min-w-0">
          {eyebrow ? <div className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-copy-muted">{eyebrow}</div> : null}
          <h1 className="text-[22px] font-semibold leading-[30px] text-copy-primary">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm leading-[21px] text-copy-secondary">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">{actions}</div> : null}
      </div>
    </div>
  );
}
