import { ReturnDocumentPage } from "@/components/inventory/ReturnDocumentPage";

export default async function NewReturnPage({ searchParams }: { searchParams: Promise<{ delivery_id?: string }> }) {
  const { delivery_id: deliveryId } = await searchParams;
  const parsed = Number(deliveryId);
  return <ReturnDocumentPage deliveryId={Number.isInteger(parsed) && parsed > 0 ? parsed : null} />;
}
