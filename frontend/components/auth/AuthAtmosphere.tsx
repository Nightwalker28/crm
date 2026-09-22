"use client";

import type { ReactNode } from "react";

import { HexagonBackground } from "@/components/ui/HexagonBackground";

/**
 * The product's front door — the hive, the grid shimmer, the vignette and the glass card
 * that `design.md` §9 calls "the least generic screen Lynk has".
 *
 * **Shared, not copied** (rebuild 5.8, ruling 3). `/client/login` now takes this treatment
 * too, and `/client/setup` with it: a sign-in page is the product's door wherever it stands.
 * `/client/**` is not under `app/auth`, so a route layout could not reach it, and writing the
 * atmosphere a second time is exactly how the two doors would drift apart.
 *
 * **The values are tokens now, and that is the whole of the change to the visuals.**
 * `tokens.md` §3.5 named `--ambient-grid`, `--ambient-vignette` and `--ambient-card-glow`
 * and `globals.css` defined none of them, so this file carried raw `rgba()` in arbitrary
 * values — the pattern §10 forbids — for as long as the rule existed. 5.8 defined them, in
 * both themes, and light is not dark at a lower opacity: a white shimmer over a white ground
 * is invisible and a black vignette reads as dirt.
 *
 * **If you touch this, screenshot it in both themes and confirm the honeycomb is still a
 * honeycomb.** §9 records a previous attempt that replaced the hive with three
 * linear-gradients at 150°/30°/90° — a *triangular* lattice, at a contrast low enough to be
 * invisible — and it passed every grep and every rendered guard in this repo. No assertion
 * here can tell the two outcomes apart.
 */
export function AuthAtmosphere({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app text-copy-primary">
      <HexagonBackground
        hexagonMargin={5}
        hexagonSize={70}
        className="absolute inset-0 z-0 text-copy-muted/40"
      />

      {/* The grid shimmer over the lattice. */}
      <div className="pointer-events-none absolute inset-0 z-1 bg-[image:var(--ambient-grid)] bg-size-[2.5px_2.5px] opacity-50 mix-blend-soft-light" />

      {/* The edge falloff that seats the card on the page. */}
      <div className="pointer-events-none absolute inset-0 z-2 bg-[image:var(--ambient-vignette)]" />

      <div className="relative z-20 w-full max-w-sm overflow-hidden rounded-[var(--radius-dialog)] border border-line-default bg-surface/80 px-8 py-8 shadow-[var(--shadow-panel)] backdrop-blur-xl">
        {/* The raised glow on the floating card. */}
        <div className="pointer-events-none absolute inset-0 bg-[image:var(--ambient-card-glow)] opacity-80" />

        <div className="noise-overlay pointer-events-none absolute inset-0 rounded-[var(--radius-control)] opacity-5" />

        <div className="relative z-10 text-center">{children}</div>
      </div>
    </main>
  );
}
