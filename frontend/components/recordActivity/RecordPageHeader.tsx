"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";

type RecordPageHeaderProps = {
  backHref: string;
  backLabel: string;
  primaryAction?: ReactNode;
};

/**
 * A record's action row: one back link, then whatever the record can do.
 *
 * It used to take `title` and `description` and emit the page's `h1` too. On a detail page
 * that put the heading in two places at once — this component renders inside
 * `RecordWorkspaceHeader`, which already shows the record's name, and several pages render
 * it twice on different branches, so a lead that failed to load announced its name twice
 * and the error state's own heading a third time. `PageShell` owns the `h1` now (§8), and
 * this owns the row of controls under it.
 */
export default function RecordPageHeader({
  backHref,
  backLabel,
  primaryAction,
}: RecordPageHeaderProps) {
  return (
    <PageHeader
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
