import type { ReactNode } from "react";

import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

export function RecordFormLayout({
  children,
  sidebar,
  footer,
}: {
  children: ReactNode;
  sidebar: ReactNode;
  footer: ReactNode;
}) {
  return (
    <>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,23.75rem)]">
        <div className="grid min-w-0 gap-6">{children}</div>
        <aside className="grid gap-6 lg:sticky lg:top-6">{sidebar}</aside>
      </div>
      <div className="sticky bottom-0 z-20 -mx-4 border-t border-line-default bg-app/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        {footer}
      </div>
    </>
  );
}

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("p-5 md:p-6", className)}>
      <div className="mb-5">
        <h2 className="text-base font-semibold text-copy-primary">{title}</h2>
        {description ? <p className="mt-1 text-sm text-copy-muted">{description}</p> : null}
      </div>
      {children}
    </Card>
  );
}
