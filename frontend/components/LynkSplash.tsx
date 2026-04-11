"use client";

const HEX_CLIP =
  "polygon(25% 5.77%, 75% 5.77%, 100% 50%, 75% 94.23%, 25% 94.23%, 0 50%)";

export default function LynkSplash() {
  return (
    <div className="relative flex flex-col h-screen w-screen items-center justify-center bg-black text-white overflow-hidden">
      {/* subtle neutral gray vignette */}
      <div className="pointer-events-none absolute inset-0 vignette-overlay" />

      {/* three hexes stack */}
      <div className="relative flex h-72 w-72 items-center justify-center">
        {/* 3) ripple hex, largest and behind */}
        <div
          className="absolute -inset-5 z-0"
          style={{
            clipPath: HEX_CLIP,
            background: "rgba(56,189,248,0.18)", // cyan glow
            animation: "lynk-hex-ripple 1.7s ease-out infinite",
          }}
        />

        {/* 2) border hex around inner hex */}
        <div
          className="absolute inset-2.5 z-10 bg-neutral-600/20"
          style={{
            clipPath: HEX_CLIP,
          }}
        />

        {/* 1) inner hex for Lynk text, with extra space */}
        <div
          className="absolute inset-4 z-20 bg-neutral-950"
          style={{
            clipPath: HEX_CLIP,
          }}
        />

        {/* Lynk text, centered over inner hex */}
        <div className="relative z-30 flex items-center justify-center">
          <span className="font-lynk text-7xl leading-none text-white">
            Lynk
          </span>
        </div>
      </div>

      {/* custom hex loader */}
      <div className="mt-10 flex flex-col items-center gap-4">
        <p className="text-[11px] uppercase tracking-[0.25em] pl-[0.2em] text-center text-zinc-500">
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

        /* soft corner vignette */
        .vignette-overlay {
          background: radial-gradient(
              circle at top left,
              rgba(120, 120, 120, 0.15),
              transparent 60%
            ),
            radial-gradient(
              circle at top right,
              rgba(120, 120, 120, 0.15),
              transparent 60%
            ),
            radial-gradient(
              circle at bottom left,
              rgba(120, 120, 120, 0.15),
              transparent 60%
            ),
            radial-gradient(
              circle at bottom right,
              rgba(120, 120, 120, 0.15),
              transparent 60%
            );
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
