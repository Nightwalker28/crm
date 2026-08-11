import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-semibold transition-[background-color,border-color,color,box-shadow] duration-150 outline-none disabled:pointer-events-none disabled:text-copy-disabled disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-app aria-invalid:border-state-danger aria-invalid:ring-state-danger/30",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-action-primary-hover active:bg-action-primary-active",
        primary: "bg-primary text-primary-foreground hover:bg-action-primary-hover active:bg-action-primary-active",
        destructive:
          "bg-state-danger text-state-danger-contrast hover:bg-state-danger/90",
        danger: "bg-state-danger text-state-danger-contrast hover:bg-state-danger/90",
        dangerGhost: "text-state-danger hover:bg-state-danger-muted hover:text-state-danger",
        outline:
          "border border-line-default bg-surface text-copy-secondary hover:border-line-strong hover:bg-surface-muted hover:text-copy-primary",
        secondary:
          "border border-line-default bg-surface-muted text-copy-secondary hover:border-line-strong hover:bg-surface-raised hover:text-copy-primary",
        ghost:
          "text-copy-secondary hover:bg-action-primary-muted hover:text-copy-primary",
        link: "h-auto text-copy-primary underline-offset-4 hover:underline",
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

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
