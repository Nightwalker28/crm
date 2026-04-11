import { cn } from "@/lib/utils";

interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
  bg?: string;
  text?: string;
  border?: string;
}

export function Pill({ 
  children, 
  bg = "bg-neutral-800", 
  text = "text-neutral-200", 
  border = "border-neutral-600",
  className,
  ...props 
}: PillProps) {
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center overflow-hidden rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors backdrop-blur-sm",
        bg,
        text,
        border,
        className
      )}
      {...props}
    >
      {/* Noise Overlay */}
      <div
        className="absolute inset-0 pointer-events-none mix-blend-multiply bg-repeat opacity-12"
        style={{
          backgroundImage: "url('https://grainy-gradients.vercel.app/noise.svg')",
          backgroundSize: "100px 100px",
        }}
      />

      {/* Content */}
      <span className="relative z-10 truncate w-full text-center">
        {children}
      </span>
    </span>
  );
}