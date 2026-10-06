import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-[var(--radius-control)] bg-surface-raised motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Skeleton }
