import { VendorCreditDocumentPage } from "@/components/purchasing/VendorCreditDocumentPage";

function idParam(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** A vendor credit from a bill (`bill_id`), from a vendor return (`vendor_return_id`), or blank (13c §3.6). */
export default async function NewVendorCreditPage({ searchParams }: { searchParams: Promise<{ bill_id?: string; vendor_return_id?: string }> }) {
  const { bill_id: billId, vendor_return_id: returnId } = await searchParams;
  return <VendorCreditDocumentPage billId={idParam(billId)} vendorReturnId={idParam(returnId)} />;
}
