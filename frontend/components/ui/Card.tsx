import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// A card is a panel edge, so it takes the panel-edge border tier
// (tokens.md 2). It read `border-line-subtle` - the row-divider tier - which is
// why every card sitting beside a ModuleTableShell had a visibly lighter edge
// than the table next to it.
//
// There is deliberately no `overflow-hidden` here. RecordFormLayout makes every
// FormSection a Card, and LinkedRecordPicker positions its suggestion list
// absolutely below the field - clipping meant a picker in a section's last row
// lost nearly its whole list. Six settings pages had already worked around it
// with `className="overflow-visible"`; no record form had.
const cardVariants = cva(
  "relative rounded-[var(--radius-card)] border text-copy-secondary",
  {
    variants: {
      variant: {
        surface: "border-line-default bg-surface",
        muted: "border-line-default bg-surface-muted",
        // No shadow: elevation on dark is the lighter ground this variant
        // already sets, not a drop shadow (design.md 4.6).
        raised: "border-line-default bg-surface-raised",
        interactive:
          "border-line-default bg-surface transition-[background-color,border-color] duration-150 hover:border-line-strong hover:bg-surface-muted",
        status: "border-line-default bg-surface-muted",
      },
    },
    defaultVariants: { variant: "surface" },
  },
);

type CardProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof cardVariants> & { asChild?: boolean };

// asChild lets a panel render as its own semantic element (a landmark
// <section>, for instance) instead of forcing a wrapping div, matching the
// asChild convention button.tsx already established.
export function Card({ className, children, variant, asChild = false, ...props }: CardProps) {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      className={cn(cardVariants({ variant }), className)}
      {...props}
    >
      {children}
    </Comp>
  );
}

// The three slots ran pt-6 / py-5 / py-4 - three vertical steps in one
// component, one of them the 5-step that 4.1 rules off the ladder. They now
// carry two values with named roles: 24px is the card's content padding, 16px
// is the action-bar padding a footer shares with a toolbar row (4.4).

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-4 px-6 pt-6", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 py-6", className)} {...props} />;
}

// The footer is always the card's last child, and five of the six in the app
// are sticky save bars that paint their own background. Rounding its bottom
// corners here is what the removed `overflow-hidden` used to do for them.
export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-b-[var(--radius-card)] border-t border-line-subtle px-6 py-4",
        className,
      )}
      {...props}
    />
  );
}
