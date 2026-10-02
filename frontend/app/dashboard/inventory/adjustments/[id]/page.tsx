import { InventoryDocumentPage } from "@/components/inventory/InventoryDocumentPage";

export default async function AdjustmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InventoryDocumentPage kind="adjustments" documentId={Number(id)} />;
}
