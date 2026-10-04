import * as React from "react"

import { cn } from "@/lib/utils"

type TextareaProps = Omit<React.ComponentProps<"textarea">, "value"> & {
  /** `null` is drawn as empty, as on `Input` (13a H10). */
  value?: React.ComponentProps<"textarea">["value"] | null
}

function Textarea(allProps: TextareaProps) {
  const { className, value, ...props } = allProps
  const controlled = "value" in allProps ? { value: value ?? "" } : {}
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // No shadow (4.6 - a textarea is anchored), and a hover edge to match
        // Input, which is the control it most often sits beside.
        "border-input placeholder:text-muted-foreground hover:border-line-control-hover focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive flex field-sizing-content min-h-16 w-full rounded-[var(--radius-control)] border bg-surface-muted px-3 py-2 text-base text-copy-primary transition-[border-color,box-shadow,background-color] duration-150 outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:text-copy-disabled disabled:opacity-60 md:text-sm",
        className
      )}
      {...props}
      {...controlled}
    />
  )
}

export { Textarea }
