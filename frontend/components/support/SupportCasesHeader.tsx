"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/PageHeader";

type SupportCasesHeaderProps = {
  primaryAction?: ReactNode;
  eyebrow?: string;
};

export default function SupportCasesHeader({ primaryAction, eyebrow }: SupportCasesHeaderProps) {
  return (
    <PageHeader
      variant="module"
      title="Support Cases"
      description="Track customer issues, ownership, SLA due dates, and resolution status."
      eyebrow={eyebrow}
      actions={<div className="flex flex-wrap items-center gap-2">{primaryAction}</div>}
    />
  );
}
