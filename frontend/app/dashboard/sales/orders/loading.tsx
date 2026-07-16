import { Skeleton } from "@/components/ui/skeleton";

export default function OrdersLoading() {
  return <div className="space-y-6" aria-label="Loading orders"><div><Skeleton className="h-7 w-36" /><Skeleton className="mt-3 h-4 w-full max-w-xl" /></div><Skeleton className="h-16 w-full rounded-[var(--radius-card)]" /><Skeleton className="h-[480px] w-full rounded-[var(--radius-card)]" /></div>;
}
