import { VendorReturnDocumentPage } from "@/components/purchasing/VendorReturnDocumentPage";

export default async function VendorReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VendorReturnDocumentPage returnId={Number(id)} />;
}
