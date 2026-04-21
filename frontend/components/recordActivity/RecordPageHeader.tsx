"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";

type RecordPageHeaderProps = {
  backHref: string;
  backLabel: string;
  title: string;
  description: string;
  primaryAction?: ReactNode;
};

export default function RecordPageHeader({
  backHref,
  backLabel,
  title,
  description,
  primaryAction,
}: RecordPageHeaderProps) {
  return (
    <PageHeader
      title={title}
      description={description}
      actions={
        <>
          <Button asChild type="button" variant="ghost" size="sm">
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4" />
              {backLabel}
            </Link>
          </Button>
          {primaryAction}
        </>
      }
    />
  );
}
