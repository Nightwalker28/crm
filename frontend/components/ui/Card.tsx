import * as React from "react";
import { cn } from "@/lib/utils";

type CardProps = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        // Base styles: rounded corners, dark background, subtle border
        "relative overflow-hidden rounded-md border border-neutral-800 bg-neutral-900 text-neutral-200 shadow-sm",
        className
      )}
      {...props}
    >
      {/* Noise Texture Overlay */}
      <div
        className="noise-overlay absolute inset-0 pointer-events-none opacity-10"
        aria-hidden="true"
      />

      {/* Content Wrapper (z-10 ensures content sits above the noise) */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
}
