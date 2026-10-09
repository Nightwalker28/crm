"use client";

import { useParams } from "next/navigation";

import { DocumentPreviewPage } from "@/components/transactions/DocumentPreviewPage";
import { DASHBOARD_ROUTES } from "@/lib/routes";

/** Delivery note preview (13d §3.3): the shared preview and PDF. */
export default function DeliveryNotePreviewPage() {
  const params = useParams<{ id: string }>();
  const recordId = Number(params.id);
  return (
    <DocumentPreviewPage
      moduleKey="inventory_deliveries"
      recordId={recordId}
      title="Delivery note preview"
      backHref={`${DASHBOARD_ROUTES.inventoryDeliveries}/${recordId}`}
      backLabel="Back to delivery"
    />
  );
}
