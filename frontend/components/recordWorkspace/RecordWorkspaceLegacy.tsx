import type { ReactNode } from "react";

import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";
import { cn } from "@/lib/utils";

/**
 * **Scaffolding. Delete this file when its last consumer leaves.**
 *
 * The pre-5.3 record shell, kept alive for exactly as long as it takes to migrate the two
 * pages still on it — `sales/contacts/[contactId]` and `sales/organizations/[orgId]`, at
 * 936 and 869 lines. `RecordWorkspace.tsx` is the archetype now (§4.7); this is the shape
 * it replaced.
 *
 * It exists so the tree stays green between batches rather than so anything keeps using
 * it. Nothing new may import it, and 5.3 does not close while this file is here — the
 * census row for each consumer is what tracks that.
 */

export function LegacyRecordWorkspace({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <PageShell title={title} description={description} className={className}>
      {children}
    </PageShell>
  );
}

export function LegacyRecordWorkspaceHeader({
  title,
  metadata,
  badges,
  actions,
  updatedLabel,
  pageHeader,
}: {
  title: string;
  metadata?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  updatedLabel?: ReactNode;
  pageHeader?: ReactNode;
}) {
  return (
    <Card className="px-4 py-4 sm:px-5">
      {pageHeader ? <div className="mb-3">{pageHeader}</div> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(14rem,0.75fr)_minmax(0,2fr)] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-lg font-semibold text-copy-primary" data-record-workspace-title>{title}</div>
            {badges}
          </div>
          {metadata ? <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-copy-muted">{metadata}</div> : null}
        </div>
        {actions ? (
          <div
            data-record-workspace-actions
            className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end"
          >
            {actions}
          </div>
        ) : null}
      </div>
      {updatedLabel ? <div className="mt-3 text-xs text-copy-muted lg:text-right">{updatedLabel}</div> : null}
    </Card>
  );
}

export function LegacyRecordWorkspacePrimary({
  children,
  relationshipRail,
  className,
}: {
  children: ReactNode;
  relationshipRail?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 items-start gap-4",
        relationshipRail && "lg:grid-cols-[minmax(0,2fr)_minmax(18rem,0.8fr)]",
        className,
      )}
      data-record-workspace-primary
    >
      <div className="grid min-w-0 gap-4">{children}</div>
      {relationshipRail ? <aside data-record-workspace-relationship-rail>{relationshipRail}</aside> : null}
    </div>
  );
}

export function LegacyRecordWorkspaceRegion({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4" data-record-workspace-region={id}>
      {children}
    </section>
  );
}

export function LegacyRecordRelationshipRail({
  title = "Relationship context",
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="px-5 py-5">
      <h2 className="text-sm font-semibold text-copy-label">{title}</h2>
      {description ? <p className="mt-1 text-p-sm text-copy-muted">{description}</p> : null}
      <div className="mt-5 grid gap-4">{children}</div>
    </Card>
  );
}

export function LegacyRecordRelationshipField({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <dl>
      <dt className="text-xs font-medium text-copy-label">{label}</dt>
      <dd className="mt-1 text-sm text-copy-primary">{value}</dd>
    </dl>
  );
}
