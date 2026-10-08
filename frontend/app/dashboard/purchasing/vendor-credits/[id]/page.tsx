import { VendorCreditDocumentPage } from "@/components/purchasing/VendorCreditDocumentPage";

export default async function VendorCreditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VendorCreditDocumentPage creditId={Number(id)} />;
}
