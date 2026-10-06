import { CreditNoteDocumentPage } from "@/components/finance/CreditNoteDocumentPage";

function idParam(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** A credit note starts from an invoice (`invoice_id`) or a received return (`return_id`). */
export default async function NewCreditNotePage({ searchParams }: { searchParams: Promise<{ invoice_id?: string; return_id?: string }> }) {
  const { invoice_id: invoiceId, return_id: returnId } = await searchParams;
  return <CreditNoteDocumentPage invoiceId={idParam(invoiceId)} returnId={idParam(returnId)} />;
}
