import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-[38px] w-full min-w-0 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-2 text-base text-copy-primary outline-none transition-[border-color,box-shadow,background-color] placeholder:text-copy-muted selection:bg-primary selection:text-white file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-copy-primary disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-copy-disabled disabled:opacity-60 md:text-sm",
        "hover:border-line-strong focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30",
        "aria-invalid:border-state-danger aria-invalid:ring-2 aria-invalid:ring-state-danger/30",
        className
      )}
      {...props}
    />
  )
}

export { Input }
