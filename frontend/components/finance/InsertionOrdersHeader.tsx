import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";

interface InsertionOrdersHeaderProps {
  canCreate?: boolean;
}

export default function InsertionOrdersHeader({ canCreate = false }: InsertionOrdersHeaderProps) {
  return (
    <PageHeader
      variant="module"
      title="Insertion Orders"
      description="Manage generic insertion orders and bring in CSV data when needed."
      actions={
        canCreate ? (
          <Button asChild>
            <Link href="/dashboard/finance/insertion-orders/new">
              <Plus />
              <span className="hidden sm:inline">New Order</span>
            </Link>
          </Button>
        ) : null
      }
    />
  );
}
