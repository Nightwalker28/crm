"use client";

import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  isRefreshing?: boolean;
};

export function ModuleTableShell({ children, className = "", isRefreshing = false }: Props) {
  return (
    <div
      className={`scrollbar-hide relative max-h-[70vh] min-h-80 overflow-auto overscroll-contain rounded-[var(--radius-card)] border border-line-default bg-surface md:min-h-[34rem] after:pointer-events-none after:sticky after:right-0 after:top-0 after:block after:h-full after:w-8 after:float-right after:bg-gradient-to-l after:from-surface after:to-transparent md:after:hidden ${className}`.trim()}
      role="region"
      aria-label="Data table"
      aria-busy={isRefreshing}
    >
      {isRefreshing ? (
        <div className="pointer-events-none absolute right-3 top-3 z-40 inline-flex items-center gap-2 rounded-full border border-line-default bg-surface-raised/90 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-copy-muted backdrop-blur-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-copy-muted" />
          Refreshing
        </div>
      ) : null}
      {children}
    </div>
  );
}
