import { VendorReturnDocumentPage } from "@/components/purchasing/VendorReturnDocumentPage";

function idParam(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** A vendor return starts from a posted receipt (`receipt_id`), as Odoo's does (13c §3.7). */
export default async function NewVendorReturnPage({ searchParams }: { searchParams: Promise<{ receipt_id?: string }> }) {
  const { receipt_id: receiptId } = await searchParams;
  return <VendorReturnDocumentPage receiptId={idParam(receiptId)} />;
}
