import { DeliveryDocumentPage } from "@/components/inventory/DeliveryDocumentPage";

export default async function NewDeliveryPage({ searchParams }: { searchParams: Promise<{ order_id?: string }> }) {
  const { order_id: orderId } = await searchParams;
  const parsed = Number(orderId);
  return <DeliveryDocumentPage orderId={Number.isInteger(parsed) && parsed > 0 ? parsed : null} />;
}
