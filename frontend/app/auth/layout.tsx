"use client";

import { HexagonBackground } from "@/components/ui/HexagonBackground";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-black text-white overflow-hidden">
      {/* hexagon background */}
      <HexagonBackground
        hexagonMargin={5}
        hexagonSize={70}
        className="absolute inset-0 z-0 text-slate-600/40"
      />

      {/* noise-like grid shimmer */}
      <div className="pointer-events-none absolute inset-0 z-1 mix-blend-soft-light opacity-[0.5] bg-[linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] bg-size-[2.5px_2.5px]" />
      
      {/* vignette */}
      <div className="pointer-events-none absolute inset-0 z-2 bg-[radial-gradient(circle_at_center,transparent_55%,rgba(0,0,0,0.40))]" />

      {/* card */}
      <div className="relative z-20 w-full max-w-sm overflow-hidden rounded-md border border-white/10 bg-white/5 px-8 py-8 backdrop-blur-xl shadow-[0_30px_120px_rgba(0,0,0,0.7)]">
        {/* inner card gradients */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.15),transparent_60%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.07),transparent_60%)] opacity-80" />

        {/* card noise */}
        <div
          className="absolute inset-0 pointer-events-none mix-blend-multiply bg-repeat bg-size-[150px_150px] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5 rounded-md"
        ></div>

        {/* actual page content */}
        <div className="relative z-10 text-center">{children}</div>
      </div>
    </main>
  );
}
