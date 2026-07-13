import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const cardVariants = cva(
  "relative overflow-hidden rounded-[var(--radius-card)] border text-copy-secondary",
  {
    variants: {
      variant: {
        surface: "border-line-subtle bg-surface",
        muted: "border-line-subtle bg-surface-muted",
        raised: "border-line-default bg-surface-raised shadow-lg shadow-black/20",
        interactive: "border-line-default bg-surface transition-colors hover:border-line-strong hover:bg-surface-muted",
        status: "border-line-default bg-surface-muted",
      },
    },
    defaultVariants: { variant: "surface" },
  },
);

type CardProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>;

export function Card({ className, children, variant, ...props }: CardProps) {
  return (
    <div
      className={cn(cardVariants({ variant }), className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-4 px-6 pt-6", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 py-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-t border-line-subtle px-6 py-4", className)} {...props} />;
}
