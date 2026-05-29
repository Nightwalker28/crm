"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/PageHeader";

type SupportCasesHeaderProps = {
  viewSelector?: ReactNode;
  primaryAction?: ReactNode;
};

export default function SupportCasesHeader({ viewSelector, primaryAction }: SupportCasesHeaderProps) {
  return (
    <PageHeader
      title="Support Cases"
      description="Track customer issues, ownership, SLA due dates, and resolution status."
      actions={<div className="flex flex-wrap items-center gap-2">{viewSelector}{primaryAction}</div>}
    />
  );
}
