import { PurchaseOrderDocumentPage } from "@/components/purchasing/PurchaseOrderDocumentPage";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PurchaseOrderDocumentPage orderId={Number(id)} />;
}
