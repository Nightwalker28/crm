"use client";

import Link from "next/link";
import { ClipboardList } from "lucide-react";

import { DocumentListPage } from "@/components/transactions/DocumentListPage";
import { Button } from "@/components/ui/button";
import { StatusValue } from "@/components/ui/StatusValue";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import type { InventoryDocument, InventoryKind } from "@/hooks/inventory/useInventory";
import { formatDateTime } from "@/lib/datetime";
import type { StatusDescriptor } from "@/lib/statusStyles";

const DOCUMENT_STATUS: Record<InventoryDocument["status"], StatusDescriptor> = {
  draft: { label: "Draft", tone: "neutral" },
  posted: { label: "Posted", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** Adjustments and transfers, on the shared document list (13c §3.2): both gained search there. */
export function InventoryDocumentListPage({ kind }: { kind: InventoryKind }) {
  const { modules } = useAccessibleModules();
  const moduleKey = kind === "adjustments" ? "inventory_adjustments" : "inventory_transfers";
  const canCreate = Boolean(modules.find((module) => module.name === moduleKey)?.actions?.can_create);
  const route = `/dashboard/inventory/${kind}`;
  const noun = kind === "adjustments" ? "adjustment" : "transfer";

  return (
    <DocumentListPage<InventoryDocument>
      moduleKey={moduleKey}
      title={kind === "adjustments" ? "Adjustments" : "Transfers"}
      description={kind === "adjustments" ? "Reasoned stock changes and physical counts." : "Move stock between warehouses with a posted record."}
      endpoint={`/inventory/${kind}`}
      searchPlaceholder={kind === "adjustments" ? "Search by number, reason, warehouse or notes" : "Search by number, warehouse or notes"}
      primaryAction={canCreate ? <Button asChild><Link href={`${route}/new`}>New {noun}</Link></Button> : undefined}
      statusOptions={[{ value: "draft", label: "Draft" }, { value: "posted", label: "Posted" }, { value: "cancelled", label: "Cancelled" }]}
      rowHref={(row) => `${route}/${row.id}`}
      emptyState={{ icon: ClipboardList, title: `No ${kind}`, description: "Create a draft to document the stock change before posting." }}
      columns={[
        { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
        { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={DOCUMENT_STATUS[row.status]} /> },
        { key: "warehouse_name", label: "Warehouse", render: (row) => row.warehouse_name ?? "—" },
        { key: "reason", label: "Reason", render: (row) => row.reason ?? "—" },
        { key: "route", label: "Route", render: (row) => `${row.from_warehouse_name ?? "—"} → ${row.to_warehouse_name ?? "—"}` },
        { key: "line_count", label: "Products", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{row.line_count}</span> },
        { key: "posted_at", label: "Posted", size: "sm", render: (row) => (row.posted_at ? formatDateTime(row.posted_at) : "—") },
        { key: "created_at", label: "Created", size: "sm", render: (row) => formatDateTime(row.created_at) },
      ]}
    />
  );
}
