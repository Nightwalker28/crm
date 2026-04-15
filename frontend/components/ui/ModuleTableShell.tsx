"use client";

import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

export function ModuleTableShell({ children, className = "" }: Props) {
  return (
    <div
      className={`rounded-md border border-neutral-800 overflow-auto relative min-h-[69vh] max-h-[69vh] bg-neutral-950/80 ${className}`.trim()}
    >
      {children}
    </div>
  );
}
