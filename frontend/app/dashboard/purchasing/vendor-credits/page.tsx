"use client";

import Link from "next/link";
import { FileMinus, Plus } from "lucide-react";

import { DocumentListPage } from "@/components/transactions/DocumentListPage";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import { StatusValue } from "@/components/ui/StatusValue";
import type { VendorCredit } from "@/hooks/purchasing/useVendorDocuments";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { formatDateOnly } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getVendorCreditStatus } from "@/lib/statusStyles";

/**
 * Vendor credits (13c §3.6): archetype 1, on the shared document list. A credit usually starts
 * from its bill or vendor return; *New vendor credit* here is one the vendor sent on its own.
 */
export default function VendorCreditsPage() {
  const { modules } = useAccessibleModules();
  const canCreate = Boolean(modules.find((module) => module.name === "purchase_vendor_credits")?.actions?.can_create);

  return (
    <DocumentListPage<VendorCredit>
      moduleKey="purchase_vendor_credits"
      title="Vendor credits"
      description="What vendors owe back. Apply a credit to their bills, or record their refund."
      endpoint="/purchasing/vendor-credits"
      searchPlaceholder="Search by number, vendor or the vendor's reference"
      primaryAction={canCreate ? <Button asChild><Link href={`${DASHBOARD_ROUTES.vendorCredits}/new`}><Plus />New vendor credit</Link></Button> : undefined}
      statusOptions={[{ value: "draft", label: "Draft" }, { value: "issued", label: "Issued" }, { value: "open", label: "Credit left" }, { value: "void", label: "Void" }]}
      rowHref={(row) => `${DASHBOARD_ROUTES.vendorCredits}/${row.id}`}
      emptyState={{ icon: FileMinus, title: "No vendor credits", description: "Credit a bill or a vendor return, or record a credit the vendor sent." }}
      columns={[
        { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number ?? "Draft"}</span> },
        { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getVendorCreditStatus(row.status)} /> },
        { key: "vendor_name", label: "Vendor", size: "lg", render: (row) => row.vendor_name ?? "—" },
        { key: "vendor_reference", label: "Vendor's credit note", size: "md", render: (row) => row.vendor_reference ?? "—" },
        { key: "bill_number", label: "Bill", size: "sm", render: (row) => row.bill_number ?? "—" },
        { key: "vendor_return_number", label: "Vendor return", size: "sm", render: (row) => row.vendor_return_number ?? "—" },
        { key: "credit_date", label: "Credit date", size: "sm", render: (row) => (row.credit_date ? formatDateOnly(row.credit_date) : "—") },
        { key: "total", label: "Total", size: "sm", align: "right", render: (row) => <Money amount={row.total} currency={row.currency} /> },
        { key: "credit_remaining", label: "Credit left", size: "sm", align: "right", render: (row) => (row.status === "issued" ? <Money amount={row.credit_remaining} currency={row.currency} /> : "—") },
      ]}
    />
  );
}
