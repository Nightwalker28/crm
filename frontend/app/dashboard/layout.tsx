"use client";

import type { ReactNode } from "react";
import Sidebar from "@/components/sidebar/Sidebar";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-neutral-900 text-neutral-200 font-sans">

      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 mix-blend-soft-light opacity-[0.3] bg-[linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] bg-size-[3px_3px]" />
      </div>

      <Sidebar />

      <main className="relative z-10 flex min-w-0 flex-1 p-4">
        <div
          className="relative z-20 flex h-full w-full flex-col overflow-hidden rounded-md
          border border-neutral-800 bg-[#0a0a0a]"
          style={{
            boxShadow:
              "0 0 40px -15px color-mix(in srgb, var(--acumen), transparent 95%)",
          }}
        >
          <div className="relative z-30 h-full w-full overflow-y-auto p-8 custom-scrollbar">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}