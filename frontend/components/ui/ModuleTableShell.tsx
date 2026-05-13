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
      className={`scrollbar-hide relative min-h-[69vh] max-h-[69vh] overflow-auto rounded-md border border-neutral-800 bg-neutral-950/80 after:pointer-events-none after:sticky after:right-0 after:top-0 after:block after:h-full after:w-8 after:float-right after:bg-gradient-to-l after:from-neutral-950/90 after:to-transparent md:after:hidden ${className}`.trim()}
      aria-busy={isRefreshing}
    >
      {isRefreshing ? (
        <div className="pointer-events-none absolute right-3 top-3 z-20 inline-flex items-center gap-2 rounded-full border border-white/8 bg-black/70 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-neutral-400 backdrop-blur-sm">
          <span className="h-2 w-2 rounded-full bg-neutral-400 animate-pulse" />
          Refreshing
        </div>
      ) : null}
      {children}
    </div>
  );
}
