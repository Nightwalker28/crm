"use client";

import { HexagonBackground } from "@/components/ui/HexagonBackground";

const HEX_CLIP =
  "polygon(25% 5.77%, 75% 5.77%, 100% 50%, 75% 94.23%, 25% 94.23%, 0 50%)";

export default function LynkSplash() {
  return (
    <div className="relative flex h-screen w-screen flex-col items-center justify-center overflow-hidden bg-app text-copy-primary">
      <HexagonBackground
        aria-hidden="true"
        hexagonMargin={5}
        hexagonSize={70}
        className="pointer-events-none absolute inset-0 z-0 text-copy-muted/40"
      />
      <div className="pointer-events-none absolute inset-0 z-1 mix-blend-soft-light opacity-[0.5] bg-[linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] bg-size-[2.5px_2.5px]" />
      <div className="pointer-events-none absolute inset-0 z-2 bg-[radial-gradient(circle_at_center,transparent_55%,rgba(0,0,0,0.40))]" />

      {/* three hexes stack */}
      <div className="relative z-10 flex h-72 w-72 items-center justify-center">
        {/* 3) ripple hex, largest and behind */}
        <div
          className="absolute -inset-5 z-0"
          style={{
            clipPath: HEX_CLIP,
            background: "color-mix(in srgb, var(--color-primary) 18%, transparent)",
            animation: "lynk-hex-ripple 1.7s ease-out infinite",
          }}
        />

        {/* 2) border hex around inner hex */}
        <div
          className="absolute inset-2.5 z-10 bg-line-strong/40"
          style={{
            clipPath: HEX_CLIP,
          }}
        />

        {/* 1) inner hex for Lynk text, with extra space */}
        <div
          className="absolute inset-4 z-20 bg-app"
          style={{
            clipPath: HEX_CLIP,
          }}
        />

        {/* Lynk text, centered over inner hex */}
        <div className="relative z-30 flex items-center justify-center">
          <span className="font-lynk text-7xl leading-none text-copy-primary">
            Lynk
          </span>
        </div>
      </div>

      {/* custom hex loader */}
      <div className="relative z-10 mt-10 flex flex-col items-center gap-4">
        <p className="pl-[0.2em] text-center text-2xs font-medium text-copy-label">
          Loading
        </p>
      </div>

      {/* animations and helpers */}
      <style jsx global>{`
        @keyframes lynk-hex-ripple {
          0% {
            transform: scale(1);
            opacity: 0.45;
          }
          55% {
            transform: scale(1.7);
            opacity: 0;
          }
          100% {
            transform: scale(1.7);
            opacity: 0;
          }
        }
        @keyframes lynk-hex-pulse {
          0%,
          100% {
            opacity: 0.2;
            transform: scale(0.7);
          }
          50% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
}
