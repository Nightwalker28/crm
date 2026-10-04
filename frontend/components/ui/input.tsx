import * as React from "react"

import { cn } from "@/lib/utils"

type InputProps = Omit<React.ComponentProps<"input">, "value"> & {
  /**
   * `null` is accepted and drawn as empty. Records carry `null` for every empty optional
   * field, and an input handed `null` is uncontrolled until the operator types, which React
   * reports as a switch from uncontrolled to controlled (13a H10). Normalising it here means
   * no form has to remember to.
   */
  value?: React.ComponentProps<"input">["value"] | null
}

function Input(allProps: InputProps) {
  const { className, type, value, ...props } = allProps
  // A `value` key means a controlled input, even when the record had nothing in it. An input
  // given no `value` key at all stays uncontrolled, and a file input never takes one.
  const controlled = "value" in allProps && type !== "file" ? { value: value ?? "" } : {}
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // border-line-control, not -default: only the control tier clears WCAG
        // 1.4.11, and tokens.md 2 names bounding an input with a structural
        // hairline an accessibility bug. It also puts Input on the same edge as
        // Select and Textarea, which already read the `--input` alias.
        "h-[var(--size-control)] w-full min-w-0 rounded-[var(--radius-control)] border border-line-control bg-surface-muted px-3 py-2 text-base text-copy-primary outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-copy-muted selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-copy-primary disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-copy-disabled disabled:opacity-60 md:text-sm",
        "hover:border-line-control-hover focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/40",
        "aria-invalid:border-state-danger aria-invalid:ring-2 aria-invalid:ring-state-danger/30",
        className
      )}
      {...props}
      {...controlled}
    />
  )
}

export { Input }
