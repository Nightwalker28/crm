import { DeliveryDocumentPage } from "@/components/inventory/DeliveryDocumentPage";

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DeliveryDocumentPage deliveryId={Number(id)} />;
}
