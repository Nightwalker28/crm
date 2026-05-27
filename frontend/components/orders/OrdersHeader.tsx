"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/PageHeader";

type OrdersHeaderProps = {
  viewSelector?: ReactNode;
};

export default function OrdersHeader({ viewSelector }: OrdersHeaderProps) {
  return (
    <PageHeader
      title="Orders"
      description="Track confirmed sales orders created from accepted quotes."
      actions={viewSelector}
    />
  );
}
