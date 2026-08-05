"use client";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
  className?: string;
  sticky?: boolean;
  variant?: "default" | "module";
};

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
  sticky = false,
}: PageHeaderProps) {
  const accessibleDescription = typeof description === "string" ? description : undefined;
  return (
    <div
      className={cn(
        "flex min-w-0 justify-end",
        sticky && "sticky top-0 z-20 bg-app/95 py-2 backdrop-blur-sm",
        className,
      )}
      aria-label={`${title} actions`}
    >
      <h1 className="sr-only">{title}</h1>
      {eyebrow ? <div className="sr-only">{eyebrow}</div> : null}
      {accessibleDescription ? <p className="sr-only">{accessibleDescription}</p> : null}
      {actions ? <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:shrink-0">{actions}</div> : null}
    </div>
  );
}
