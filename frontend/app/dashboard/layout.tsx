"use client";

import type { ReactNode } from "react";
import Sidebar from "@/components/sidebar/Sidebar";
import GlobalCommandPalette from "@/components/search/GlobalCommandPalette";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-neutral-950 text-neutral-200 font-sans">

      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 mix-blend-soft-light opacity-[0.3] bg-[linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] bg-size-[3px_3px]" />
      </div>

      <Sidebar />

      <main className="relative z-10 flex min-w-0 flex-1 overflow-hidden px-3 py-4 pr-4">
        <div className="relative z-20 flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border border-white/6 bg-[#0a0a0a] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
          <div className="border-b border-white/6 px-6 py-4">
            <GlobalCommandPalette />
          </div>
          <div className="relative z-30 h-full w-full overflow-y-auto px-6 py-5 custom-scrollbar">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
