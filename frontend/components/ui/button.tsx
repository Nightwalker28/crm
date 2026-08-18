"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { useActionBarSize } from "@/components/ui/ActionBar"

// The variant set is closed at six (design.md 2.2). It shipped nine: `primary` and `danger`
// were byte-identical aliases of `default` and `destructive` with zero call sites, `link` had
// zero call sites and contradicted 2.2 (a link in body copy is an `<a>`), and `secondary` was
// `outline` at a different ground for 8 call sites against 296.
//
// The three destructive variants share one prefix on purpose: destructive / destructiveOutline
// / destructiveGhost is a legible ladder, where destructive / danger / dangerGhost was three
// names for two ideas.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-semibold transition-[background-color,border-color,color,box-shadow] duration-150 outline-none disabled:pointer-events-none disabled:text-copy-disabled disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-app aria-invalid:border-state-danger aria-invalid:ring-state-danger/30",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-action-primary-hover active:bg-action-primary-active",
        outline:
          "border border-line-default bg-surface text-copy-secondary hover:border-line-strong hover:bg-surface-muted hover:text-copy-primary",
        ghost:
          "text-copy-secondary hover:bg-action-primary-muted hover:text-copy-primary",
        destructive:
          "bg-state-danger text-state-danger-contrast hover:bg-state-danger/90",
        destructiveOutline:
          "border border-state-danger/50 bg-surface text-state-danger hover:border-state-danger hover:bg-state-danger-muted hover:text-state-danger",
        destructiveGhost:
          "text-state-danger hover:bg-state-danger-muted hover:text-state-danger",
      },
      size: {
        default: "h-[var(--size-control)] px-4 has-[>svg]:px-3",
        sm: "h-[var(--size-control-sm)] gap-1.5 rounded-[var(--radius-control-sm)] px-3 has-[>svg]:px-2.5",
        lg: "h-[var(--size-control-lg)] px-6 has-[>svg]:px-4",
        icon: "size-[var(--size-control)]",
        "icon-sm": "size-[var(--size-control-sm)]",
        "icon-lg": "size-[var(--size-control-lg)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * An `ActionBar` sets the height for the row, so two buttons beside each other cannot
 * disagree (R4). An explicit `size` at the call site still wins — that is how an icon-only
 * button takes `icon-sm` inside a toolbar and stays the same *height* as its labelled
 * neighbour while being narrower, which R4 says is not a mismatch.
 */
const ACTION_BAR_SIZE: Record<"sm" | "default" | "lg", "sm" | "default" | "lg"> = {
  sm: "sm",
  default: "default",
  lg: "lg",
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"
  const rowSize = useActionBarSize()
  const resolvedSize = size ?? (rowSize ? ACTION_BAR_SIZE[rowSize] : undefined)

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size: resolvedSize, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
