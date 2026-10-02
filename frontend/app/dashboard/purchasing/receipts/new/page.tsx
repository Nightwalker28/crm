import { ReceiptDocumentPage } from "@/components/purchasing/ReceiptDocumentPage";

export default async function NewReceiptPage({ searchParams }: { searchParams: Promise<{ order_id?: string }> }) {
  const { order_id: orderId } = await searchParams;
  const parsed = Number(orderId);
  return <ReceiptDocumentPage orderId={Number.isInteger(parsed) && parsed > 0 ? parsed : null} />;
}
