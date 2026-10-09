"use client";

import { useParams } from "next/navigation";

import { DocumentPreviewPage } from "@/components/transactions/DocumentPreviewPage";
import { DASHBOARD_ROUTES } from "@/lib/routes";

/** Purchase order preview (13d §3.3): the shared preview and PDF. */
export default function PurchaseOrderPreviewPage() {
  const params = useParams<{ id: string }>();
  const recordId = Number(params.id);
  return (
    <DocumentPreviewPage
      moduleKey="purchase_orders"
      recordId={recordId}
      title="Purchase order preview"
      backHref={`${DASHBOARD_ROUTES.purchaseOrders}/${recordId}`}
      backLabel="Back to purchase order"
    />
  );
}
