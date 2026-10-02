import { ReceiptDocumentPage } from "@/components/purchasing/ReceiptDocumentPage";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReceiptDocumentPage receiptId={Number(id)} />;
}
