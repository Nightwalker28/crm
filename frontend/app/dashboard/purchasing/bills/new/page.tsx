import { BillDocumentPage } from "@/components/purchasing/BillDocumentPage";

function idParam(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** A bill from a purchase order (`order_id`), from a receipt (`receipt_id`), or blank. */
export default async function NewBillPage({ searchParams }: { searchParams: Promise<{ order_id?: string; receipt_id?: string }> }) {
  const { order_id: orderId, receipt_id: receiptId } = await searchParams;
  return <BillDocumentPage orderId={idParam(orderId)} receiptId={idParam(receiptId)} />;
}
