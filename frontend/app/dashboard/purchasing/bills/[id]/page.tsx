import { BillDocumentPage } from "@/components/purchasing/BillDocumentPage";

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BillDocumentPage billId={Number(id)} />;
}
