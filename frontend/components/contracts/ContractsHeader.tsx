"use client";

import type { ReactNode } from "react";

import { PageHeader } from "@/components/ui/PageHeader";

type ContractsHeaderProps = {
  viewSelector?: ReactNode;
  primaryAction?: ReactNode;
};

export default function ContractsHeader({ viewSelector, primaryAction }: ContractsHeaderProps) {
  return (
    <PageHeader
      title="Contracts"
      description="Manage contract value, renewal dates, linked CRM records, parties, signers, and lifecycle status."
      actions={<div className="flex flex-wrap items-center gap-2">{viewSelector}{primaryAction}</div>}
    />
  );
}
